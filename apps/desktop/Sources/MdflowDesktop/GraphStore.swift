import AppKit
import Combine
import Foundation
import SwiftUI

@MainActor
final class GraphStore: ObservableObject {
    @Published private(set) var snapshot: GraphSnapshot
    @Published private(set) var recentProjects: [RecentProject]
    @Published var selection: GraphSelection?
    @Published var highlightedChainIDs: Set<String> = []
    @Published private(set) var focusTarget: GraphSelection?
    @Published private(set) var focusRequestID = UUID()
    @Published private(set) var overviewFitRequestID = UUID()
    @Published var isolateFocused = false
    @Published var enabledLenses: Set<ViewLens> = Set(ViewLens.allCases)
    @Published private(set) var recentlyChangedRefs: Set<String> = []
    @Published private(set) var errorMessage: String?
    @Published var settingsPresented = false
    @Published private(set) var pluginInstallStatus: PluginInstallStatus = .idle
    @Published var canvasScale: CGFloat = 1
    @Published var language: AppLanguage {
        didSet { UserDefaults.standard.set(language.rawValue, forKey: "mdflow.language") }
    }

    private var location: ProjectLocation?
    private var database: ProjectDatabase?
    private var clearChangeTask: Task<Void, Never>?
    private var focusTask: Task<Void, Never>?
    private var projectViewStates: [String: ProjectViewState] = [:]

    private struct ProjectViewState {
        let selection: GraphSelection?
        let highlightedChainIDs: Set<String>
        let enabledLenses: Set<ViewLens>
        let canvasScale: CGFloat
        let focusTarget: GraphSelection?
        let isolateFocused: Bool
    }

    init() {
        self.language = AppLanguage(rawValue: UserDefaults.standard.string(forKey: "mdflow.language") ?? "system") ?? .system
        self.recentProjects = ProjectLocation.recentProjects()
        do {
            let resolvedLocation = try ProjectLocation.resolve()
            self.location = resolvedLocation
            self.recentProjects = ProjectLocation.recentProjects()
            do {
                let resolvedDatabase = try ProjectDatabase(location: resolvedLocation)
                self.database = resolvedDatabase
                self.snapshot = try resolvedDatabase.loadSnapshot()
            } catch {
                self.database = nil
                self.snapshot = .empty(name: resolvedLocation.descriptor.name, root: resolvedLocation.root.path)
                self.errorMessage = error.localizedDescription
                Self.log(error, context: resolvedLocation.database.path)
            }
        } catch {
            self.location = nil
            self.database = nil
            self.snapshot = .empty(root: FileManager.default.currentDirectoryPath)
            self.errorMessage = error.localizedDescription
            Self.log(error, context: "project resolution")
        }
    }

    func chooseProject() {
        let panel = NSOpenPanel()
        panel.title = text("openProject")
        panel.message = text("openProjectHelp")
        panel.prompt = text("open")
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false

        guard panel.runModal() == .OK, let url = panel.url else { return }
        loadProject(at: url)
    }

    func openProject(_ project: RecentProject) {
        loadProject(at: URL(fileURLWithPath: project.path, isDirectory: true))
    }

    private func loadProject(at url: URL) {
        do {
            let resolvedLocation = try ProjectLocation.resolve(startingAt: url)
            let resolvedDatabase = try ProjectDatabase(location: resolvedLocation)
            let next = try resolvedDatabase.loadSnapshot()
            saveCurrentProjectViewState()
            database?.close()
            location = resolvedLocation
            database = resolvedDatabase
            recentProjects = ProjectLocation.recentProjects()
            withAnimation(.smooth(duration: 0.24)) {
                snapshot = next
                restoreProjectViewState(for: next.project.id)
                recentlyChangedRefs.removeAll()
                errorMessage = nil
            }
            if let focusTarget { requestFocus(focusTarget) }
        } catch {
            errorMessage = error.localizedDescription
            Self.log(error, context: url.path)
        }
    }

    private func saveCurrentProjectViewState() {
        guard !snapshot.project.id.isEmpty else { return }
        projectViewStates[snapshot.project.id] = ProjectViewState(
            selection: selection,
            highlightedChainIDs: highlightedChainIDs,
            enabledLenses: enabledLenses,
            canvasScale: canvasScale,
            focusTarget: focusTarget,
            isolateFocused: isolateFocused
        )
    }

