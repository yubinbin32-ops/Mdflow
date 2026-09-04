import CSQLite
import Foundation

private let transientDestructor = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

final class ProjectDatabase {
    enum DatabaseError: LocalizedError {
        case open(String)
        case prepare(String)
        case step(String)

        var errorDescription: String? {
            switch self {
            case .open(let message), .prepare(let message), .step(let message): message
            }
        }
    }

    private var handle: OpaquePointer?
    let location: ProjectLocation

    init(location: ProjectLocation) throws {
        self.location = location
        guard FileManager.default.fileExists(atPath: location.database.path) else {
            throw CocoaError(.fileNoSuchFile, userInfo: [
                NSLocalizedDescriptionKey: "The mdflow database does not exist yet. Run the MCP server or `npm run seed`."
            ])
        }
        let result = sqlite3_open_v2(location.database.path, &handle, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil)
        guard result == SQLITE_OK else {
            let message = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "Unable to open database"
            throw DatabaseError.open(message)
        }
        sqlite3_busy_timeout(handle, 3_000)
    }

    deinit {
        sqlite3_close(handle)
    }

    func changeSequence() throws -> Int {
        try scalarInt(
            "SELECT COALESCE(MAX(sequence), 0) FROM change_feed WHERE project_id = ?",
            bindings: [location.descriptor.id]
        )
    }

