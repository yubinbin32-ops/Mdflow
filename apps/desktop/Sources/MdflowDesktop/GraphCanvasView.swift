import AppKit
import SwiftUI

struct GraphCanvasView: View {
    @ObservedObject var store: GraphStore
    @State private var gestureStartScale: CGFloat?
    @State private var manualFocusPoint: CGPoint?
    @State private var manualFocusID = UUID()
    @State private var didFitOverview = false

    private let networkTop: CGFloat = 74

    private var cardSize: CGSize {
        visibleNetworkBlocks.count > 30 ? CGSize(width: 166, height: 88) : CGSize(width: 196, height: 108)
    }

    var body: some View {
        GeometryReader { viewport in
            ZStack(alignment: .topLeading) {
                ScrollView([.horizontal, .vertical]) {
                    let currentLayout = layout
                    ZStack(alignment: .topLeading) {
                    ZStack(alignment: .topLeading) {
                        Color.clear
                            .contentShape(Rectangle())
                        dotGrid
                        chainEnclosureLayer(currentLayout)
                        linkLayer(currentLayout)
                        chainRouteLayer(currentLayout)
                        junctionLayer(currentLayout)
                        chainHitLayer(currentLayout)
                        blockLayer(currentLayout)
                        inlineChainLabels(currentLayout)
                    }
                    .frame(width: currentLayout.size.width, height: currentLayout.size.height, alignment: .topLeading)
                    .simultaneousGesture(
                        SpatialTapGesture().onEnded { value in
                            if !isInteractiveCanvasPoint(value.location, layout: currentLayout) {
                                store.showOverview()
                            }
                        }
                    )
                    .scaleEffect(store.canvasScale, anchor: .topLeading)
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
                focusBar
            }
            .onAppear {
                guard !didFitOverview else { return }
                didFitOverview = true
                DispatchQueue.main.async { fitOverview(in: layout, viewport: viewport.size) }
            }
            .onChange(of: store.overviewFitRequestID) { fitOverview(in: layout, viewport: viewport.size) }
            .onChange(of: store.snapshot.project.id) {
                manualFocusPoint = nil
                DispatchQueue.main.async {
                    if store.focusTarget != nil {
                        fitFocusedSelection(in: layout, viewport: viewport.size)
                    } else {
                        fitOverview(in: layout, viewport: viewport.size)
                    }
                }
            }
            .onChange(of: store.focusRequestID) {
                manualFocusPoint = nil
                fitFocusedSelection(in: layout, viewport: viewport.size)
            }
            .onChange(of: viewport.size) {
                if store.focusTarget != nil {
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
            .onExitCommand { store.exitFocus() }
        }
    }

    private var backgroundBlockIDs: Set<String> {
        Set(store.snapshot.backgroundScopes.map(\.blockId))
    }

    private var visibleNetworkBlocks: [BlockItem] {
        store.visibleBlocks.filter { !backgroundBlockIDs.contains($0.id) }
    }

    private var visibleEdges: [LinkItem] {
        let ids = Set(visibleNetworkBlocks.map(\.id))
        return store.snapshot.links.filter {
            $0.sourceType == "block" && $0.targetType == "block" && ids.contains($0.sourceId) && ids.contains($0.targetId)
        }
    }

    private var layout: NetworkLayoutSnapshot {
        NetworkLayoutEngine.make(
            nodeIDs: visibleNetworkBlocks.map(\.id),
            edges: visibleEdges.map { LayoutEdge(id: $0.id, sourceID: $0.sourceId, targetID: $0.targetId) },
            focusPaths: store.snapshot.chains.map { store.chainNodeIDs($0.id) },
            districts: Dictionary(uniqueKeysWithValues: visibleNetworkBlocks.map { ($0.id, districtIndex(for: $0.kind)) }),
            metadata: Dictionary(uniqueKeysWithValues: visibleNetworkBlocks.map {
                ($0.id, LayoutNodeMetadata(layer: architectureIndex(for: $0), scope: $0.scope, order: $0.localOrder))
            }),
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

    private func districtLayer(_ layout: NetworkLayoutSnapshot) -> some View {
        ZStack(alignment: .topLeading) {
            ForEach(layout.scopeBands) { band in
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(MdflowTheme.surface.opacity(0.22))
                    .overlay(RoundedRectangle(cornerRadius: 20).stroke(MdflowTheme.hairline.opacity(0.6)))
                    .frame(width: band.frame.width, height: band.frame.height)
                    .position(x: band.frame.midX, y: band.frame.midY)
                Text(band.title.uppercased())
                    .font(.system(size: 8.5, weight: .bold, design: .monospaced))
                    .tracking(1.2)
                    .foregroundStyle(MdflowTheme.muted)
                    .position(x: band.frame.minX + 54, y: band.frame.minY + 14)
            }
            ForEach(layout.layerBands) { band in
                Text(architectureTitle(Int(band.id) ?? 3).uppercased())
                    .font(.system(size: 8, weight: .bold, design: .monospaced))
                    .tracking(1.1)
                    .foregroundStyle(MdflowTheme.muted.opacity(0.8))
                    .position(x: band.frame.midX, y: band.frame.minY + 10)
            }
        }
        .allowsHitTesting(false)
    }

    private func linkLayer(_ layout: NetworkLayoutSnapshot) -> some View {
        Canvas { context, _ in
            for edge in visibleEdges {
                guard let points = layout.routes[edge.id], points.count > 1 else { continue }
                let related = edgeIsRelatedToFocus(edge)
                let opacity: Double = store.focusTarget == nil ? 0.34 : related ? 0.58 : store.isolateFocused ? 0 : 0.06
                let path = streetPath(points)
                context.stroke(
                    path,
                    with: .color(MdflowTheme.healthColor(edge.healthState).opacity(opacity)),
                    style: StrokeStyle(lineWidth: 1.35, lineCap: .square, lineJoin: .miter)
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
                    let related = edgeIsRelatedToFocus(edge)
                    let highlighted = store.highlightedChainIDs.contains(chainID)
                    let hasFocus = !store.highlightedChainIDs.isEmpty
                    let opacity: Double = !related && store.focusTarget != nil ? (store.isolateFocused ? 0 : 0.035) : highlighted ? 0.98 : hasFocus ? 0.08 : 0.48
                    let offset = NetworkLayoutEngine.routeLane(index: index, count: memberships.count, maximumSpread: 10)
                    let path = streetPath(offsetPath(points, by: offset))
                    context.stroke(
                        path,
                        with: .color(store.chainColor(chainID).opacity(opacity)),
                        style: StrokeStyle(lineWidth: highlighted ? 3.1 : 1.7, lineCap: .square, lineJoin: .round)
                    )
                    drawDirectionMarker(context: &context, points: offsetPath(points, by: offset), color: store.chainColor(chainID).opacity(opacity))
                }
            }
        }
        .allowsHitTesting(false)
    }

    private func chainEnclosureLayer(_ layout: NetworkLayoutSnapshot) -> some View {
        Canvas { context, _ in
            let orderedChains = store.snapshot.chains.sorted { $0.id < $1.id }
            for chain in orderedChains {
                let highlighted = store.highlightedChainIDs.contains(chain.id)
                let hasFocus = !store.highlightedChainIDs.isEmpty
                let color = store.chainColor(chain.id)
                let baseOpacity: Double = highlighted ? 0.15 : hasFocus ? 0.018 : 0.055
                let borderOpacity: Double = highlighted ? 0.82 : hasFocus ? 0.05 : 0.2
                let linkIDs = store.snapshot.chainEdges
                    .filter { $0.chainId == chain.id }
                    .sorted { $0.position < $1.position }
                    .map(\.linkId)

                for linkID in linkIDs {
                    guard let points = layout.routes[linkID], points.count > 1 else { continue }
                    let memberships = chainIDs(for: linkID)
                    let index = memberships.firstIndex(of: chain.id) ?? 0
                    let offset = NetworkLayoutEngine.routeLane(index: index, count: memberships.count, maximumSpread: 12)
                    let routed = offsetPath(points, by: offset)
                    let path = streetPath(routed)
                    context.stroke(path, with: .color(color.opacity(baseOpacity)), style: StrokeStyle(lineWidth: highlighted ? 22 : 17, lineCap: .round, lineJoin: .round))
                    context.stroke(path, with: .color(color.opacity(borderOpacity)), style: StrokeStyle(lineWidth: highlighted ? 2.2 : 1.2, lineCap: .round, lineJoin: .round))
                }

                let nodeIDs = store.chainNodeIDs(chain.id)
                for nodeID in nodeIDs {
                    guard let origin = layout.positions[nodeID] else { continue }
                    let memberships = store.chains(containing: nodeID).map(\.id)
                    let lane = memberships.firstIndex(of: chain.id) ?? 0
                    let expansion = CGFloat(8 + lane * 4)
                    let frame = CGRect(origin: origin, size: cardSize).insetBy(dx: -expansion, dy: -expansion)
                    let outline = Path(roundedRect: frame, cornerRadius: 18 + expansion / 2)
                    context.fill(outline, with: .color(color.opacity(baseOpacity * 0.58)))
                    if highlighted {
                        context.stroke(outline, with: .color(color.opacity(borderOpacity)), lineWidth: 2.2)
                    }
                }
            }
        }
        .allowsHitTesting(false)
    }

    private func chainHitLayer(_ layout: NetworkLayoutSnapshot) -> some View {
        ZStack(alignment: .topLeading) {
            ForEach(store.snapshot.chains) { chain in
                let linkIDs = store.snapshot.chainEdges
                    .filter { $0.chainId == chain.id }
                    .sorted { $0.position < $1.position }
                    .map(\.linkId)
                ForEach(linkIDs, id: \.self) { linkID in
                    if let points = layout.routes[linkID], points.count > 1 {
                        let memberships = chainIDs(for: linkID)
                        let index = memberships.firstIndex(of: chain.id) ?? 0
                        let offset = NetworkLayoutEngine.routeLane(index: index, count: memberships.count, maximumSpread: 12)
                        let hitPath = streetPath(offsetPath(points, by: offset))
                        hitPath
                            .stroke(Color.black.opacity(0.001), style: StrokeStyle(lineWidth: 22, lineCap: .round, lineJoin: .round))
                            .contentShape(hitPath.strokedPath(StrokeStyle(lineWidth: 24, lineCap: .round, lineJoin: .round)))
                            .onTapGesture { store.select(GraphSelection(type: .chain, id: chain.id)) }
                            .help(store.chainText(chain, field: "title"))
                    }
                }
            }
        }
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
                    .opacity(store.focusTarget == nil || store.isRelatedToFocus(block.id) ? 1 : store.isolateFocused ? 0 : 0.11)
                    .allowsHitTesting(store.focusTarget == nil || store.isRelatedToFocus(block.id) || !store.isolateFocused)
                    .position(x: point.x + cardSize.width / 2, y: point.y + cardSize.height / 2)
            }
        }
    }

    @ViewBuilder
    private func inlineChainLabels(_ layout: NetworkLayoutSnapshot) -> some View {
        let anchors = chainLabelAnchors(layout)
        ForEach(store.snapshot.chains) { chain in
            if store.canvasScale >= 0.72,
               (store.highlightedChainIDs.isEmpty || store.highlightedChainIDs.contains(chain.id)),
               let anchor = anchors[chain.id] {
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
    private var focusBar: some View {
        if let target = store.focusTarget {
            HStack(spacing: 9) {
                Image(systemName: "scope")
                    .foregroundStyle(MdflowTheme.focus)
                Text(store.text("focusMode").uppercased())
                    .font(.system(size: 8, weight: .bold, design: .monospaced))
                    .tracking(1)
                    .foregroundStyle(MdflowTheme.muted)
                Text(store.title(for: target))
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .lineLimit(1)
                Toggle(store.text("isolate"), isOn: $store.isolateFocused)
                    .toggleStyle(.checkbox)
                    .font(.system(size: 10, weight: .medium, design: .rounded))
                Button { store.exitFocus() } label: {
                    Label(store.text("exitFocus"), systemImage: "xmark")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .keyboardShortcut(.escape, modifiers: [])
            }
            .padding(.horizontal, 11)
            .frame(height: 36)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(Capsule().stroke(MdflowTheme.hairline))
            .padding(14)
            .transition(.move(edge: .top).combined(with: .opacity))
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
        let typeColor = MdflowTheme.blockKindColor(block.kind)
        let semanticCompact = store.canvasScale < 0.72 || visibleNetworkBlocks.count > 30
        let ultraCompact = store.canvasScale < 0.55
        let buildingShape = BlockBuildingShape(kind: block.kind)

        return VStack(alignment: .leading, spacing: ultraCompact ? 5 : semanticCompact ? 8 : 7) {
                HStack(spacing: 7) {
                    Image(systemName: blockSymbol(block.kind))
                        .font(.system(size: ultraCompact ? 11 : 9, weight: .semibold))
                        .foregroundStyle(typeColor)
                        .frame(width: ultraCompact ? 20 : 22, height: ultraCompact ? 20 : 22)
                        .background(typeColor.opacity(0.1), in: Circle())
                    if !ultraCompact {
                        Text(block.kind.uppercased())
                            .font(.system(size: 8, weight: .bold, design: .monospaced))
                            .tracking(1.1)
                            .foregroundStyle(MdflowTheme.muted)
                    }
                    Spacer()
                    Circle().fill(stateColor).frame(width: 7, height: 7)
                        .accessibilityLabel(block.deliveryState)
                }
                Text(store.blockText(block, field: "title"))
                    .font(.system(size: ultraCompact ? 17 : semanticCompact ? 14 : 12.5, weight: .semibold, design: .rounded))
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
                    if !ultraCompact {
                        Text(block.deliveryState.uppercased())
                            .font(.system(size: 7.5, weight: .bold, design: .monospaced))
                            .tracking(0.7)
                            .foregroundStyle(stateColor)
                    }
                }
        }
        .padding(semanticCompact ? 8 : 11)
        .frame(width: cardSize.width, height: cardSize.height, alignment: .topLeading)
        .background(
            buildingShape
                .fill(MdflowTheme.surface)
                .overlay(buildingShape.fill(typeColor.opacity(0.022)))
                .overlay(buildingShape.stroke(changed || selected ? MdflowTheme.focus : typeColor.opacity(0.24), lineWidth: changed ? 3 : selected ? 2 : 1))
        )
        .shadow(color: .black.opacity(selected ? 0.1 : 0.035), radius: selected ? 15 : 6, y: 3)
        .contentShape(buildingShape)
        .onTapGesture(count: 2) { store.magnify(selection) }
        .onTapGesture { store.select(selection) }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { store.select(selection) }
        .animation(.easeOut(duration: 0.22), value: changed)
    }

    private func fitFocusedSelection(in layout: NetworkLayoutSnapshot, viewport: CGSize) {
        guard let target = store.focusTarget, let bounds = focusBounds(for: target, layout: layout) else { return }
        let horizontal = (viewport.width - 96) / max(bounds.width, 1)
        let vertical = (viewport.height - 96) / max(bounds.height, 1)
        store.setZoom(max(0.32, min(1.18, horizontal, vertical)))
    }

    private func fitOverview(in layout: NetworkLayoutSnapshot, viewport: CGSize) {
        let horizontal = (viewport.width - 64) / max(layout.size.width, 1)
        let vertical = (viewport.height - 64) / max(layout.size.height, 1)
        store.setZoom(min(1, max(0.25, min(horizontal, vertical))))
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

    private func isInteractiveCanvasPoint(_ point: CGPoint, layout: NetworkLayoutSnapshot) -> Bool {
        if layout.positions.values.contains(where: {
            CGRect(origin: $0, size: cardSize).insetBy(dx: -12, dy: -12).contains(point)
        }) { return true }
        for chain in store.snapshot.chains {
            let linkIDs = store.snapshot.chainEdges.filter { $0.chainId == chain.id }.map(\.linkId)
            for linkID in linkIDs {
                guard let points = layout.routes[linkID] else { continue }
                if zip(points, points.dropFirst()).contains(where: { distance(from: point, to: $0, and: $1) <= 14 }) {
                    return true
                }
            }
        }
        return false
    }

    private func distance(from point: CGPoint, to start: CGPoint, and end: CGPoint) -> CGFloat {
        if start.x == end.x {
            let y = min(max(point.y, min(start.y, end.y)), max(start.y, end.y))
            return hypot(point.x - start.x, point.y - y)
        }
        let x = min(max(point.x, min(start.x, end.x)), max(start.x, end.x))
        return hypot(point.x - x, point.y - start.y)
    }

    private func edgeIsRelatedToFocus(_ edge: LinkItem) -> Bool {
        guard let target = store.focusTarget else { return true }
        let ids = store.relatedBlockIDs(for: target)
        return ids.contains(edge.sourceId) && ids.contains(edge.targetId)
    }

    private func chainLabelAnchors(_ layout: NetworkLayoutSnapshot) -> [String: CGPoint] {
        let blockFrames = layout.positions.values.map { CGRect(origin: $0, size: cardSize).insetBy(dx: -5, dy: -5) }
        var occupied: [CGRect] = []
        var result: [String: CGPoint] = [:]
        for chain in store.snapshot.chains.sorted(by: { $0.id < $1.id }) {
            let label = store.chainText(chain, field: "title")
            let width = min(190, max(62, CGFloat(label.count) * 7 + 34))
            let linkIDs = store.snapshot.chainEdges.filter { $0.chainId == chain.id }.sorted { $0.position < $1.position }.map(\.linkId)
            var candidates: [(CGFloat, CGPoint)] = []
            for linkID in linkIDs {
                guard let points = layout.routes[linkID] else { continue }
                for (start, end) in zip(points, points.dropFirst()) where start.y == end.y {
                    let length = abs(end.x - start.x)
                    guard length >= width + 12 else { continue }
                    let centerX = (start.x + end.x) / 2
                    candidates.append((length, CGPoint(x: centerX, y: start.y - 12)))
                    candidates.append((length - 1, CGPoint(x: centerX, y: start.y + 12)))
                }
            }
            for (_, point) in candidates.sorted(by: { $0.0 > $1.0 }) {
                let frame = CGRect(x: point.x - width / 2, y: point.y - 9, width: width, height: 18)
                guard !blockFrames.contains(where: { $0.intersects(frame) }),
                      !occupied.contains(where: { $0.intersects(frame) }) else { continue }
                result[chain.id] = point
                occupied.append(frame.insetBy(dx: -6, dy: -4))
                break
            }
        }
        return result
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
        let normals = zip(points, points.dropFirst()).map { normal(from: $0, to: $1) }
        return points.indices.map { index in
            if index == 0 {
                return CGPoint(x: points[index].x + normals[0].x * amount, y: points[index].y + normals[0].y * amount)
            }
            if index == points.count - 1 {
                let value = normals[index - 1]
                return CGPoint(x: points[index].x + value.x * amount, y: points[index].y + value.y * amount)
            }
            let previous = normals[index - 1]
            let next = normals[index]
            // Intersect the two offset orthogonal segments. Averaging their
            // normals would create a diagonal micro-segment at every corner.
            let xNormal = previous.x != 0 ? previous.x : next.x
            let yNormal = previous.y != 0 ? previous.y : next.y
            return CGPoint(x: points[index].x + xNormal * amount, y: points[index].y + yNormal * amount)
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

    private func drawDirectionMarker(context: inout GraphicsContext, points: [CGPoint], color: Color) {
        guard let segment = zip(points, points.dropFirst()).max(by: {
            abs($0.1.x - $0.0.x) + abs($0.1.y - $0.0.y) < abs($1.1.x - $1.0.x) + abs($1.1.y - $1.0.y)
        }) else { return }
        let midpoint = CGPoint(x: (segment.0.x + segment.1.x) / 2, y: (segment.0.y + segment.1.y) / 2)
        let angle = atan2(segment.1.y - segment.0.y, segment.1.x - segment.0.x)
        let size: CGFloat = 5
        var chevron = Path()
        chevron.move(to: CGPoint(x: midpoint.x - cos(angle - 0.7) * size, y: midpoint.y - sin(angle - 0.7) * size))
        chevron.addLine(to: midpoint)
        chevron.addLine(to: CGPoint(x: midpoint.x - cos(angle + 0.7) * size, y: midpoint.y - sin(angle + 0.7) * size))
        context.stroke(chevron, with: .color(color), style: StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
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

    private func architectureIndex(for block: BlockItem) -> Int {
        switch block.architectureLayer {
        case "client": 0
        case "boundary": 1
        case "application": 2
        case "domain": 3
        case "data": 4
        case "external": 5
        case "quality": 6
        case "infrastructure": 7
        default:
            switch block.kind {
            case "ui", "flow": 0
            case "integration": 1
            case "service", "function": 2
            case "data", "database": 4
            case "test", "checkpoint", "risk": 6
            default: 3
            }
        }
    }

    private func architectureTitle(_ index: Int) -> String {
        let zh = ["客户端", "边界 / API", "应用服务", "领域核心", "数据", "外部系统", "质量保障", "基础设施"]
        let en = ["Client", "Boundary / API", "Application", "Domain", "Data", "External", "Quality", "Infrastructure"]
        let values = store.activeLocale == "zh-Hans" ? zh : en
        return values.indices.contains(index) ? values[index] : (store.activeLocale == "zh-Hans" ? "未分类" : "Unclassified")
    }

    private struct PointKey: Hashable {
        let x: CGFloat
        let y: CGFloat
        init(_ point: CGPoint) { x = point.x; y = point.y }
    }
}

private struct BlockBuildingShape: Shape {
    let kind: String

    func path(in rect: CGRect) -> Path {
        switch kind {
        case "service", "function":
            let cut: CGFloat = 11
            var path = Path()
            path.move(to: CGPoint(x: rect.minX + cut, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.maxX - cut, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY + cut))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - cut))
            path.addLine(to: CGPoint(x: rect.maxX - cut, y: rect.maxY))
            path.addLine(to: CGPoint(x: rect.minX + cut, y: rect.maxY))
            path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY - cut))
            path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + cut))
            path.closeSubpath()
            return path
        case "integration":
            let cut: CGFloat = 16
            var path = Path()
            path.move(to: CGPoint(x: rect.minX + cut, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.maxX - cut, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
            path.addLine(to: CGPoint(x: rect.maxX - cut, y: rect.maxY))
            path.addLine(to: CGPoint(x: rect.minX + cut, y: rect.maxY))
            path.addLine(to: CGPoint(x: rect.minX, y: rect.midY))
            path.closeSubpath()
            return path
        case "data", "database":
            return Path(roundedRect: rect, cornerRadius: 7)
        case "test", "checkpoint":
            let cut: CGFloat = 9
            var path = Path()
            path.move(to: CGPoint(x: rect.minX + cut, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - cut))
            path.addLine(to: CGPoint(x: rect.maxX - cut, y: rect.maxY))
            path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
            path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + cut))
            path.closeSubpath()
            return path
        case "risk":
            let cut: CGFloat = 14
            var path = Path()
            path.move(to: CGPoint(x: rect.minX + cut, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.maxX - cut, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY + cut))
            path.addLine(to: CGPoint(x: rect.maxX - cut, y: rect.maxY))
            path.addLine(to: CGPoint(x: rect.minX + cut, y: rect.maxY))
            path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + cut))
            path.closeSubpath()
            return path
        case "principle", "decision", "requirement", "product":
            return Path(roundedRect: rect, cornerRadius: 24)
        default:
            return Path(roundedRect: rect, cornerRadius: 16)
        }
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
