import Foundation

struct ProjectDescriptor: Decodable {
    let id: String
    let name: String
    let schemaVersion: Int
}

struct ProjectInfo: Equatable {
    let id: String
    let name: String
    let root: String
    let graphRevision: Int
}

struct BlockItem: Identifiable, Equatable {
    let id: String
    let kind: String
    let title: String
    let summary: String
    let body: String
    let contract: String
    let deliveryState: String
    let healthState: String
    let priority: String
    let revision: Int
}

struct ChainItem: Identifiable, Equatable {
    let id: String
    let title: String
    let purpose: String
    let intent: String
    let inputContract: String
    let outputContract: String
    let deliveryState: String
    let healthState: String
    let priority: String
    let revision: Int
}

struct LinkItem: Identifiable, Equatable {
    let id: String
    let sourceType: String
    let sourceId: String
    let targetType: String
    let targetId: String
    let kind: String
    let label: String
    let contract: String
    let healthState: String
    let revision: Int
}

struct ChainMember: Equatable {
    let chainId: String
    let memberType: String
    let memberId: String
    let position: Int
}

struct ChainNode: Equatable {
    let chainId: String
    let blockId: String
    let position: Int
    let role: String
}

struct ChainEdge: Equatable {
    let chainId: String
    let linkId: String
    let position: Int
}

struct PlanItem: Identifiable, Equatable {
    let id: String
    let title: String
    let summary: String
    let goal: String
    let status: String
    let priority: String
    let proposedDelta: String
    let nextAction: String
    let blockers: String
    let revision: Int
}

struct PlanChainReference: Equatable {
    let planId: String
    let chainId: String
    let position: Int
}

struct BackgroundScope: Equatable {
    let blockId: String
    let scopeType: String
    let scopeValue: String
}

struct SourceReference: Identifiable, Equatable {
    let id: String
    let blockId: String
    let path: String
    let startLine: Int?
    let endLine: Int?
    let symbol: String?
    let role: String
    let gitCommit: String?
}

struct CheckpointItem: Identifiable, Equatable {
    let id: String
    let targetType: String
    let targetId: String
    let title: String
    let criteria: String
    let status: String
    let evidence: String
    let revision: Int
    let updatedAt: String
}

struct HistoryItem: Identifiable, Equatable {
    let id: Int
    let entityType: String
    let entityId: String
    let action: String
    let revision: Int
    let summary: String
    let createdAt: String
}

struct ChangeItem: Equatable {
    let sequence: Int
    let entityType: String
    let entityId: String
    let action: String
}

struct LocalizedTextItem: Equatable {
    let entityType: String
    let entityId: String
    let locale: String
    let field: String
    let value: String
}

struct GraphSnapshot: Equatable {
    let project: ProjectInfo
    let changeSequence: Int
    let blocks: [BlockItem]
    let chains: [ChainItem]
    let plans: [PlanItem]
    let links: [LinkItem]
    let members: [ChainMember]
    let chainNodes: [ChainNode]
    let chainEdges: [ChainEdge]
    let planChainReferences: [PlanChainReference]
    let backgroundScopes: [BackgroundScope]
    let sourceReferences: [SourceReference]
    let checkpoints: [CheckpointItem]
    let localizations: [LocalizedTextItem]
    let history: [HistoryItem]
    let latestChanges: [ChangeItem]

    static func empty(name: String = "mdflow", root: String = "") -> GraphSnapshot {
        GraphSnapshot(
            project: ProjectInfo(id: "", name: name, root: root, graphRevision: 0),
            changeSequence: 0,
            blocks: [],
            chains: [],
            plans: [],
            links: [],
            members: [],
            chainNodes: [],
            chainEdges: [],
            planChainReferences: [],
            backgroundScopes: [],
            sourceReferences: [],
            checkpoints: [],
            localizations: [],
            history: [],
            latestChanges: []
        )
    }
}

struct GraphSelection: Equatable, Hashable {
    enum EntityType: String {
        case block
        case chain
        case link
        case plan
    }

    let type: EntityType
    let id: String
}

enum ViewLens: String, CaseIterable, Identifiable {
    case all = "All"
    case ui = "UI"
    case runtime = "Runtime"
    case api = "API"
    case data = "Data"
    case quality = "QA"
    case plan = "Plan"

    var id: String { rawValue }

    func includes(block: BlockItem) -> Bool {
        switch self {
        case .all: true
        case .ui: ["ui", "flow"].contains(block.kind)
        case .runtime: ["service", "function", "integration"].contains(block.kind)
        case .api: ["service", "integration"].contains(block.kind)
        case .data: ["data", "database"].contains(block.kind)
        case .quality: ["test", "checkpoint", "risk"].contains(block.kind)
        case .plan: block.deliveryState != "complete" && block.deliveryState != "deprecated"
        }
    }
}

enum AppLanguage: String, CaseIterable, Identifiable {
    case system
    case zhHans = "zh-Hans"
    case english = "en"

    var id: String { rawValue }
}
