import Testing
@testable import MdflowDesktop

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