    func loadSnapshot() throws -> GraphSnapshot {
        let projectRows = try rows(
            "SELECT id, name, repo_root, graph_revision FROM projects WHERE id = ?",
            bindings: [location.descriptor.id]
        )
        guard let projectRow = projectRows.first else {
            throw DatabaseError.step("Project metadata is missing")
        }
        let project = ProjectInfo(
            id: projectRow.text("id"),
            name: projectRow.text("name"),
            root: projectRow.text("repo_root"),
            graphRevision: projectRow.int("graph_revision")
        )
        let blocks = try rows(
            "SELECT * FROM blocks WHERE project_id = ? AND archived = 0 ORDER BY title",
            bindings: [project.id]
        ).map { row in
            BlockItem(
                id: row.text("id"),
                kind: row.text("kind"),
                title: row.text("title"),
                summary: row.text("summary"),
                body: row.text("body"),
                contract: row.text("contract"),
                deliveryState: row.text("delivery_state"),
                healthState: row.text("health_state"),
                priority: row.text("priority"),
                revision: row.int("current_revision")
            )
        }
        let chains = try rows(
            "SELECT * FROM chains WHERE project_id = ? AND archived = 0 ORDER BY updated_at DESC",
            bindings: [project.id]
        ).map { row in
            ChainItem(
                id: row.text("id"),
                title: row.text("title"),
                purpose: row.text("purpose"),
                intent: row.text("intent"),
                inputContract: row.text("input_contract"),
                outputContract: row.text("output_contract"),
                deliveryState: row.text("delivery_state"),
                healthState: row.text("health_state"),
                priority: row.text("priority"),
                revision: row.int("current_revision")
            )
        }
        let plans = try rows(
            "SELECT * FROM plans WHERE project_id = ? AND archived = 0 ORDER BY updated_at DESC",
            bindings: [project.id]
        ).map { row in
            PlanItem(
                id: row.text("id"), title: row.text("title"), summary: row.text("summary"),
                goal: row.text("goal"), status: row.text("status"), priority: row.text("priority"),
                proposedDelta: row.text("proposed_delta_json"), nextAction: row.text("next_action"),
                blockers: row.text("blockers_json"), revision: row.int("current_revision")
            )
        }
        let links = try rows(
            "SELECT * FROM links WHERE project_id = ? AND archived = 0 ORDER BY created_at",
            bindings: [project.id]
        ).map { row in
            LinkItem(
                id: row.text("id"),
                sourceType: row.text("source_type"),
                sourceId: row.text("source_id"),
                targetType: row.text("target_type"),
                targetId: row.text("target_id"),
                kind: row.text("kind"),
                label: row.text("label"),
                contract: row.text("contract"),
                healthState: row.text("health_state"),
                revision: row.int("current_revision")
            )
        }
        let members = try rows(
            """
            SELECT cm.* FROM chain_members cm
            JOIN chains c ON c.id = cm.chain_id
            WHERE c.project_id = ? ORDER BY cm.chain_id, cm.position
            """,
            bindings: [project.id]
        ).map { row in
            ChainMember(
                chainId: row.text("chain_id"),
                memberType: row.text("member_type"),
                memberId: row.text("member_id"),
                position: row.int("position")
            )
        }
        let chainNodes = try rows(
            """
            SELECT cn.* FROM chain_nodes cn JOIN chains c ON c.id = cn.chain_id
            WHERE c.project_id = ? AND c.archived = 0 ORDER BY cn.chain_id, cn.position
            """,
            bindings: [project.id]
        ).map { row in
            ChainNode(chainId: row.text("chain_id"), blockId: row.text("block_id"), position: row.int("position"), role: row.text("role"))
        }
        let chainEdges = try rows(
            """
            SELECT ce.* FROM chain_edges ce JOIN chains c ON c.id = ce.chain_id
            WHERE c.project_id = ? AND c.archived = 0 ORDER BY ce.chain_id, ce.position
            """,
            bindings: [project.id]
        ).map { row in
            ChainEdge(chainId: row.text("chain_id"), linkId: row.text("link_id"), position: row.int("position"))
        }
        let planChainReferences = try rows(
            """
            SELECT pcr.* FROM plan_chain_refs pcr JOIN plans p ON p.id = pcr.plan_id
            WHERE p.project_id = ? AND p.archived = 0 ORDER BY pcr.plan_id, pcr.position
            """,
            bindings: [project.id]
        ).map { row in
            PlanChainReference(planId: row.text("plan_id"), chainId: row.text("chain_id"), position: row.int("position"))
        }
        let backgroundScopes = try rows(
            """
            SELECT bs.* FROM background_scopes bs JOIN blocks b ON b.id = bs.block_id
            WHERE b.project_id = ? AND b.archived = 0 ORDER BY bs.block_id
            """,
            bindings: [project.id]
        ).map { row in
            BackgroundScope(blockId: row.text("block_id"), scopeType: row.text("scope_type"), scopeValue: row.text("scope_value"))
        }
        let sourceReferences = try rows(
            """
            SELECT sr.* FROM source_refs sr
            JOIN blocks b ON b.id = sr.block_id
            WHERE b.project_id = ? ORDER BY sr.path, sr.start_line
            """,
            bindings: [project.id]
        ).map { row in
            SourceReference(
                id: row.text("id"),
                blockId: row.text("block_id"),
                path: row.text("path"),
                startLine: row.optionalInt("start_line"),
                endLine: row.optionalInt("end_line"),
                symbol: row.optionalText("symbol"),
                role: row.text("role"),
                gitCommit: row.optionalText("git_commit")
            )
        }
        let checkpoints = try rows(
            "SELECT * FROM checkpoints WHERE project_id = ? ORDER BY updated_at DESC",
            bindings: [project.id]
        ).map { row in
            CheckpointItem(
                id: row.text("id"),
                targetType: row.text("target_type"),
                targetId: row.text("target_id"),
                title: row.text("title"),
                criteria: row.text("criteria"),
                status: row.text("status"),
                evidence: row.text("evidence_json"),
                revision: row.int("current_revision"),
                updatedAt: row.text("updated_at")
            )
        }
        let localizations = try rows(
            """
            SELECT lt.* FROM localized_text lt
            WHERE EXISTS (
              SELECT 1 FROM blocks b WHERE b.project_id = ? AND lt.entity_type = 'block' AND b.id = lt.entity_id
              UNION ALL SELECT 1 FROM chains c WHERE c.project_id = ? AND lt.entity_type = 'chain' AND c.id = lt.entity_id
              UNION ALL SELECT 1 FROM links l WHERE l.project_id = ? AND lt.entity_type = 'link' AND l.id = lt.entity_id
              UNION ALL SELECT 1 FROM plans p WHERE p.project_id = ? AND lt.entity_type = 'plan' AND p.id = lt.entity_id
            )
            """,
            bindings: [project.id, project.id, project.id, project.id]
        ).map { row in
            LocalizedTextItem(
                entityType: row.text("entity_type"), entityId: row.text("entity_id"),
                locale: row.text("locale"), field: row.text("field"), value: row.text("value")
            )
        }
        let history = try rows(
            """
            SELECT h.* FROM history h
            JOIN change_sets cs ON cs.id = h.change_set_id
            WHERE cs.project_id = ? ORDER BY h.id DESC LIMIT 250
            """,
            bindings: [project.id]
        ).map { row in
            HistoryItem(
                id: row.int("id"),
                entityType: row.text("entity_type"),
                entityId: row.text("entity_id"),
                action: row.text("action"),
                revision: row.int("revision"),
                summary: row.text("summary"),
                createdAt: row.text("created_at")
            )
        }
        let latestChanges = try rows(
            """
            SELECT sequence, entity_type, entity_id, action FROM change_feed
            WHERE project_id = ? ORDER BY sequence DESC LIMIT 10
            """,
            bindings: [project.id]
        ).map { row in
            ChangeItem(
                sequence: row.int("sequence"),
                entityType: row.text("entity_type"),
                entityId: row.text("entity_id"),
                action: row.text("action")
            )
        }
        return GraphSnapshot(
            project: project,
            changeSequence: latestChanges.first?.sequence ?? 0,
            blocks: blocks,
            chains: chains,
            plans: plans,
            links: links,
            members: members,
            chainNodes: chainNodes,
            chainEdges: chainEdges,
            planChainReferences: planChainReferences,
            backgroundScopes: backgroundScopes,
            sourceReferences: sourceReferences,
            checkpoints: checkpoints,
            localizations: localizations,
            history: history,
            latestChanges: latestChanges
        )
    }

