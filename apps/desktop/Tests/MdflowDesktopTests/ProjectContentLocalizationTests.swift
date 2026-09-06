import CSQLite
import Foundation
import Testing
@testable import MdflowDesktop

private struct ConcurrentReaderResult: Sendable {
    let snapshotMatches: Bool
    let sequenceMatches: Bool
    let error: String?
}

private final class ConcurrentReaderResults: @unchecked Sendable {
    var values: [ConcurrentReaderResult]
    let lock = NSLock()

    init(count: Int) {
        values = Array(
            repeating: ConcurrentReaderResult(snapshotMatches: false, sequenceMatches: false, error: nil),
            count: count
        )
    }
}

private final class BusyReadResult: @unchecked Sendable {
    let semaphore = DispatchSemaphore(value: 0)
    var snapshot: GraphSnapshot?
    var error: String?
}

@Test func databaseFileIdentityChangesWhenCheckoutReplacesSQLiteFile() throws {
    let fileManager = FileManager.default
    let directory = fileManager.temporaryDirectory.appending(path: "mdflow-db-\(UUID().uuidString)", directoryHint: .isDirectory)
    try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? fileManager.removeItem(at: directory) }

    let database = directory.appending(path: "mdflow.sqlite")
    let replacement = directory.appending(path: "mdflow.sqlite.checkout")
    try Data("first checkout".utf8).write(to: database)
    let before = ProjectDatabase.fileIdentity(at: database)

    try Data("second checkout".utf8).write(to: replacement)
    try fileManager.removeItem(at: database)
    try fileManager.moveItem(at: replacement, to: database)
    let after = ProjectDatabase.fileIdentity(at: database)

    #expect(before != nil)
    #expect(after != nil)
    #expect(before != after)
}

