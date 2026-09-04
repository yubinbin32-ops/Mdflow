import AppKit
import SwiftUI

struct GraphCanvasView: View {
    @ObservedObject var store: GraphStore
    @State private var gestureStartScale: CGFloat?
    @State private var manualFocusPoint: CGPoint?
    @State private var manualFocusID = UUID()
    @State private var didFitOverview = false

    private let cardSize = CGSize(width: 196, height: 108)
    private let networkTop: CGFloat = 118

    var body: some View {
        GeometryReader { viewport in
            ScrollView([.horizontal, .vertical]) {
                let currentLayout = layout
                ZStack(alignment: .topLeading) {
                    ZStack(alignment: .topLeading) {
                        Color.clear.frame(width: 1, height: 1)
                        dotGrid
                        backgroundLayer
                        linkLayer(currentLayout)
                        chainRouteLayer(currentLayout)
                        junctionLayer(currentLayout)
                        blockLayer(currentLayout)
                        inlineChainLabels(currentLayout)
                        focusBreadcrumb
                    }
                    .frame(width: currentLayout.size.width, height: currentLayout.size.height, alignment: .topLeading)
                    .scaleEffect(store.canvasScale, anchor: .topLeading)
                    .animation(.smooth(duration: 0.3), value: store.selection)
                    .animation(.smooth(duration: 0.25), value: store.enabledLenses)

                    CanvasFocusBridge(
                        target: manualFocusPoint ?? store.focusTarget.flatMap { focusPoint(for: $0, layout: currentLayout) },
                        scale: store.canvasScale,
                        requestID: manualFocusPoint == nil ? store.focusRequestID : manualFocusID,
                        viewportSize: viewport.size,
                        onScrollZoom: { amount in
                            manualFocusPoint = nil
                            store.zoom(by: amount)
                        }
                    )
                    .frame(width: 1, height: 1)
                }
                .frame(
                    width: currentLayout.size.width * store.canvasScale,
                    height: currentLayout.size.height * store.canvasScale,
                    alignment: .topLeading
                )
                .contentShape(Rectangle())
                .highPriorityGesture(
                    SpatialTapGesture(count: 2).onEnded { value in
                        let point = CGPoint(
                            x: value.location.x / max(store.canvasScale, 0.01),
                            y: value.location.y / max(store.canvasScale, 0.01)
                        )
                        manualFocusPoint = point
                        let factor: CGFloat = NSEvent.modifierFlags.contains(.option) ? 1 / 1.35 : 1.35
                        store.setZoom(store.canvasScale * factor)
                        manualFocusID = UUID()
                    }
                )
            }
            .scrollIndicators(.hidden)
            .background(MdflowTheme.canvas)
            .onAppear {
                guard !didFitOverview else { return }
                didFitOverview = true
                DispatchQueue.main.async { fitOverview(in: layout, viewport: viewport.size) }
            }
            .onChange(of: store.selection) { _, selection in
                if selection == nil { fitOverview(in: layout, viewport: viewport.size) }
            }
            .onChange(of: store.focusRequestID) {
                manualFocusPoint = nil
                fitFocusedSelection(in: layout, viewport: viewport.size)
            }
            .onChange(of: viewport.size) {
                if store.selection != nil {
                    fitFocusedSelection(in: layout, viewport: viewport.size)
                } else if didFitOverview {
                    fitOverview(in: layout, viewport: viewport.size)
                }
            }
            .simultaneousGesture(
                MagnificationGesture()
                    .onChanged { value in
                        manualFocusPoint = nil
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

    private var visibleNetworkBlocks: [BlockItem] {
        store.visibleBlocks.filter { !backgroundBlockIDs.contains($0.id) }
    }

    private var visibleBackgroundBlocks: [BlockItem] {
        store.visibleBlocks.filter { backgroundBlockIDs.contains($0.id) }
    }

    private var visibleEdges: [LinkItem] {
        let ids = Set(visibleNetworkBlocks.map(\.id))
        return store.snapshot.links.filter {
            $0.sourceType == "block" && $0.targetType == "block" && ids.contains($0.sourceId) && ids.contains($0.targetId)
        }
    }

    private var focusedPaths: [[String]] {
        guard let selection = store.selection else { return [] }
        switch selection.type {
        case .chain:
            return [store.chainNodeIDs(selection.id)]
        case .plan:
            return store.targetChains(for: selection.id).map { store.chainNodeIDs($0.id) }
        default:
            return []
        }
    }

    private var layout: NetworkLayoutSnapshot {
        NetworkLayoutEngine.make(
            nodeIDs: visibleNetworkBlocks.map(\.id),
            edges: visibleEdges.map { LayoutEdge(id: $0.id, sourceID: $0.sourceId, targetID: $0.targetId) },
            focusPaths: focusedPaths,
            districts: Dictionary(uniqueKeysWithValues: visibleNetworkBlocks.map { ($0.id, districtIndex(for: $0.kind)) }),
            cardSize: cardSize,
            topInset: networkTop
        )
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
            context.fill(path, with: .color(MdflowTheme.hairline.opacity(0.45)))
        }
        .allowsHitTesting(false)
    }

    private var backgroundLayer: some View {
        HStack(spacing: 9) {
            Text(store.activeLocale == "zh-Hans" ? "项目规则" : "PROJECT RULES")
                .font(.system(size: 8.5, weight: .bold, design: .monospaced))
                .tracking(1.2)
                .foregroundStyle(MdflowTheme.muted)
            ForEach(visibleBackgroundBlocks) { block in
                Button { store.select(GraphSelection(type: .block, id: block.id)) } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "shield.lefthalf.filled")
                        Text(store.blockText(block, field: "title")).lineLimit(1)
                    }
                    .font(.system(size: 10, weight: .medium, design: .rounded))
                    .foregroundStyle(MdflowTheme.ink)
                    .padding(.horizontal, 10)
                    .frame(height: 28)
                    .background(MdflowTheme.surface, in: Capsule())
                    .overlay(Capsule().stroke(MdflowTheme.unstable.opacity(0.2)))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.leading, 28)
        .padding(.top, 20)
    }

    private func linkLayer(_ layout: NetworkLayoutSnapshot) -> some View {
        Canvas { context, _ in
            for edge in visibleEdges {
                guard let points = layout.routes[edge.id], points.count > 1 else { continue }
                let path = streetPath(points)
                context.stroke(
                    path,
                    with: .color(MdflowTheme.healthColor(edge.healthState).opacity(store.selection == nil ? 0.34 : 0.48)),
                    style: StrokeStyle(lineWidth: 1.35, lineCap: .round, lineJoin: .round)
                )
                drawArrow(context: &context, points: points, color: MdflowTheme.ink.opacity(0.35))
            }
        }
        .allowsHitTesting(false)
    }

    private func chainRouteLayer(_ layout: NetworkLayoutSnapshot) -> some View {
        Canvas { context, _ in
            for edge in visibleEdges {
                guard let points = layout.routes[edge.id], points.count > 1 else { continue }
                let memberships = chainIDs(for: edge.id)
                for (index, chainID) in memberships.enumerated() {
                    let highlighted = store.highlightedChainIDs.contains(chainID)
                    let hasFocus = !store.highlightedChainIDs.isEmpty
                    let opacity = highlighted ? 0.98 : hasFocus ? 0.08 : 0.48
                    let offset = NetworkLayoutEngine.routeLane(index: index, count: memberships.count, maximumSpread: 10)
                    let path = streetPath(offsetPath(points, by: offset))
                    if highlighted {
                        context.stroke(path, with: .color(store.chainColor(chainID).opacity(0.13)), style: StrokeStyle(lineWidth: 8, lineCap: .round, lineJoin: .round))
                    }
                    context.stroke(
                        path,
                        with: .color(store.chainColor(chainID).opacity(opacity)),
                        style: StrokeStyle(lineWidth: highlighted ? 3.2 : 1.8, lineCap: .round, lineJoin: .round)
                    )
                }
            }
        }
        .allowsHitTesting(false)
    }

    private func junctionLayer(_ layout: NetworkLayoutSnapshot) -> some View {
        Canvas { context, _ in
            var counts: [PointKey: Int] = [:]
            for route in layout.routes.values {
                for point in route.dropFirst().dropLast() { counts[PointKey(point), default: 0] += 1 }
            }
            for (key, count) in counts where count > 1 {
                let frame = CGRect(x: key.x - 3, y: key.y - 3, width: 6, height: 6)
                context.fill(Path(ellipseIn: frame), with: .color(MdflowTheme.surface))
                context.stroke(Path(ellipseIn: frame), with: .color(MdflowTheme.muted.opacity(0.55)), lineWidth: 1)
            }
        }
        .allowsHitTesting(false)
    }

    private func blockLayer(_ layout: NetworkLayoutSnapshot) -> some View {
        ForEach(visibleNetworkBlocks) { block in
            if let point = layout.positions[block.id] {
                blockCard(block)
                    .position(x: point.x + cardSize.width / 2, y: point.y + cardSize.height / 2)
            }
        }
    }

    @ViewBuilder
    private func inlineChainLabels(_ layout: NetworkLayoutSnapshot) -> some View {
        ForEach(store.snapshot.chains) { chain in
            if (store.selection == nil || store.highlightedChainIDs.contains(chain.id)),
               let anchor = chainLabelAnchor(chain.id, layout: layout) {
                Button { store.select(GraphSelection(type: .chain, id: chain.id)) } label: {
                    HStack(spacing: 5) {
                        Capsule().fill(store.chainColor(chain.id)).frame(width: 18, height: 3)
                        Text(store.chainText(chain, field: "title")).lineLimit(1)
                    }
                    .font(.system(size: 8.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(MdflowTheme.ink.opacity(0.82))
                    .padding(.horizontal, 5)
                    .padding(.vertical, 3)
                    .background(MdflowTheme.canvas.opacity(0.93))
                }
                .buttonStyle(.plain)
                .position(anchor)
            }
        }
    }

    @ViewBuilder
    private var focusBreadcrumb: some View {
        if let selection = store.selection {
            HStack(spacing: 7) {
                Button(store.text("overview")) { store.showOverview() }
                    .buttonStyle(.plain)
                    .foregroundStyle(MdflowTheme.focus)
                Image(systemName: "chevron.right")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(MdflowTheme.muted)
                Text(store.title(for: selection)).lineLimit(1)
                if selection.type == .block {
                    Text(store.activeLocale == "zh-Hans" ? "一跳上下游" : "1-hop neighborhood")
                        .foregroundStyle(MdflowTheme.muted)
                }
            }
            .font(.system(size: 10.5, weight: .semibold, design: .rounded))
            .padding(.horizontal, 10)
            .frame(height: 30)
            .background(.ultraThinMaterial, in: Capsule())
            .position(x: 190, y: 78)
        }
    }

    private func blockCard(_ block: BlockItem) -> some View {
        let selection = GraphSelection(type: .block, id: block.id)
        let selected = store.selection == selection
        let changed = store.recentlyChangedRefs.contains("block:\(block.id)")
        let memberships = store.chains(containing: block.id)
        let stateColor = MdflowTheme.deliveryColor(block.deliveryState)
        let semanticCompact = store.canvasScale < 0.72

        return VStack(alignment: .leading, spacing: semanticCompact ? 9 : 7) {
                HStack(spacing: 7) {
                    Image(systemName: blockSymbol(block.kind))
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(stateColor)
                        .frame(width: 22, height: 22)
                        .background(stateColor.opacity(0.1), in: Circle())
                    Text(block.kind.uppercased())
                        .font(.system(size: 8, weight: .bold, design: .monospaced))
                        .tracking(1.1)
                        .foregroundStyle(MdflowTheme.muted)
                    Spacer()
                    Circle().fill(stateColor).frame(width: 7, height: 7)
                        .accessibilityLabel(block.deliveryState)
                }
                Text(store.blockText(block, field: "title"))
                    .font(.system(size: semanticCompact ? 14 : 12.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(MdflowTheme.ink)
                    .lineLimit(semanticCompact ? 2 : 1)
                if !semanticCompact {
                    Text(store.blockText(block, field: "summary"))
                        .font(.system(size: 10, design: .rounded))
                        .foregroundStyle(MdflowTheme.muted)
                        .lineSpacing(1.5)
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
                HStack(spacing: 4) {
                    ForEach(memberships.prefix(6)) { chain in
                        let position = store.chainPosition(chain.id, blockID: block.id)
                        Circle()
                            .fill(store.chainColor(chain.id))
                            .frame(width: 7, height: 7)
                            .help("\(store.chainText(chain, field: "title")) · \((position?.index ?? 0) + 1)/\(position?.count ?? 0)")
                            .accessibilityLabel("\(store.chainText(chain, field: "title")) \((position?.index ?? 0) + 1) of \(position?.count ?? 0)")
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
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(MdflowTheme.surface)
                .overlay(RoundedRectangle(cornerRadius: 16).fill(stateColor.opacity(0.022)))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(changed || selected ? MdflowTheme.focus : MdflowTheme.hairline, lineWidth: changed ? 3 : selected ? 2 : 1))
        )
        .shadow(color: .black.opacity(selected ? 0.1 : 0.035), radius: selected ? 15 : 6, y: 3)
        .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .onTapGesture(count: 2) { store.magnify(selection) }
        .onTapGesture { store.select(selection) }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { store.select(selection) }
        .animation(.easeOut(duration: 0.22), value: changed)
    }

    private func fitFocusedSelection(in layout: NetworkLayoutSnapshot, viewport: CGSize) {
        guard let target = store.focusTarget, let bounds = focusBounds(for: target, layout: layout) else { return }
        let horizontal = max(0.58, (viewport.width - 96) / max(bounds.width, 1))
        let vertical = max(0.58, (viewport.height - 96) / max(bounds.height, 1))
        store.setZoom(min(1.18, horizontal, vertical))
    }

    private func fitOverview(in layout: NetworkLayoutSnapshot, viewport: CGSize) {
        let horizontal = (viewport.width - 64) / max(layout.size.width, 1)
        let vertical = (viewport.height - 64) / max(layout.size.height, 1)
        store.setZoom(min(1, max(0.5, min(horizontal, vertical))))
        manualFocusPoint = CGPoint(x: layout.size.width / 2, y: layout.size.height / 2)
        manualFocusID = UUID()
    }

    private func focusPoint(for target: GraphSelection, layout: NetworkLayoutSnapshot) -> CGPoint? {
        guard let bounds = focusBounds(for: target, layout: layout) else { return nil }
        return CGPoint(x: bounds.midX, y: bounds.midY)
    }

    private func focusBounds(for target: GraphSelection, layout: NetworkLayoutSnapshot) -> CGRect? {
        let ids = store.relatedBlockIDs(for: target)
        let rects = ids.compactMap { id -> CGRect? in
            guard let point = layout.positions[id] else { return nil }
            return CGRect(origin: point, size: cardSize).insetBy(dx: -30, dy: -34)
        }
        guard let first = rects.first else { return nil }
        return rects.dropFirst().reduce(first) { $0.union($1) }
    }

    private func chainIDs(for linkID: String) -> [String] {
        store.snapshot.chainEdges.filter { $0.linkId == linkID }.map(\.chainId).sorted()
    }

    private func chainLabelAnchor(_ chainID: String, layout: NetworkLayoutSnapshot) -> CGPoint? {
        let linkIDs = store.snapshot.chainEdges.filter { $0.chainId == chainID }.sorted { $0.position < $1.position }.map(\.linkId)
        var best: (length: CGFloat, point: CGPoint)?
        for linkID in linkIDs {
            guard let points = layout.routes[linkID] else { continue }
            for (start, end) in zip(points, points.dropFirst()) where start.y == end.y {
                let length = abs(end.x - start.x)
                if length > (best?.length ?? 72) {
                    best = (length, CGPoint(x: (start.x + end.x) / 2, y: start.y - 10))
                }
            }
        }
        return best?.point
    }

    private func streetPath(_ points: [CGPoint]) -> Path {
        var path = Path()
        guard let first = points.first else { return path }
        path.move(to: first)
        for point in points.dropFirst() { path.addLine(to: point) }
        return path
    }

    private func offsetPath(_ points: [CGPoint], by amount: CGFloat) -> [CGPoint] {
        guard amount != 0, points.count > 1 else { return points }
        return points.indices.map { index in
            let point = points[index]
            let previous = index > 0 ? normal(from: points[index - 1], to: point) : nil
            let next = index + 1 < points.count ? normal(from: point, to: points[index + 1]) : nil
            let x = (previous?.x ?? next?.x ?? 0) + (next?.x ?? previous?.x ?? 0)
            let y = (previous?.y ?? next?.y ?? 0) + (next?.y ?? previous?.y ?? 0)
            let magnitude = max(1, sqrt(x * x + y * y))
            return CGPoint(x: point.x + x / magnitude * amount, y: point.y + y / magnitude * amount)
        }
    }

    private func normal(from start: CGPoint, to end: CGPoint) -> CGPoint {
        let dx = end.x - start.x
        let dy = end.y - start.y
        let length = max(1, sqrt(dx * dx + dy * dy))
        return CGPoint(x: -dy / length, y: dx / length)
    }

    private func drawArrow(context: inout GraphicsContext, points: [CGPoint], color: Color) {
        guard let end = points.last, let start = points.dropLast().last else { return }
        let angle = atan2(end.y - start.y, end.x - start.x)
        let length: CGFloat = 6
        var arrow = Path()
        arrow.move(to: CGPoint(x: end.x - cos(angle - 0.55) * length, y: end.y - sin(angle - 0.55) * length))
        arrow.addLine(to: end)
        arrow.addLine(to: CGPoint(x: end.x - cos(angle + 0.55) * length, y: end.y - sin(angle + 0.55) * length))
        context.stroke(arrow, with: .color(color), lineWidth: 1.3)
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

    private func districtIndex(for kind: String) -> Int {
        switch kind {
        case "principle", "product", "requirement", "decision", "flow": 0
        case "ui": 1
        case "service", "function", "integration": 2
        case "data", "database": 3
        case "test", "checkpoint", "risk": 4
        default: 2
        }
    }

    private struct PointKey: Hashable {
        let x: CGFloat
        let y: CGFloat
        init(_ point: CGPoint) { x = point.x; y = point.y }
    }
}

private struct CanvasFocusBridge: NSViewRepresentable {
    let target: CGPoint?
    let scale: CGFloat
    let requestID: UUID
    let viewportSize: CGSize
    let onScrollZoom: (CGFloat) -> Void

    final class Coordinator {
        var lastToken = ""
        var scrollMonitor: Any?
        var onScrollZoom: ((CGFloat) -> Void)?
    }

    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeNSView(context: Context) -> NSView { NSView(frame: .zero) }

    func updateNSView(_ nsView: NSView, context: Context) {
        context.coordinator.onScrollZoom = onScrollZoom
        if context.coordinator.scrollMonitor == nil {
            context.coordinator.scrollMonitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak nsView, weak coordinator = context.coordinator] event in
                guard event.modifierFlags.contains(.command), let scrollView = nsView?.enclosingScrollView, event.window === scrollView.window else { return event }
                let location = scrollView.convert(event.locationInWindow, from: nil)
                guard scrollView.bounds.contains(location) else { return event }
                coordinator?.onScrollZoom?(min(0.08, max(-0.08, event.scrollingDeltaY * 0.01)))
                return nil
            }
        }
        guard let target else { return }
        let token = "\(requestID.uuidString):\(Int(viewportSize.width)):\(Int(viewportSize.height)):\(Int(scale * 1000))"
        guard context.coordinator.lastToken != token else { return }
        context.coordinator.lastToken = token
        DispatchQueue.main.async {
            guard let scrollView = nsView.enclosingScrollView, let documentView = scrollView.documentView else { return }
            let viewport = scrollView.contentView.bounds.size
            let document = documentView.frame.size
            let proposed = CGPoint(x: target.x * scale - viewport.width / 2, y: target.y * scale - viewport.height / 2)
            let origin = CGPoint(
                x: min(max(0, proposed.x), max(0, document.width - viewport.width)),
                y: min(max(0, proposed.y), max(0, document.height - viewport.height))
            )
            NSAnimationContext.runAnimationGroup { animation in
                animation.duration = 0.26
                animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
                scrollView.contentView.animator().setBoundsOrigin(origin)
            }
            scrollView.reflectScrolledClipView(scrollView.contentView)
        }
    }

    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) {
        if let monitor = coordinator.scrollMonitor { NSEvent.removeMonitor(monitor) }
        coordinator.scrollMonitor = nil
    }
}
