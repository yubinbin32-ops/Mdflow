import AppKit
import SwiftUI

private struct ProjectedEdge: Hashable {
    let id: String
    let sourceId: String
    let targetId: String
    let healthState: String
    let isVirtual: Bool
}

private struct NetworkLayout {
    let positions: [String: CGPoint]
    let size: CGSize
}

struct GraphCanvasView: View {
    @ObservedObject var store: GraphStore
    @State private var gestureStartScale: CGFloat?

    private let cardSize = CGSize(width: 196, height: 108)
    private let networkTop: CGFloat = 190

    var body: some View {
        GeometryReader { viewport in
            ScrollView([.horizontal, .vertical]) {
                let currentLayout = layout
                ZStack(alignment: .topLeading) {
                    ZStack(alignment: .topLeading) {
                        Color.clear.frame(width: 1, height: 1)
                        dotGrid
                        backgroundLayer
                        chainOutlineLayer(currentLayout)
                        linkLayer(currentLayout)
                        blockLayer(currentLayout)
                        chainLabelLayer(currentLayout)
                    }
                    .frame(width: currentLayout.size.width, height: currentLayout.size.height, alignment: .topLeading)
                    .scaleEffect(store.canvasScale, anchor: .topLeading)
                    .animation(.smooth(duration: 0.34), value: store.highlightedChainIDs)
                    .animation(.smooth(duration: 0.28), value: store.enabledLenses)
                    CanvasFocusBridge(
                        target: store.focusTarget.flatMap { focusPoint(for: $0, layout: currentLayout) },
                        scale: store.canvasScale,
                        requestID: store.focusRequestID,
                        viewportSize: viewport.size
                    )
                    .frame(width: 1, height: 1)
                }
                .frame(width: currentLayout.size.width * store.canvasScale, height: currentLayout.size.height * store.canvasScale, alignment: .topLeading)
                .contentShape(Rectangle())
                .onTapGesture { store.clearSelection() }
            }
            .scrollIndicators(.hidden)
            .background(MdflowTheme.canvas)
            .onChange(of: store.focusRequestID) {
                fitFocusedPathIfNeeded(in: layout, viewport: viewport.size)
            }
            .onChange(of: viewport.size) {
                fitFocusedPathIfNeeded(in: layout, viewport: viewport.size)
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

    private var focusedPaths: [[String]] {
        guard !store.highlightedChainIDs.isEmpty else { return [] }
        return store.snapshot.chains
            .filter { store.highlightedChainIDs.contains($0.id) }
            .map { store.chainNodeIDs($0.id) }
    }

    private var layout: NetworkLayout {
        let visibleIDs = Set(visibleNetworkBlocks.map(\.id))
        let edges = store.snapshot.links.compactMap { link -> LayoutEdge? in
            guard link.sourceType == "block", link.targetType == "block",
                  visibleIDs.contains(link.sourceId), visibleIDs.contains(link.targetId) else { return nil }
            return LayoutEdge(id: link.id, sourceID: link.sourceId, targetID: link.targetId)
        }
        let result = NetworkLayoutEngine.make(
            nodeIDs: Array(visibleIDs),
            edges: edges,
            focusPaths: focusedPaths,
            cardSize: cardSize,
            topInset: networkTop
        )
        return NetworkLayout(positions: result.positions, size: result.size)
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
            context.fill(path, with: .color(MdflowTheme.hairline.opacity(0.48)))
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
        .padding(.top, 30)
    }

    private func scopeLabel(_ blockID: String) -> String {
        store.snapshot.backgroundScopes.filter { $0.blockId == blockID }.map {
            $0.scopeType == "project" ? "PROJECT" : $0.scopeValue.uppercased()
        }.joined(separator: " · ")
    }

    private func chainOutlineLayer(_ layout: NetworkLayout) -> some View {
        Canvas { context, _ in
            for (index, chain) in store.snapshot.chains.enumerated() {
                let nodeIDs = store.chainNodeIDs(chain.id).filter { layout.positions[$0] != nil }
                guard !nodeIDs.isEmpty else { continue }
                let color = chainColor(index)
                let highlighted = store.highlightedChainIDs.contains(chain.id)
                let otherFocused = !store.highlightedChainIDs.isEmpty && !highlighted
                let opacity = otherFocused ? 0.025 : highlighted ? 0.82 : 0.24
                let lane = chainLane(chain.id)

                for id in nodeIDs {
                    guard let origin = layout.positions[id] else { continue }
                    let membership = chainMembershipIndex(chain.id, blockID: id)
                    let inset = CGFloat(8 + membership * 5)
                    let frame = CGRect(origin: origin, size: cardSize).insetBy(dx: -inset, dy: -inset)
                    context.stroke(
                        Path(roundedRect: frame, cornerRadius: 20 + inset / 2),
                        with: .color(color.opacity(opacity)),
                        style: StrokeStyle(lineWidth: highlighted ? 2.8 : 1.6, lineCap: .round, lineJoin: .round)
                    )
                }

                for pair in zip(nodeIDs, nodeIDs.dropFirst()) {
                    guard let source = layout.positions[pair.0], let target = layout.positions[pair.1] else { continue }
                    let route = webPath(source: source, target: target, lane: lane)
                    context.stroke(
                        route,
                        with: .color(color.opacity(opacity * 0.65)),
                        style: StrokeStyle(lineWidth: highlighted ? 17 : 12, lineCap: .round, lineJoin: .round)
                    )
                    context.stroke(
                        route,
                        with: .color(MdflowTheme.canvas.opacity(otherFocused ? 0.2 : 0.94)),
                        style: StrokeStyle(lineWidth: highlighted ? 11 : 8, lineCap: .round, lineJoin: .round)
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
                let opacity = highlightedIndex != nil ? 0.96 : hasHighlight ? 0.10 : 0.42
                let lane = NetworkLayoutEngine.routeLane(for: edge.id)
                let route = webPath(source: source, target: target, lane: lane)
                context.stroke(
                    route,
                    with: .color(color.opacity(opacity)),
                    style: StrokeStyle(lineWidth: highlightedIndex != nil ? 2.8 : 1.25, lineCap: .round, lineJoin: .round, dash: edge.isVirtual ? [6, 5] : [])
                )
                drawArrow(context: &context, source: source, target: target, color: color.opacity(opacity))
            }
        }
        .allowsHitTesting(false)
    }

    private func chainLabelLayer(_ layout: NetworkLayout) -> some View {
        ForEach(Array(store.snapshot.chains.enumerated()), id: \.element.id) { index, chain in
            if let anchor = chainAnchor(chain, layout: layout) {
                let highlighted = store.highlightedChainIDs.contains(chain.id)
                Button { store.select(GraphSelection(type: .chain, id: chain.id)) } label: {
                    HStack(spacing: 7) {
                        Capsule().fill(chainColor(index)).frame(width: 20, height: 3)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(store.chainText(chain, field: "title")).lineLimit(1)
                            if highlighted {
                                Text(store.chainText(chain, field: "intent"))
                                    .font(.system(size: 8.5, design: .rounded))
                                    .foregroundStyle(MdflowTheme.muted)
                                    .lineLimit(1)
                            }
                        }
                    }
                    .font(.system(size: 9.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(MdflowTheme.ink)
                    .padding(.horizontal, 9)
                    .frame(width: highlighted ? 260 : 176, height: highlighted ? 38 : 26, alignment: .leading)
                    .background(MdflowTheme.canvas.opacity(0.94), in: Capsule())
                    .overlay(Capsule().stroke(chainColor(index).opacity(highlighted ? 0.9 : 0.42), lineWidth: highlighted ? 1.8 : 1))
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .position(anchor)
                .opacity(store.highlightedChainIDs.isEmpty || highlighted ? 1 : 0.08)
            }
        }
    }

    private func chainAnchor(_ chain: ChainItem, layout: NetworkLayout) -> CGPoint? {
        guard let firstID = store.chainNodeIDs(chain.id).first,
              let origin = layout.positions[firstID] else { return nil }
        let membership = chainMembershipIndex(chain.id, blockID: firstID)
        let highlighted = store.highlightedChainIDs.contains(chain.id)
        return CGPoint(
            x: origin.x + (highlighted ? 130 : 88),
            y: origin.y - CGFloat(22 + membership * 30)
        )
    }

    private func blockLayer(_ layout: NetworkLayout) -> some View {
        ForEach(visibleNetworkBlocks) { block in
            if let point = layout.positions[block.id] {
                blockCard(block)
                    .position(x: point.x + cardSize.width / 2, y: point.y + cardSize.height / 2)
            }
        }
    }

    private func fitFocusedPathIfNeeded(in layout: NetworkLayout, viewport: CGSize) {
        guard let target = store.focusTarget, target.type == .plan || target.type == .chain,
              let bounds = focusBounds(for: target, layout: layout) else { return }
        let horizontal = max(0.5, (viewport.width - 104) / max(bounds.width, 1))
        let vertical = max(0.5, (viewport.height - 104) / max(bounds.height, 1))
        store.setZoom(min(1.12, horizontal, vertical))
    }

    private func focusPoint(for target: GraphSelection, layout: NetworkLayout) -> CGPoint? {
        guard let bounds = focusBounds(for: target, layout: layout) else { return nil }
        return CGPoint(x: bounds.midX, y: bounds.midY)
    }

    private func focusBounds(for target: GraphSelection, layout: NetworkLayout) -> CGRect? {
        let blockIDs: Set<String>
        switch target.type {
        case .block:
            blockIDs = [target.id]
        case .chain:
            blockIDs = Set(store.chainNodeIDs(target.id))
        case .plan:
            let chainIDs = Set(store.targetChains(for: target.id).map(\.id))
            blockIDs = Set(store.snapshot.chainNodes.filter { chainIDs.contains($0.chainId) }.map(\.blockId))
        case .link:
            guard let link = store.snapshot.links.first(where: { $0.id == target.id }) else { return nil }
            blockIDs = [link.sourceId, link.targetId]
        }
        let rects = blockIDs.compactMap { id -> CGRect? in
            guard let point = layout.positions[id] else { return nil }
            return CGRect(origin: point, size: cardSize).insetBy(dx: -24, dy: -42)
        }
        guard var bounds = rects.first else { return nil }
        for rect in rects.dropFirst() { bounds = bounds.union(rect) }
        return bounds
    }

    private func blockCard(_ block: BlockItem) -> some View {
        let selection = GraphSelection(type: .block, id: block.id)
        let selected = store.selection == selection
        let changed = store.recentlyChangedRefs.contains("block:\(block.id)")
        let memberships = store.chains(containing: block.id)
        let muted = !store.highlightedChainIDs.isEmpty && memberships.allSatisfy { !store.highlightedChainIDs.contains($0.id) }
        let stateColor = MdflowTheme.deliveryColor(block.deliveryState)
        return Button { store.select(selection) } label: {
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 7) {
                    Image(systemName: blockSymbol(block.kind))
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(stateColor)
                        .frame(width: 22, height: 22)
                        .background(stateColor.opacity(0.10), in: Circle())
                    Text(block.kind.uppercased())
                        .font(.system(size: 8, weight: .bold, design: .monospaced))
                        .tracking(1.1)
                        .foregroundStyle(MdflowTheme.muted)
                    Spacer()
                    Circle().fill(stateColor).frame(width: 7, height: 7)
                }
                Text(store.blockText(block, field: "title"))
                    .font(.system(size: 12.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(MdflowTheme.ink)
                    .lineLimit(1)
                Text(store.blockText(block, field: "summary"))
                    .font(.system(size: 10, design: .rounded))
                    .foregroundStyle(MdflowTheme.muted)
                    .lineSpacing(1.5)
                    .lineLimit(2)
                Spacer(minLength: 0)
                HStack(spacing: 4) {
                    ForEach(memberships.prefix(6)) { chain in
                        let index = store.snapshot.chains.firstIndex(where: { $0.id == chain.id }) ?? 0
                        Circle().strokeBorder(chainColor(index), lineWidth: 1.5).frame(width: 7, height: 7)
                    }
                    Spacer()
                    Text(block.deliveryState.uppercased())
                        .font(.system(size: 7.5, weight: .bold, design: .monospaced))
                        .tracking(0.7)
                        .foregroundStyle(stateColor)
                }
            }
            .padding(11)
            .frame(width: cardSize.width, height: cardSize.height, alignment: .topLeading)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(MdflowTheme.surface)
                    .overlay(RoundedRectangle(cornerRadius: 18).fill(stateColor.opacity(0.025)))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18)
                            .stroke(changed || selected ? MdflowTheme.focus : MdflowTheme.hairline, lineWidth: changed ? 3 : selected ? 2 : 1)
                    )
            )
            .shadow(color: .black.opacity(selected ? 0.10 : 0.04), radius: selected ? 17 : 8, y: 4)
        }
        .buttonStyle(.plain)
        .opacity(muted ? 0.16 : 1)
        .animation(.easeInOut(duration: 0.2), value: muted)
        .animation(.easeOut(duration: 0.22), value: changed)
    }

    private func blockSymbol(_ kind: String) -> String {
        switch kind {
        case "ui", "flow": "rectangle.3.group"
        case "service", "function": "gearshape.2"
        case "integration": "point.3.connected.trianglepath.dotted"
        case "data", "database": "cylinder"
        case "test", "checkpoint": "checkmark.seal"
        case "risk": "exclamationmark.triangle"
        case "principle", "decision": "scope"
        default: "circle.hexagongrid"
        }
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

    private func chainColor(_ index: Int) -> Color {
        MdflowTheme.chainPalette[index % MdflowTheme.chainPalette.count]
    }

    private func chainMembershipIndex(_ chainID: String, blockID: String) -> Int {
        store.chains(containing: blockID).firstIndex(where: { $0.id == chainID }) ?? 0
    }

    private func chainLane(_ chainID: String) -> CGFloat {
        let index = store.snapshot.chains.firstIndex(where: { $0.id == chainID }) ?? 0
        let midpoint = CGFloat(max(store.snapshot.chains.count - 1, 0)) / 2
        return (CGFloat(index) - midpoint) * 4
    }

    private func webPath(source: CGPoint, target: CGPoint, lane: CGFloat) -> Path {
        let start = edgePoint(origin: source, toward: target)
        let end = edgePoint(origin: target, toward: source)
        let dx = end.x - start.x
        let dy = end.y - start.y
        let distance = max(1, hypot(dx, dy))
        let normal = CGPoint(x: -dy / distance * lane, y: dx / distance * lane)
        var path = Path()
        path.move(to: start)
        path.addCurve(
            to: end,
            control1: CGPoint(x: start.x + dx * 0.36 + normal.x, y: start.y + dy * 0.14 + normal.y),
            control2: CGPoint(x: start.x + dx * 0.64 + normal.x, y: start.y + dy * 0.86 + normal.y)
        )
        return path
    }

    private func edgePoint(origin: CGPoint, toward target: CGPoint) -> CGPoint {
        let center = CGPoint(x: origin.x + cardSize.width / 2, y: origin.y + cardSize.height / 2)
        let targetCenter = CGPoint(x: target.x + cardSize.width / 2, y: target.y + cardSize.height / 2)
        let dx = targetCenter.x - center.x
        let dy = targetCenter.y - center.y
        if abs(dx / cardSize.width) > abs(dy / cardSize.height) {
            return CGPoint(x: center.x + (dx >= 0 ? cardSize.width / 2 : -cardSize.width / 2), y: center.y)
        }
        return CGPoint(x: center.x, y: center.y + (dy >= 0 ? cardSize.height / 2 : -cardSize.height / 2))
    }

    private func drawArrow(context: inout GraphicsContext, source: CGPoint, target: CGPoint, color: Color) {
        let start = edgePoint(origin: source, toward: target)
        let end = edgePoint(origin: target, toward: source)
        let angle = atan2(end.y - start.y, end.x - start.x)
        let length: CGFloat = 7
        var arrow = Path()
        arrow.move(to: CGPoint(x: end.x - cos(angle - 0.55) * length, y: end.y - sin(angle - 0.55) * length))
        arrow.addLine(to: end)
        arrow.addLine(to: CGPoint(x: end.x - cos(angle + 0.55) * length, y: end.y - sin(angle + 0.55) * length))
        context.stroke(arrow, with: .color(color), lineWidth: 1.4)
    }
}

private struct CanvasFocusBridge: NSViewRepresentable {
    let target: CGPoint?
    let scale: CGFloat
    let requestID: UUID
    let viewportSize: CGSize

    final class Coordinator {
        var lastToken = ""
    }

    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeNSView(context: Context) -> NSView { NSView(frame: .zero) }

    func updateNSView(_ nsView: NSView, context: Context) {
        guard let target else { return }
        let token = "\(requestID.uuidString):\(Int(viewportSize.width)):\(Int(viewportSize.height)):\(Int(scale * 1000))"
        guard context.coordinator.lastToken != token else { return }
        context.coordinator.lastToken = token
        DispatchQueue.main.async {
            guard let scrollView = nsView.enclosingScrollView, let documentView = scrollView.documentView else { return }
            let viewport = scrollView.contentView.bounds.size
            let document = documentView.frame.size
            let proposed = CGPoint(
                x: target.x * scale - viewport.width / 2,
                y: target.y * scale - viewport.height / 2
            )
            let origin = CGPoint(
                x: min(max(0, proposed.x), max(0, document.width - viewport.width)),
                y: min(max(0, proposed.y), max(0, document.height - viewport.height))
            )
            NSAnimationContext.runAnimationGroup { animation in
                animation.duration = 0.3
                animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
                scrollView.contentView.animator().setBoundsOrigin(origin)
            }
            scrollView.reflectScrolledClipView(scrollView.contentView)
        }
    }
}