    private func restoreProjectViewState(for projectID: String) {
        focusTask?.cancel()
        guard let state = projectViewStates[projectID] else {
            selection = nil
            highlightedChainIDs.removeAll()
            focusTarget = nil
            isolateFocused = false
            enabledLenses = Set(ViewLens.allCases)
            canvasScale = 1
            return
        }
        selection = state.selection
        highlightedChainIDs = state.highlightedChainIDs
        enabledLenses = state.enabledLenses
        canvasScale = state.canvasScale
        focusTarget = state.focusTarget
        isolateFocused = state.isolateFocused
    }

    private static func log(_ error: Error, context: String) {
        let message = "mdflow: \(context): \(error.localizedDescription)\n"
        FileHandle.standardError.write(Data(message.utf8))
    }

    var plans: [PlanItem] {
        snapshot.plans
    }

    var visibleBlocks: [BlockItem] {
        let regularLenses = enabledLenses.subtracting([.plan])
        var ids = Set(snapshot.blocks.filter { block in regularLenses.contains { $0.includes(block: block) } }.map(\.id))
        if enabledLenses.contains(.plan) {
            let planIDs = selection?.type == .plan ? [selection!.id] : snapshot.plans.filter { ["active", "blocked", "verifying"].contains($0.status) }.map(\.id)
            let chainIDs = Set(snapshot.planChainReferences.filter { planIDs.contains($0.planId) }.map(\.chainId))
            ids.formUnion(snapshot.chainNodes.filter { chainIDs.contains($0.chainId) }.map(\.blockId))
        }
        ids.formUnion(snapshot.backgroundScopes.map(\.blockId))
        return snapshot.blocks.filter { ids.contains($0.id) }
    }

    func setLens(_ lens: ViewLens, enabled: Bool) {
        if enabled {
            enabledLenses.insert(lens)
        } else {
            enabledLenses.remove(lens)
        }
    }

    func showOverview() {
        selection = nil
        highlightedChainIDs.removeAll()
        focusTarget = nil
        isolateFocused = false
        focusTask?.cancel()
        overviewFitRequestID = UUID()
    }

    func focusPlan(_ id: String) {
        let target = GraphSelection(type: .plan, id: id)
        selection = target
        highlightedChainIDs = Set(snapshot.planChainReferences.filter { $0.planId == id }.map(\.chainId))
        requestFocus(target)
    }

    func select(_ value: GraphSelection) {
        selection = value
        switch value.type {
        case .block:
            highlightedChainIDs.removeAll()
            focusTask?.cancel()
            focusTarget = value
            isolateFocused = false
        case .chain:
            highlightedChainIDs = [value.id]
            requestFocus(value)
        case .plan:
            highlightedChainIDs = Set(snapshot.planChainReferences.filter { $0.planId == value.id }.map(\.chainId))
            requestFocus(value)
        case .link:
            break
        }
    }

    func clearSelection() {
        selection = nil
        highlightedChainIDs.removeAll()
    }

    func fitOverview() { overviewFitRequestID = UUID() }

    func exitFocus() {
        focusTask?.cancel()
        focusTarget = nil
        isolateFocused = false
    }