    private func scalarInt(_ sql: String, bindings: [String]) throws -> Int {
        let result = try rows(sql, bindings: bindings)
        return result.first?.values.values.first.flatMap(Int.init) ?? 0
    }

    private func rows(_ sql: String, bindings: [String] = []) throws -> [SQLiteRow] {
        guard let handle else { throw DatabaseError.open("Database is closed") }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw DatabaseError.prepare(String(cString: sqlite3_errmsg(handle)))
        }
        defer { sqlite3_finalize(statement) }
        for (index, value) in bindings.enumerated() {
            sqlite3_bind_text(statement, Int32(index + 1), value, -1, transientDestructor)
        }
        var output: [SQLiteRow] = []
        while true {
            let result = sqlite3_step(statement)
            if result == SQLITE_DONE { break }
            guard result == SQLITE_ROW else {
                throw DatabaseError.step(String(cString: sqlite3_errmsg(handle)))
            }
            var values: [String: String] = [:]
            var nulls: Set<String> = []
            for columnIndex in 0..<sqlite3_column_count(statement) {
                let name = String(cString: sqlite3_column_name(statement, columnIndex))
                if sqlite3_column_type(statement, columnIndex) == SQLITE_NULL {
                    nulls.insert(name)
                } else if let text = sqlite3_column_text(statement, columnIndex) {
                    values[name] = String(cString: text)
                }
            }
            output.append(SQLiteRow(values: values, nulls: nulls))
        }
        return output
    }
}

private struct SQLiteRow {
    let values: [String: String]
    let nulls: Set<String>

    func text(_ key: String) -> String { values[key] ?? "" }
    func optionalText(_ key: String) -> String? { nulls.contains(key) ? nil : values[key] }
    func int(_ key: String) -> Int { Int(values[key] ?? "0") ?? 0 }
    func optionalInt(_ key: String) -> Int? { nulls.contains(key) ? nil : values[key].flatMap(Int.init) }
}