@Test func concurrentProjectDatabaseReadersRemainConsistent() throws {
    let fileManager = FileManager.default
    let sourceFile = URL(fileURLWithPath: #filePath)
    let repositoryRoot = sourceFile
        .deletingLastPathComponent() // MdflowDesktopTests
        .deletingLastPathComponent() // Tests
        .deletingLastPathComponent() // desktop
        .deletingLastPathComponent() // apps
        .deletingLastPathComponent() // repository
    let sourceDescriptorURL = repositoryRoot.appending(path: ".mdflow/project.json")
    let sourceDatabaseURL = repositoryRoot.appending(path: ".mdflow/mdflow.sqlite")
    guard fileManager.fileExists(atPath: sourceDescriptorURL.path),
          fileManager.fileExists(atPath: sourceDatabaseURL.path) else {
        Issue.record("The checked-in mdflow fixture is required for the concurrent reader test")
        return
    }

    let root = fileManager.temporaryDirectory.appending(path: "mdflow-concurrent-readers-\(UUID().uuidString)", directoryHint: .isDirectory)
    let dataDirectory = root.appending(path: ".mdflow", directoryHint: .isDirectory)
    try fileManager.createDirectory(at: dataDirectory, withIntermediateDirectories: true)
    defer { try? fileManager.removeItem(at: root) }
    try fileManager.copyItem(at: sourceDescriptorURL, to: dataDirectory.appending(path: "project.json"))
    try fileManager.copyItem(at: sourceDatabaseURL, to: dataDirectory.appending(path: "mdflow.sqlite"))

    let descriptorData = try Data(contentsOf: dataDirectory.appending(path: "project.json"))
    let descriptor = try JSONDecoder().decode(ProjectDescriptor.self, from: descriptorData)
    let location = ProjectLocation(root: root, descriptor: descriptor, database: dataDirectory.appending(path: "mdflow.sqlite"))
    let baselineReader = try ProjectDatabase(location: location)
    defer { baselineReader.close() }
    let baselineSnapshot = try baselineReader.loadSnapshot()
    let baselineSequence = try baselineReader.changeSequence()
    let rootPath = root.path
    let dataPath = dataDirectory.path
    let expectedSnapshot = baselineSnapshot

    let results = ConcurrentReaderResults(count: 8)
    DispatchQueue.concurrentPerform(iterations: results.values.count) { index in
        do {
            let workerRoot = URL(fileURLWithPath: rootPath, isDirectory: true)
            let workerData = URL(fileURLWithPath: dataPath, isDirectory: true)
            let workerDescriptor = try JSONDecoder().decode(
                ProjectDescriptor.self,
                from: Data(contentsOf: workerData.appending(path: "project.json"))
            )
            let workerLocation = ProjectLocation(
                root: workerRoot,
                descriptor: workerDescriptor,
                database: workerData.appending(path: "mdflow.sqlite")
            )
            let reader = try ProjectDatabase(location: workerLocation)
            defer { reader.close() }
            var snapshotMatches = true
            var sequenceMatches = true
            for _ in 0..<4 {
                let snapshot = try reader.loadSnapshot()
                let sequence = try reader.changeSequence()
                snapshotMatches = snapshotMatches && (snapshot == expectedSnapshot)
                sequenceMatches = sequenceMatches && (sequence == baselineSequence)
            }
            results.lock.lock()
            results.values[index] = ConcurrentReaderResult(
                snapshotMatches: snapshotMatches,
                sequenceMatches: sequenceMatches,
                error: nil
            )
            results.lock.unlock()
        } catch {
            results.lock.lock()
            results.values[index] = ConcurrentReaderResult(snapshotMatches: false, sequenceMatches: false, error: error.localizedDescription)
            results.lock.unlock()
        }
    }

    results.lock.lock()
    let values = results.values
    results.lock.unlock()
    #expect(values.count == 8)
    #expect(values.allSatisfy { $0.error == nil })
    #expect(values.allSatisfy { $0.snapshotMatches })
    #expect(values.allSatisfy { $0.sequenceMatches })
}

@Test func projectDatabaseReaderRecoversAfterShortWriterLock() throws {
    let fileManager = FileManager.default
    let sourceFile = URL(fileURLWithPath: #filePath)
    let repositoryRoot = sourceFile
        .deletingLastPathComponent() // MdflowDesktopTests
        .deletingLastPathComponent() // Tests
        .deletingLastPathComponent() // desktop
        .deletingLastPathComponent() // apps
        .deletingLastPathComponent() // repository
    let sourceDescriptorURL = repositoryRoot.appending(path: ".mdflow/project.json")
    let sourceDatabaseURL = repositoryRoot.appending(path: ".mdflow/mdflow.sqlite")
    guard fileManager.fileExists(atPath: sourceDescriptorURL.path),
          fileManager.fileExists(atPath: sourceDatabaseURL.path) else {
        Issue.record("The checked-in mdflow fixture is required for the busy-reader test")
        return
    }

    let root = fileManager.temporaryDirectory.appending(path: "mdflow-busy-reader-\(UUID().uuidString)", directoryHint: .isDirectory)
    let dataDirectory = root.appending(path: ".mdflow", directoryHint: .isDirectory)
    try fileManager.createDirectory(at: dataDirectory, withIntermediateDirectories: true)
    defer { try? fileManager.removeItem(at: root) }
    try fileManager.copyItem(at: sourceDescriptorURL, to: dataDirectory.appending(path: "project.json"))
    try fileManager.copyItem(at: sourceDatabaseURL, to: dataDirectory.appending(path: "mdflow.sqlite"))

    let descriptor = try JSONDecoder().decode(
        ProjectDescriptor.self,
        from: Data(contentsOf: dataDirectory.appending(path: "project.json"))
    )
    let databaseURL = dataDirectory.appending(path: "mdflow.sqlite")
    let location = ProjectLocation(root: root, descriptor: descriptor, database: databaseURL)
    let reader = try ProjectDatabase(location: location)
    defer { reader.close() }
    let expected = try reader.loadSnapshot()

    var writer: OpaquePointer?
    let openResult = sqlite3_open_v2(
        databaseURL.path,
        &writer,
        SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX,
        nil
    )
    #expect(openResult == SQLITE_OK)
    guard openResult == SQLITE_OK, let writer else {
        if let writer { sqlite3_close(writer) }
        return
    }
    defer { sqlite3_close(writer) }
    sqlite3_busy_timeout(writer, 3_000)
    var errorMessage: UnsafeMutablePointer<CChar>?
    let beginResult = sqlite3_exec(writer, "BEGIN EXCLUSIVE", nil, nil, &errorMessage)
    #expect(beginResult == SQLITE_OK)
    if let errorMessage { sqlite3_free(errorMessage) }
    guard beginResult == SQLITE_OK else { return }

    let result = BusyReadResult()
    let rootPath = root.path
    let dataPath = dataDirectory.path
    DispatchQueue.global(qos: .userInitiated).async {
        var busyReader: ProjectDatabase?
        do {
            let workerRoot = URL(fileURLWithPath: rootPath, isDirectory: true)
            let workerData = URL(fileURLWithPath: dataPath, isDirectory: true)
            let workerDescriptor = try JSONDecoder().decode(
                ProjectDescriptor.self,
                from: Data(contentsOf: workerData.appending(path: "project.json"))
            )
            let workerLocation = ProjectLocation(
                root: workerRoot,
                descriptor: workerDescriptor,
                database: workerData.appending(path: "mdflow.sqlite")
            )
            busyReader = try ProjectDatabase(location: workerLocation)
            result.snapshot = try busyReader?.loadSnapshot()
        } catch {
            result.error = error.localizedDescription
        }
        busyReader?.close()
        result.semaphore.signal()
    }

    // The reader must wait on SQLite's busy timeout rather than fail immediately.
    Thread.sleep(forTimeInterval: 0.15)
    let rollbackResult = sqlite3_exec(writer, "ROLLBACK", nil, nil, &errorMessage)
    #expect(rollbackResult == SQLITE_OK)
    if let errorMessage { sqlite3_free(errorMessage) }
    #expect(result.semaphore.wait(timeout: .now() + 3.0) == .success)
    #expect(result.error == nil)
    #expect(result.snapshot == expected)
}

@Test func appLanguageNeverReplacesCanonicalProjectContent() {
    let legacyTranslation = LocalizedTextItem(
        entityType: "block",
        entityId: "canvas",
        locale: "zh-Hans",
        field: "title",
        value: "可缩放画布"
    )

    let english = GraphStore.projectContent(
        "Zoomable canvas",
        appLanguage: .english,
        localizations: [legacyTranslation]
    )
    let chinese = GraphStore.projectContent(
        "Zoomable canvas",
        appLanguage: .zhHans,
        localizations: [legacyTranslation]
    )

    #expect(english == "Zoomable canvas")
    #expect(chinese == "Zoomable canvas")
}

@Test func historyItemKeepsCompactDiffMetadataSeparateFromEntityFacts() {
    let item = HistoryItem(
        id: 1,
        entityType: "block",
        entityId: "canvas",
        action: "updated",
        revision: 2,
        summary: "Update canvas contract",
        planID: "migration",
        chainScopeID: "canvas-scope",
        changedFields: ["summary"],
        fieldDiffs: [HistoryFieldDiff(field: "summary", before: "old", after: "new")],
        affectedRefs: ["block:canvas", "chain:city-canvas"],
        evidenceRefs: ["checkpoint:canvas-proof"],
        createdAt: "2026-09-05T00:00:00Z"
    )

    #expect(item.changedFields == ["summary"])
    #expect(item.affectedRefs.contains("chain:city-canvas"))
    #expect(item.fieldDiffs.first?.before == "old")
    #expect(item.fieldDiffs.first?.after == "new")
}

@Test func historyDiffDecoderSelectsOnlyChangedFields() {
    let diffs = ProjectDatabase.historyFieldDiffs(
        beforeJSON: "{\"title\":\"Canvas\",\"summary\":\"old\",\"body\":\"unchanged\"}",
        afterJSON: "{\"title\":\"Canvas\",\"summary\":\"new\",\"body\":\"unchanged\"}",
        fields: ["summary"]
    )

    #expect(diffs == [HistoryFieldDiff(field: "summary", before: "old", after: "new")])
}

@MainActor @Test func verificationInboxHidesPassedCheckpoints() {
    func checkpoint(id: String, status: String) -> CheckpointItem {
        CheckpointItem(
            id: id,
            targetType: "block",
            targetId: "canvas",
            title: id,
            criteria: "",
            status: status,
            kind: "atomic",
            aggregationPolicy: "{}",
            eligibleAfterChildren: false,
            evidenceLevel: status == "passed" ? "integration" : "none",
            requiredEvidenceLevel: "integration",
            coverage: "complete",
            evidence: "[]",
            invalidatedAt: nil,
            revision: 1,
            updatedAt: "2026-09-05T00:00:00Z"
        )
    }

    let visible = GraphStore.visibleVerificationCheckpoints([
        checkpoint(id: "done", status: "passed"),
        checkpoint(id: "normalized-done", status: " PASSED\n"),
        checkpoint(id: "pending", status: "pending"),
        checkpoint(id: "retest", status: "retest_required"),
    ])

    #expect(visible.map(\.id) == ["pending", "retest"])
}

@MainActor @Test func projectStateRestoresOnlyEntitiesThatStillExist() {
    let empty = GraphSnapshot.empty(name: "project", root: "/tmp/project")
    let snapshot = GraphSnapshot(
        project: empty.project,
        changeSequence: empty.changeSequence,
        blocks: [BlockItem(
            id: "present", kind: "ui", title: "Present", summary: "", body: "", contract: "",
            scope: "canvas", architectureLayer: "client", localOrder: 0, deliveryState: "planned",
            healthState: "healthy", priority: "normal", revision: 1
        )],
        chains: empty.chains,
        plans: empty.plans,
        links: empty.links,
        chainNodes: empty.chainNodes,
        chainEdges: empty.chainEdges,
        planChainReferences: empty.planChainReferences,
        planDependencies: empty.planDependencies,
        planSteps: empty.planSteps,
        planCheckpointReferences: empty.planCheckpointReferences,
        planChainScopes: empty.planChainScopes,
        planChanges: empty.planChanges,
        planChainChangeReferences: empty.planChainChangeReferences,
        backgroundScopes: empty.backgroundScopes,
        decisions: empty.decisions,
        decisionScopes: empty.decisionScopes,
        sourceReferences: empty.sourceReferences,
        checkpoints: empty.checkpoints,
        checkpointBindings: empty.checkpointBindings,
        checkpointDependencies: empty.checkpointDependencies,
        localizations: empty.localizations,
        history: empty.history,
        latestChanges: empty.latestChanges
    )
    let valid = GraphSelection(type: .block, id: "present")
    let missing = GraphSelection(type: .block, id: "removed")

    #expect(GraphStore.selection(valid, existsIn: snapshot) == true)
    #expect(GraphStore.selection(missing, existsIn: snapshot) == false)
}