    func refreshIfChanged() {
        guard let database else { return }
        do {
            let sequence = try database.changeSequence()
            guard sequence != snapshot.changeSequence else { return }
            let previousSequence = snapshot.changeSequence
            let next = try database.loadSnapshot()
            let changed = next.latestChanges
                .filter { $0.sequence > previousSequence }
                .map { "\($0.entityType):\($0.entityId)" }
            withAnimation(.smooth(duration: 0.28)) {
                snapshot = next
                recentlyChangedRefs = Set(changed)
                errorMessage = nil
            }
            clearChangeTask?.cancel()
            clearChangeTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(1.4))
                guard !Task.isCancelled else { return }
                withAnimation(.easeOut(duration: 0.25)) {
                    self?.recentlyChangedRefs.removeAll()
                }
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func title(for value: GraphSelection) -> String {
        switch value.type {
        case .block:
            let fallback = snapshot.blocks.first(where: { $0.id == value.id })?.title ?? value.id
            return localized(type: "block", id: value.id, field: "title", fallback: fallback)
        case .chain:
            let fallback = snapshot.chains.first(where: { $0.id == value.id })?.title ?? value.id
            return localized(type: "chain", id: value.id, field: "title", fallback: fallback)
        case .link:
            let fallback = snapshot.links.first(where: { $0.id == value.id })?.label.nonEmpty ?? text("link")
            return localized(type: "link", id: value.id, field: "label", fallback: fallback)
        case .plan:
            let fallback = snapshot.plans.first(where: { $0.id == value.id })?.title ?? value.id
            return localized(type: "plan", id: value.id, field: "title", fallback: fallback)
        }
    }

    var activeLocale: String {
        switch language {
        case .english: "en"
        case .zhHans: "zh-Hans"
        case .system: Locale.preferredLanguages.first?.hasPrefix("zh") == true ? "zh-Hans" : "en"
        }
    }

    func localized(type: String, id: String, field: String, fallback: String) -> String {
        snapshot.localizations.first {
            $0.entityType == type && $0.entityId == id && $0.locale == activeLocale && $0.field == field
        }?.value ?? fallback
    }

    func blockText(_ block: BlockItem, field: String) -> String {
        let fallback: String
        switch field { case "title": fallback = block.title; case "summary": fallback = block.summary; case "body": fallback = block.body; default: fallback = block.contract }
        return localized(type: "block", id: block.id, field: field, fallback: fallback)
    }

    func chainText(_ chain: ChainItem, field: String) -> String {
        let fallback: String
        switch field { case "title": fallback = chain.title; case "intent": fallback = chain.intent; case "inputContract": fallback = chain.inputContract; default: fallback = chain.outputContract }
        return localized(type: "chain", id: chain.id, field: field, fallback: fallback)
    }

    func planText(_ plan: PlanItem, field: String) -> String {
        let fallback: String
        switch field { case "title": fallback = plan.title; case "summary": fallback = plan.summary; case "goal": fallback = plan.goal; default: fallback = plan.nextAction }
        return localized(type: "plan", id: plan.id, field: field, fallback: fallback)
    }

    func targetChains(for planID: String) -> [ChainItem] {
        let ids = snapshot.planChainReferences.filter { $0.planId == planID }.sorted { $0.position < $1.position }.map(\.chainId)
        let byID = Dictionary(uniqueKeysWithValues: snapshot.chains.map { ($0.id, $0) })
        return ids.compactMap { byID[$0] }
    }

    func chainNodeIDs(_ chainID: String) -> [String] {
        snapshot.chainNodes.filter { $0.chainId == chainID }.sorted { $0.position < $1.position }.map(\.blockId)
    }

    func chainLinkIDs(_ chainID: String) -> Set<String> {
        Set(snapshot.chainEdges.filter { $0.chainId == chainID }.map(\.linkId))
    }

    func chains(containing blockID: String) -> [ChainItem] {
        let ids = Set(snapshot.chainNodes.filter { $0.blockId == blockID }.map(\.chainId))
        return snapshot.chains.filter { ids.contains($0.id) }.sorted { $0.id < $1.id }
    }

    func chainColor(_ chainID: String) -> Color {
        let ordered = snapshot.chains.map(\.id).sorted()
        return MdflowTheme.chainColor(index: ordered.firstIndex(of: chainID) ?? 0)
    }

    func incomingLinks(for blockID: String) -> [LinkItem] {
        snapshot.links.filter {
            $0.sourceType == "block" && $0.targetType == "block" && $0.targetId == blockID
        }.sorted { $0.id < $1.id }
    }

    func outgoingLinks(for blockID: String) -> [LinkItem] {
        snapshot.links.filter {
            $0.sourceType == "block" && $0.targetType == "block" && $0.sourceId == blockID
        }.sorted { $0.id < $1.id }
    }

    func block(_ id: String) -> BlockItem? {
        snapshot.blocks.first { $0.id == id }
    }

    func chainPosition(_ chainID: String, blockID: String) -> (index: Int, count: Int)? {
        let nodes = snapshot.chainNodes.filter { $0.chainId == chainID }.sorted { $0.position < $1.position }
        guard let index = nodes.firstIndex(where: { $0.blockId == blockID }) else { return nil }
        return (index, nodes.count)
    }

    func plans(containing blockID: String) -> [PlanItem] {
        let chainIDs = Set(snapshot.chainNodes.filter { $0.blockId == blockID }.map(\.chainId))
        let planIDs = Set(snapshot.planChainReferences.filter { chainIDs.contains($0.chainId) }.map(\.planId))
        return snapshot.plans.filter { planIDs.contains($0.id) }
    }

    func relatedBlockIDs(for selection: GraphSelection) -> Set<String> {
        switch selection.type {
        case .block:
            // A Block explains its architectural role through the entire connected
            // component. Limiting this to one hop hides downstream consequences.
            let links = snapshot.links.filter { $0.sourceType == "block" && $0.targetType == "block" }
            var adjacency: [String: Set<String>] = [:]
            for link in links {
                adjacency[link.sourceId, default: []].insert(link.targetId)
                adjacency[link.targetId, default: []].insert(link.sourceId)
            }
            var visited: Set<String> = [selection.id]
            var queue = [selection.id]
            while !queue.isEmpty {
                let current = queue.removeFirst()
                for neighbor in (adjacency[current] ?? []).sorted() where visited.insert(neighbor).inserted {
                    queue.append(neighbor)
                }
            }
            return visited
        case .chain:
            return Set(chainNodeIDs(selection.id))
        case .plan:
            let chainIDs = Set(targetChains(for: selection.id).map(\.id))
            return Set(snapshot.chainNodes.filter { chainIDs.contains($0.chainId) }.map(\.blockId))
        case .link:
            guard let link = snapshot.links.first(where: { $0.id == selection.id }) else { return [] }
            return [link.sourceId, link.targetId]
        }
    }

    func requestFocus(_ target: GraphSelection) {
        selection = target
        focusTarget = target
        focusTask?.cancel()
        focusTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(140))
            guard !Task.isCancelled, self?.focusTarget == target else { return }
            self?.focusRequestID = UUID()
        }
    }

    func magnify(_ target: GraphSelection, minimumScale: CGFloat = 1.08) {
        canvasScale = max(canvasScale, minimumScale)
        requestFocus(target)
    }

    func isRelatedToFocus(_ blockID: String) -> Bool {
        guard let focusTarget else { return true }
        return relatedBlockIDs(for: focusTarget).contains(blockID)
    }

    func text(_ key: String) -> String {
        let zh: [String: String] = [
            "overview":"整体网络", "plans":"计划", "chains":"链路", "settings":"设置", "done":"完成",
            "summary":"摘要", "details":"详情", "contract":"契约", "files":"文件与代码", "checkpoints":"检查点", "history":"历史",
            "plugin":"CODEX 插件", "pluginHelp":"开发插件包位于当前项目中。", "revealPlugin":"在访达中显示插件",
            "installPlugin":"一键安装", "installingPlugin":"正在安装…", "pluginInstalled":"已安装；新任务中即可使用", "pluginInstallFailed":"安装失败",
            "liveData":"实时数据", "liveHelp":"变化会自动同步，无需刷新。", "language":"语言", "system":"跟随系统",
            "english":"English", "chinese":"中文", "link":"关系", "input":"输入", "output":"输出",
            "goal":"目标", "nextAction":"下一步", "targetChains":"目标 Chain", "proposedDelta":"计划中的图变更", "blockers":"阻塞",
            "upstream":"直接上游", "downstream":"直接下游", "memberships":"所在 Chain", "relatedPlans":"关联 Plan", "path":"路径", "revision":"版本",
            "fitNetwork":"适配全图", "focusMode":"聚焦", "exitFocus":"退出聚焦", "isolate":"仅显示关联", "projectRules":"项目规则",
            "openProject":"打开项目", "changeProject":"切换项目", "recentProjects":"最近项目", "openProjectHelp":"请选择包含 .mdflow/project.json 的项目目录。", "open":"打开",
            "all":"全部", "ui":"界面", "runtime":"运行时", "api":"API", "data":"数据", "quality":"质量", "plan":"计划"
        ]
        let en: [String: String] = [
            "overview":"Full Network", "plans":"Plans", "chains":"Chains", "settings":"Settings", "done":"Done",
            "summary":"Summary", "details":"Details", "contract":"Contract", "files":"Files & Code", "checkpoints":"Checkpoints", "history":"History",
            "plugin":"CODEX PLUGIN", "pluginHelp":"The development plugin bundle is available in this project.", "revealPlugin":"Reveal Plugin",
            "installPlugin":"Install in Codex", "installingPlugin":"Installing…", "pluginInstalled":"Installed; available in new tasks", "pluginInstallFailed":"Installation failed",
            "liveData":"LIVE DATA", "liveHelp":"Changes appear automatically; no refresh is required.", "language":"Language", "system":"System",
            "english":"English", "chinese":"中文", "link":"Link", "input":"Input", "output":"Output",
            "goal":"Goal", "nextAction":"Next Action", "targetChains":"Target Chains", "proposedDelta":"Proposed Graph Delta", "blockers":"Blockers",
            "upstream":"Direct Upstream", "downstream":"Direct Downstream", "memberships":"Chain Memberships", "relatedPlans":"Related Plans", "path":"Path", "revision":"Revision",
            "fitNetwork":"Fit Network", "focusMode":"Focus", "exitFocus":"Exit Focus", "isolate":"Related Only", "projectRules":"Project Rules",
            "openProject":"Open Project", "changeProject":"Change Project", "recentProjects":"Recent Projects", "openProjectHelp":"Choose a project folder containing .mdflow/project.json.", "open":"Open",
            "all":"All", "ui":"UI", "runtime":"Runtime", "api":"API", "data":"Data", "quality":"QA", "plan":"Plan"
        ]
        return (activeLocale == "zh-Hans" ? zh : en)[key] ?? key
    }

    func lensTitle(_ lens: ViewLens) -> String {
        switch lens { case .ui: text("ui"); case .runtime: text("runtime"); case .api: text("api"); case .data: text("data"); case .quality: text("quality"); case .plan: text("plan") }
    }

    func zoom(by amount: CGFloat) { canvasScale = min(1.8, max(0.25, canvasScale + amount)) }
    func setZoom(_ value: CGFloat) { canvasScale = min(1.8, max(0.25, value)) }
    func resetZoom() { canvasScale = 1 }

    func checkpoints(for value: GraphSelection) -> [CheckpointItem] {
        snapshot.checkpoints.filter { $0.targetType == value.type.rawValue && $0.targetId == value.id }
    }

    func history(for value: GraphSelection) -> [HistoryItem] {
        snapshot.history.filter { $0.entityType == value.type.rawValue && $0.entityId == value.id }
    }

    func sourceReferences(for blockID: String) -> [SourceReference] {
        snapshot.sourceReferences.filter { $0.blockId == blockID }
    }

    func revealSource(_ source: SourceReference) {
        guard let location else { return }
        let url = location.root.appending(path: source.path)
        NSWorkspace.shared.open(url)
    }

    func revealPlugin() {
        guard let location else { return }
        NSWorkspace.shared.activateFileViewerSelecting([
            location.root.appending(path: "plugins/mdflow")
        ])
    }

    func installPlugin() {
        guard pluginInstallStatus != .installing, let marketplaceRoot else { return }
        pluginInstallStatus = .installing
        Task {
            do {
                try await Task.detached { try PluginInstaller.install(marketplaceRoot: marketplaceRoot) }.value
                pluginInstallStatus = .installed
            } catch {
                pluginInstallStatus = .failed(error.localizedDescription)
            }
        }
    }

    private var marketplaceRoot: URL? {
        let manager = FileManager.default
        if let resources = Bundle.main.resourceURL {
            let embedded = resources.appending(path: "MarketplaceRoot", directoryHint: .isDirectory)
            if manager.fileExists(atPath: embedded.appending(path: ".agents/plugins/marketplace.json").path) { return embedded }
        }
        if let root = location?.root,
           manager.fileExists(atPath: root.appending(path: ".agents/plugins/marketplace.json").path) { return root }
        return nil
    }

    var databasePath: String { location?.database.path ?? "Unavailable" }
    var projectRoot: String { location?.root.path ?? "" }
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}
