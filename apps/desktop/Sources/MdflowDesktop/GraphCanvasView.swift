import SwiftUI

private struct ProjectedEdge: Hashable {
    let id: String
    let sourceId: String
    let targetId: String
    let healthState: String
    let isVirtual: Bool
}

private struct NetworkZone: Identifiable {
    let id: String
    let title: String
    let rect: CGRect
}

private struct NetworkLayout {
    let positions: [String: CGPoint]
    let zones: [NetworkZone]
    let size: CGSize
}

struct GraphCanvasView: View {
    @ObservedObject var store: GraphStore
    @State private var gestureStartScale: CGFloat?

    private let cardSize = CGSize(width: 232, height: 126)
    private let columnWidth: CGFloat = 300
    private let rowHeight: CGFloat = 158
    private let networkTop: CGFloat = 210

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView([.horizontal, .vertical]) {
                let currentLayout = layout
                ZStack(alignment: .topLeading) {
                    ZStack(alignment: .topLeading) {
                        Color.clear.frame(width: 1, height: 1).id("canvas-origin")
                        dotGrid
                        zoneLayer(currentLayout)
                        backgroundLayer
                        chainOverlayLayer(currentLayout)
                        linkLayer(currentLayout)
                        chainLabelLayer(currentLayout)
                        blockLayer(currentLayout)
                    }
                    .frame(width: currentLayout.size.width, height: currentLayout.size.height, alignment: .topLeading)
                    .scaleEffect(store.canvasScale, anchor: .topLeading)
                }
                .frame(width: currentLayout.size.width * store.canvasScale, height: currentLayout.size.height * store.canvasScale, alignment: .topLeading)
                .contentShape(Rectangle())
                .onTapGesture { store.clearSelection() }
            }
            .scrollIndicators(.hidden)
            .background(MdflowTheme.canvas)
            .onChange(of: store.focusRequestID) {
                guard let id = store.focusTargetBlockID else { return }
                withAnimation(.easeInOut(duration: 0.28)) {
                    proxy.scrollTo("block:\(id)", anchor: .center)
                }
            }
            .simultaneousGesture(
                MagnificationGesture()
                    .onChanged { value in
                        let start = gestureStartScale ?? store.canvasScale
                        if gestureStartScale == nil { gestureStartScale = start }
                        store.setZoom(start * value)
                    }
                    .onEnded { _ in gestureStartScale = nil }
            )
        }
    }

    private var backgroundBlockIDs: Set<String> {
        Set(store.snapshot.backgroundScopes.map(\.blockId))
    }

    private var networkBlocks: [BlockItem] {
        store.snapshot.blocks.filter { !backgroundBlockIDs.contains($0.id) }
    }

    private var visibleNetworkBlocks: [BlockItem] {
        let visible = Set(store.visibleBlocks.map(\.id))
        return networkBlocks.filter { visible.contains($0.id) }
    }

    private var visibleBackgroundBlocks: [BlockItem] {
        let visible = Set(store.visibleBlocks.map(\.id))
        return store.snapshot.blocks.filter { backgroundBlockIDs.contains($0.id) && visible.contains($0.id) }
    }

    private var layout: NetworkLayout {
        let definitions: [(String, String, Set<String>)] = [
            ("intent", store.activeLocale == "zh-Hans" ? "意图与约束" : "INTENT & RULES", ["principle", "product", "requirement", "decision"]),
            ("experience", store.activeLocale == "zh-Hans" ? "体验" : "EXPERIENCE", ["ui", "flow"]),
            ("runtime", store.activeLocale == "zh-Hans" ? "运行时" : "RUNTIME", ["service", "function", "integration"]),
            ("data", store.activeLocale == "zh-Hans" ? "数据" : "DATA", ["data", "database"]),
            ("quality", store.activeLocale == "zh-Hans" ? "质量与风险" : "QUALITY & RISK", ["test", "checkpoint", "risk"]),
        ]
        var positions: [String: CGPoint] = [:]
        var zones: [NetworkZone] = []
        var maxRows = 1
        for (column, definition) in definitions.enumerated() {
            let blocks = networkBlocks.filter { definition.2.contains($0.kind) }.sorted {
                if $0.priority != $1.priority { return priorityRank($0.priority) > priorityRank($1.priority) }
                return $0.id < $1.id
            }
            maxRows = max(maxRows, blocks.count)
            let x = 64 + CGFloat(column) * columnWidth
            for (row, block) in blocks.enumerated() {
                positions[block.id] = CGPoint(x: x, y: networkTop + 54 + CGFloat(row) * rowHeight)
            }
            let zoneHeight = max(210, CGFloat(blocks.count) * rowHeight + 92)
            zones.append(NetworkZone(id: definition.0, title: definition.1, rect: CGRect(x: x - 22, y: networkTop, width: cardSize.width + 44, height: zoneHeight)))
        }
        let width = 64 + CGFloat(definitions.count - 1) * columnWidth + cardSize.width + 70
        let height = networkTop + CGFloat(maxRows) * rowHeight + 130
        return NetworkLayout(positions: positions, zones: zones, size: CGSize(width: max(1100, width), height: max(720, height)))
    }

    private func priorityRank(_ value: String) -> Int {
        ["critical": 4, "high": 3, "normal": 2, "low": 1][value] ?? 0
    }

    private var dotGrid: some View {
        Canvas { context, size in
            var path = Path()
            let step: CGFloat = 24
            stride(from: 0, through: size.width, by: step).forEach { x in
                stride(from: 0, through: size.height, by: step).forEach { y in
                    path.addEllipse(in: CGRect(x: x, y: y, width: 1, height: 1))
                }
            }
            context.fill(path, with: .color(MdflowTheme.hairline.opacity(0.52)))
        }
        .allowsHitTesting(false)
    }

    private func zoneLayer(_ layout: NetworkLayout) -> some View {
        ForEach(layout.zones) { zone in
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(MdflowTheme.surface.opacity(0.34))
                    .stroke(MdflowTheme.hairline.opacity(0.72), style: StrokeStyle(lineWidth: 1, dash: [3, 5]))
                Text(zone.title)
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .tracking(1.5)
                    .foregroundStyle(MdflowTheme.muted)
                    .padding(16)
            }
            .frame(width: zone.rect.width, height: zone.rect.height)
            .position(x: zone.rect.midX, y: zone.rect.midY)
        }
        .allowsHitTesting(false)
    }

    private var backgroundLayer: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(store.activeLocale == "zh-Hans" ? "BACKGROUND · 项目规则" : "BACKGROUND · PROJECT RULES")
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .tracking(1.5)
                .foregroundStyle(MdflowTheme.muted)
            HStack(spacing: 10) {
                ForEach(visibleBackgroundBlocks) { block in
                    Button { store.select(GraphSelection(type: .block, id: block.id)) } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "shield.lefthalf.filled").foregroundStyle(MdflowTheme.unstable)
                            Text(store.blockText(block, field: "title")).lineLimit(1)
                            Text(scopeLabel(block.id))
                                .font(.system(size: 8, weight: .bold, design: .monospaced))
                                .foregroundStyle(MdflowTheme.muted)
                        }
                        .font(.system(size: 10.5, weight: .medium, design: .rounded))
                        .foregroundStyle(MdflowTheme.ink)
                        .padding(.horizontal, 12)
                        .frame(height: 34)
                        .background(MdflowTheme.surface, in: Capsule())
                        .overlay(Capsule().stroke(MdflowTheme.unstable.opacity(0.22)))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.leading, 42)
        .padding(.top, 34)
    }

    private func scopeLabel(_ blockID: String) -> String {
        store.snapshot.backgroundScopes.filter { $0.blockId == blockID }.map {
            $0.scopeType == "project" ? "PROJECT" : $0.scopeValue.uppercased()
        }.joined(separator: " · ")
    }

    private func chainOverlayLayer(_ layout: NetworkLayout) -> some View {
        Canvas { context, _ in
            for (index, chain) in store.snapshot.chains.enumerated() {
                let color = chainColor(index)
                let highlighted = store.highlightedChainIDs.contains(chain.id)
                let edgeIDs = store.chainLinkIDs(chain.id)
                for link in store.snapshot.links where edgeIDs.contains(link.id) {
                    guard let source = layout.positions[link.sourceId], let target = layout.positions[link.targetId] else { continue }
                    context.stroke(
                        orthogonalPath(source: source, target: target),
                        with: .color(color.opacity(highlighted ? 0.22 : 0.055)),
                        style: StrokeStyle(lineWidth: highlighted ? 16 : 10, lineCap: .round, lineJoin: .round)
                    )
                }
            }
        }
        .allowsHitTesting(false)
    }

    private func linkLayer(_ layout: NetworkLayout) -> some View {
        Canvas { context, _ in
            for edge in projectedEdges {
                guard let source = layout.positions[edge.sourceId], let target = layout.positions[edge.targetId] else { continue }
                let chainIndices = store.snapshot.chainEdges.filter { $0.linkId == edge.id }.compactMap { membership in
                    store.snapshot.chains.firstIndex(where: { $0.id == membership.chainId })
                }
                let highlightedIndex = chainIndices.first { store.highlightedChainIDs.contains(store.snapshot.chains[$0].id) }
                let hasHighlight = !store.highlightedChainIDs.isEmpty
                let color = highlightedIndex.map(chainColor) ?? MdflowTheme.healthColor(edge.healthState)
                let opacity = highlightedIndex != nil ? 0.95 : hasHighlight ? 0.13 : 0.48
                context.stroke(
                    orthogonalPath(source: source, target: target),
                    with: .color(color.opacity(opacity)),
                    style: StrokeStyle(lineWidth: highlightedIndex != nil ? 2.6 : 1.25, lineCap: .square, lineJoin: .miter, dash: edge.isVirtual ? [6, 5] : [])
                )
                let end = edgeEnd(source: source, target: target)
                var arrow = Path()
                arrow.move(to: CGPoint(x: end.x - 7, y: end.y - 4))
                arrow.addLine(to: end)
                arrow.addLine(to: CGPoint(x: end.x - 7, y: end.y + 4))
                context.stroke(arrow, with: .color(color.opacity(opacity)), lineWidth: 1.4)
            }
        }
        .allowsHitTesting(false)
    }

    private func chainLabelLayer(_ layout: NetworkLayout) -> some View {
        ForEach(Array(store.snapshot.chains.enumerated()), id: \.element.id) { index, chain in
            if let anchor = chainAnchor(chain, layout: layout) {
                Button { store.select(GraphSelection(type: .chain, id: chain.id)) } label: {
                    HStack(spacing: 6) {
                        Capsule().fill(chainColor(index)).frame(width: 16, height: 3)
                        Text(store.chainText(chain, field: "title")).lineLimit(1)
                    }
                    .font(.system(size: 9.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(MdflowTheme.ink)
                    .padding(.horizontal, 9)
                    .frame(height: 26)
                    .background(MdflowTheme.surface.opacity(store.highlightedChainIDs.contains(chain.id) ? 1 : 0.86), in: Capsule())
                    .overlay(Capsule().stroke(chainColor(index).opacity(store.highlightedChainIDs.contains(chain.id) ? 0.8 : 0.2)))
                }
                .buttonStyle(.plain)
                .position(anchor)
                .opacity(store.highlightedChainIDs.isEmpty || store.highlightedChainIDs.contains(chain.id) ? 1 : 0.22)
            }
        }
    }

    private func chainAnchor(_ chain: ChainItem, layout: NetworkLayout) -> CGPoint? {
        let points = store.chainNodeIDs(chain.id).compactMap { layout.positions[$0] }
        guard let first = points.first else { return nil }
        let index = store.snapshot.chains.firstIndex(where: { $0.id == chain.id }) ?? 0
        return CGPoint(x: first.x + cardSize.width / 2, y: first.y - 18 - CGFloat(index % 3) * 29)
    }

    private func blockLayer(_ layout: NetworkLayout) -> some View {
        ForEach(visibleNetworkBlocks) { block in
            if let point = layout.positions[block.id] {
                blockCard(block)
                    .position(x: point.x + cardSize.width / 2, y: point.y + cardSize.height / 2)
                    .id("block:\(block.id)")
            }
        }
    }

    private func blockCard(_ block: BlockItem) -> some View {
        let selection = GraphSelection(type: .block, id: block.id)
        let selected = store.selection == selection
        let changed = store.recentlyChangedRefs.contains("block:\(block.id)")
        let memberships = store.chains(containing: block.id)
        let mutedByChain = !store.highlightedChainIDs.isEmpty && memberships.allSatisfy { !store.highlightedChainIDs.contains($0.id) }
        let stateColor = MdflowTheme.deliveryColor(block.deliveryState)
        return Button { store.select(selection) } label: {
            HStack(spacing: 0) {
                RoundedRectangle(cornerRadius: 2).fill(stateColor).frame(width: 4)
                VStack(alignment: .leading, spacing: 7) {
                    HStack {
                        Text(block.kind.uppercased())
                            .font(.system(size: 8.5, weight: .bold, design: .monospaced)).tracking(1.2)
                            .foregroundStyle(MdflowTheme.muted)
                        Spacer()
                        Text(block.deliveryState.uppercased())
                            .font(.system(size: 8, weight: .bold, design: .monospaced)).tracking(0.8)
                            .foregroundStyle(stateColor)
                    }
                    Text(store.blockText(block, field: "title"))
                        .font(.system(size: 13, weight: .semibold, design: .rounded)).foregroundStyle(MdflowTheme.ink).lineLimit(1)
                    Text(store.blockText(block, field: "summary"))
                        .font(.system(size: 10.5, design: .rounded)).foregroundStyle(MdflowTheme.muted).lineSpacing(2).lineLimit(2)
                    Spacer(minLength: 0)
                    HStack(spacing: 4) {
                        ForEach(memberships.prefix(5)) { chain in
                            let index = store.snapshot.chains.firstIndex(where: { $0.id == chain.id }) ?? 0
                            Capsule().fill(chainColor(index)).frame(width: 18, height: 3)
                        }
                        if memberships.count > 5 {
                            Text("+\(memberships.count - 5)").font(.system(size: 8, design: .monospaced)).foregroundStyle(MdflowTheme.muted)
                        }
                        Spacer()
                        if block.healthState != "unknown" { Circle().fill(MdflowTheme.healthColor(block.healthState)).frame(width: 7, height: 7) }
                    }
                }
                .padding(13)
            }
            .frame(width: cardSize.width, height: cardSize.height, alignment: .topLeading)
            .background(
                RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .fill(MdflowTheme.surface)
                    .overlay(RoundedRectangle(cornerRadius: 15).fill(stateColor.opacity(0.035)))
                    .overlay(
                        RoundedRectangle(cornerRadius: 15)
                            .stroke(changed || selected ? MdflowTheme.focus : stateColor.opacity(0.28), lineWidth: changed ? 3 : selected ? 2 : 1)
                    )
            )
            .shadow(color: .black.opacity(selected ? 0.09 : 0.035), radius: selected ? 16 : 9, y: 4)
        }
        .buttonStyle(.plain)
        .opacity(mutedByChain ? 0.18 : 1)
        .animation(.easeInOut(duration: 0.2), value: mutedByChain)
        .animation(.easeOut(duration: 0.22), value: changed)
    }

    private var projectedEdges: [ProjectedEdge] {
        let allLinks = store.snapshot.links.filter { $0.sourceType == "block" && $0.targetType == "block" }
        let allIDs = Set(networkBlocks.map(\.id))
        let visibleIDs = Set(visibleNetworkBlocks.map(\.id))
        let adjacency = Dictionary(grouping: allLinks.filter { allIDs.contains($0.sourceId) && allIDs.contains($0.targetId) }, by: \.sourceId)
        var output = Set<ProjectedEdge>()
        for source in visibleIDs {
            var queue = (adjacency[source] ?? []).map { ($0.targetId, $0.healthState, false, $0.id) }
            var visited: Set<String> = [source]
            while !queue.isEmpty {
                let (target, health, crossedHidden, linkID) = queue.removeFirst()
                guard visited.insert(target).inserted else { continue }
                if visibleIDs.contains(target) {
                    output.insert(ProjectedEdge(id: crossedHidden ? "virtual:\(source):\(target)" : linkID, sourceId: source, targetId: target, healthState: health, isVirtual: crossedHidden))
                } else {
                    for next in adjacency[target] ?? [] { queue.append((next.targetId, worseHealth(health, next.healthState), true, linkID)) }
                }
            }
        }
        return output.sorted { $0.id < $1.id }
    }

    private func worseHealth(_ lhs: String, _ rhs: String) -> String {
        let rank = ["unknown": 0, "healthy": 1, "warning": 2, "unstable": 3, "disputed": 4, "failing": 5]
        return (rank[lhs] ?? 0) >= (rank[rhs] ?? 0) ? lhs : rhs
    }

    private func chainColor(_ index: Int) -> Color { MdflowTheme.chainPalette[index % MdflowTheme.chainPalette.count] }

    private func orthogonalPath(source: CGPoint, target: CGPoint) -> Path {
        let start = edgeStart(source: source, target: target)
        let end = edgeEnd(source: source, target: target)
        var path = Path()
        path.move(to: start)
        if abs(target.x - source.x) < 10 {
            let offset = source.x + cardSize.width + 18
            path.addLine(to: CGPoint(x: offset, y: start.y))
            path.addLine(to: CGPoint(x: offset, y: end.y))
        } else {
            let middleX = (start.x + end.x) / 2
            path.addLine(to: CGPoint(x: middleX, y: start.y))
            path.addLine(to: CGPoint(x: middleX, y: end.y))
        }
        path.addLine(to: end)
        return path
    }

    private func edgeStart(source: CGPoint, target: CGPoint) -> CGPoint {
        if abs(target.x - source.x) < 10 { return CGPoint(x: source.x + cardSize.width / 2, y: source.y + cardSize.height) }
        return target.x > source.x ? CGPoint(x: source.x + cardSize.width, y: source.y + cardSize.height / 2) : CGPoint(x: source.x, y: source.y + cardSize.height / 2)
    }

    private func edgeEnd(source: CGPoint, target: CGPoint) -> CGPoint {
        if abs(target.x - source.x) < 10 { return CGPoint(x: target.x + cardSize.width / 2, y: target.y) }
        return target.x > source.x ? CGPoint(x: target.x, y: target.y + cardSize.height / 2) : CGPoint(x: target.x + cardSize.width, y: target.y + cardSize.height / 2)
    }
}
