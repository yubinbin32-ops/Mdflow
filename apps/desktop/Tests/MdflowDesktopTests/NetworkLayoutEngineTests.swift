import Foundation
import Testing
@testable import MdflowDesktop

@Test func overviewLayoutIsDeterministicAndAvoidsNodeOverlap() {
    let ids = (0..<48).map { "node-\($0)" }
    let edges = (1..<48).map { LayoutEdge(id: "edge-\($0)", sourceID: "node-\($0 / 2)", targetID: "node-\($0)") }
    let districts = Dictionary(uniqueKeysWithValues: ids.enumerated().map { ($1, $0 % 5) })
    let first = NetworkLayoutEngine.make(nodeIDs: ids, edges: edges, focusPaths: [], districts: districts, cardSize: CGSize(width: 196, height: 108), topInset: 190)
    let second = NetworkLayoutEngine.make(nodeIDs: ids, edges: edges, focusPaths: [], districts: districts, cardSize: CGSize(width: 196, height: 108), topInset: 190)
    #expect(first == second)
    #expect(overlaps(in: first, cardSize: CGSize(width: 196, height: 108)).isEmpty)
}

@Test func threeHundredBlockSyntheticGraphKeepsStableNonOverlappingLayout() {
    let ids = (0..<300).map { "large-\($0)" }
    let edges = (1..<300).map { index in
        LayoutEdge(id: "large-edge-\(index)", sourceID: "large-\(index - 1)", targetID: "large-\(index)")
    } + (0..<270).map { index in
        LayoutEdge(id: "cross-edge-\(index)", sourceID: "large-\(index)", targetID: "large-\(index + 30)")
    }
    let districts = Dictionary(uniqueKeysWithValues: ids.enumerated().map { ($1, $0 % 7) })
    let paths = stride(from: 0, to: 300, by: 30).map { start in
        (start..<min(start + 30, 300)).map { "large-\($0)" }
    }
    let first = NetworkLayoutEngine.make(nodeIDs: ids, edges: edges, focusPaths: paths, districts: districts, cardSize: CGSize(width: 196, height: 108), topInset: 190)
    let second = NetworkLayoutEngine.make(nodeIDs: ids, edges: edges, focusPaths: paths, districts: districts, cardSize: CGSize(width: 196, height: 108), topInset: 190)
    #expect(first.positions.count == 300)
    #expect(first == second)
    #expect(overlaps(in: first, cardSize: CGSize(width: 196, height: 108)).isEmpty)
}

@Test func threeHundredBlockOverviewRoutesAvoidUnrelatedBuildings() {
    let ids = (0..<300).map { "large-route-\($0)" }
    let edges = (1..<300).map { index in
        LayoutEdge(id: "large-route-edge-\(index)", sourceID: "large-route-\(index - 1)", targetID: "large-route-\(index)")
    } + (0..<270).map { index in
        LayoutEdge(id: "large-route-cross-\(index)", sourceID: "large-route-\(index)", targetID: "large-route-\(index + 30)")
    }
    let districts = Dictionary(uniqueKeysWithValues: ids.enumerated().map { ($1, $0 % 7) })
    let size = CGSize(width: 196, height: 108)
    let layout = NetworkLayoutEngine.make(
        nodeIDs: ids,
        edges: edges,
        focusPaths: [],
        districts: districts,
        cardSize: size,
        topInset: 190
    )
    for edge in edges {
        let route = layout.routes[edge.id] ?? []
        #expect(!route.isEmpty)
        for id in ids where id != edge.sourceID && id != edge.targetID {
            let building = CGRect(origin: layout.positions[id]!, size: size).insetBy(dx: -1, dy: -1)
            #expect(zip(route, route.dropFirst()).allSatisfy { !segment($0, $1, intersects: building) })
        }
    }
}

@Test func threeHundredBlockCyclicMultiChainOverviewKeepsCycleRoadsSafe() {
    let ids = (0..<300).map { "large-cycle-\($0)" }
    let chainEdges = (1..<300).map { index in
        LayoutEdge(id: "large-cycle-edge-\(index)", sourceID: "large-cycle-\(index - 1)", targetID: "large-cycle-\(index)")
    }
    let crossEdges = (0..<270).map { index in
        LayoutEdge(id: "large-cycle-cross-\(index)", sourceID: "large-cycle-\(index)", targetID: "large-cycle-\(index + 30)")
    }
    let cycleEdges = (0..<30).map { index in
        LayoutEdge(id: "large-cycle-back-\(index)", sourceID: "large-cycle-\(270 + index)", targetID: "large-cycle-\(index)")
    }
    let edges = chainEdges + crossEdges + cycleEdges
    let districts = Dictionary(uniqueKeysWithValues: ids.enumerated().map { ($1, $0 % 7) })
    let sharedChains = (0..<12).map { chain in
        stride(from: chain * 12, to: min(chain * 12 + 96, 300), by: 12).map { index in "large-cycle-\(index)" }
    }
    let first = NetworkLayoutEngine.make(
        nodeIDs: ids, edges: edges, focusPaths: sharedChains, districts: districts,
        cardSize: CGSize(width: 196, height: 108), topInset: 190
    )
    let second = NetworkLayoutEngine.make(
        nodeIDs: ids, edges: edges, focusPaths: sharedChains, districts: districts,
        cardSize: CGSize(width: 196, height: 108), topInset: 190
    )
    #expect(first == second)
    #expect(first.positions.count == ids.count)
    #expect(first.routes.count == edges.count)
    for edge in cycleEdges {
        let route = first.routes[edge.id] ?? []
        #expect(route.count > 1)
        #expect(zip(route, route.dropFirst()).allSatisfy { left, right in left.x == right.x || left.y == right.y })
        for id in ids where id != edge.sourceID && id != edge.targetID {
            let building = CGRect(origin: first.positions[id]!, size: CGSize(width: 196, height: 108)).insetBy(dx: -1, dy: -1)
            #expect(zip(route, route.dropFirst()).allSatisfy { !segment($0, $1, intersects: building) })
        }
    }
}

@Test func threeHundredBlockCyclicOverviewRemainsStableAcrossRepeatedRefreshes() {
    let ids = (0..<300).map { "large-endurance-\($0)" }
    let chainEdges = (1..<300).map { index in
        LayoutEdge(id: "large-endurance-edge-\(index)", sourceID: "large-endurance-\(index - 1)", targetID: "large-endurance-\(index)")
    }
    let crossEdges = (0..<270).map { index in
        LayoutEdge(id: "large-endurance-cross-\(index)", sourceID: "large-endurance-\(index)", targetID: "large-endurance-\(index + 30)")
    }
    let cycleEdges = (0..<30).map { index in
        LayoutEdge(id: "large-endurance-back-\(index)", sourceID: "large-endurance-\(270 + index)", targetID: "large-endurance-\(index)")
    }
    let edges = chainEdges + crossEdges + cycleEdges
    let districts = Dictionary(uniqueKeysWithValues: ids.enumerated().map { ($1, $0 % 7) })
    let paths = (0..<12).map { chain in
        stride(from: chain * 12, to: min(chain * 12 + 96, 300), by: 12).map { index in "large-endurance-\(index)" }
    }
    let started = Date()
    var first: NetworkLayoutSnapshot?
    for _ in 0..<3 {
        let layout = NetworkLayoutEngine.make(
            nodeIDs: ids, edges: edges, focusPaths: paths, districts: districts,
            cardSize: CGSize(width: 196, height: 108), topInset: 190
        )
        #expect(layout.positions.count == 300)
        #expect(layout.routes.count == edges.count)
        if let first { #expect(layout == first) } else { first = layout }
    }
    // This is a regression guard for repeated live-refresh work, not a claim
    // that a unit test replaces a long-running real-target memory soak.
    #expect(Date().timeIntervalSince(started) < 45)
}

@Test func threeHundredBlockSixChain599LinkOverviewHasNoRoadBuildingConflicts() {
    let ids = (0..<300).map { "real-target-\($0)" }
    let forward = (0..<299).map { index in
        LayoutEdge(id: "real-target-fwd-\(index)", sourceID: ids[index], targetID: ids[index + 1])
    }
    let reverse = (0..<299).map { index in
        LayoutEdge(id: "real-target-rev-\(index)", sourceID: ids[index + 1], targetID: ids[index])
    }
    let loop = LayoutEdge(id: "real-target-loop", sourceID: ids[299], targetID: ids[0])
    let edges = forward + reverse + [loop]
    let paths = [
        Array(ids[0..<100]),
        Array(ids[100..<200]),
        Array(ids[200..<300]),
        Array(ids[0..<100].reversed()),
        Array(ids[100..<200].reversed()),
        Array(ids[200..<300].reversed()),
    ]
    let size = CGSize(width: 196, height: 108)
    let started = Date()
    let layout = NetworkLayoutEngine.make(
        nodeIDs: ids,
        edges: edges,
        focusPaths: paths,
        districts: Dictionary(uniqueKeysWithValues: ids.enumerated().map { ($1, $0 % 9) }),
        cardSize: size,
        topInset: 190
    )
    #expect(layout.positions.count == 300)
    #expect(layout.routes.count == 599)
    for edge in edges {
        let route = layout.routes[edge.id] ?? []
        #expect(route.count > 1)
        #expect(zip(route, route.dropFirst()).allSatisfy { left, right in
            left.x == right.x || left.y == right.y
        })
        for id in ids where id != edge.sourceID && id != edge.targetID {
            let building = CGRect(origin: layout.positions[id]!, size: size).insetBy(dx: -1, dy: -1)
            #expect(zip(route, route.dropFirst()).allSatisfy { !segment($0, $1, intersects: building) })
        }
    }
    #expect(Date().timeIntervalSince(started) < 60)
}

@Test func orderedChainCreatesACompactTurningPrimaryRoad() {
    let ids = ["start", "ui", "service", "data", "test"]
    let edges = [
        LayoutEdge(id: "one", sourceID: "start", targetID: "ui"),
        LayoutEdge(id: "two", sourceID: "ui", targetID: "service"),
        LayoutEdge(id: "three", sourceID: "service", targetID: "data"),
        LayoutEdge(id: "four", sourceID: "data", targetID: "test"),
    ]
    let districts = ["start": 0, "ui": 1, "service": 2, "data": 3, "test": 4]
    let size = CGSize(width: 196, height: 108)
    let layout = NetworkLayoutEngine.make(nodeIDs: ids, edges: edges, focusPaths: [ids], districts: districts, cardSize: size, topInset: 190)
    let positions = ids.compactMap { layout.positions[$0] }
    #expect(positions.count == ids.count)
    #expect(zip(positions, positions.dropFirst()).allSatisfy { left, right in
        let horizontalNeighbor = abs(left.x - right.x) == size.width + NetworkLayoutEngine.horizontalStreetWidth && left.y == right.y
        let verticalNeighbor = abs(left.y - right.y) == size.height + NetworkLayoutEngine.verticalStreetWidth && left.x == right.x
        return horizontalNeighbor || verticalNeighbor
    })
    #expect(Set(positions.map(\.y)).count > 1)
}

@Test func focusedLayoutKeepsTheGlobalNetworkStableAndTheChainOrdered() {
    let path = ["a", "b", "c", "d", "e", "f", "g", "h"]
    let ids = path + (0..<24).map { "other-\($0)" }
    let pathEdges = zip(path, path.dropFirst()).enumerated().map {
        LayoutEdge(id: "path-\($0.offset)", sourceID: $0.element.0, targetID: $0.element.1)
    }
    let otherEdges = (0..<24).map {
        LayoutEdge(id: "other-edge-\($0)", sourceID: path[$0 % path.count], targetID: "other-\($0)")
    }
    let size = CGSize(width: 196, height: 108)
    let overview = NetworkLayoutEngine.make(nodeIDs: ids, edges: pathEdges + otherEdges, focusPaths: [path], cardSize: size, topInset: 190)
    let focused = NetworkLayoutEngine.make(nodeIDs: ids, edges: pathEdges + otherEdges, focusPaths: [path], cardSize: size, topInset: 190)

    #expect(overview.positions == focused.positions)
    #expect(overlaps(in: focused, cardSize: size).isEmpty)
}

@Test func scopeAndArchitectureMetadataNeverCreateSpatialBands() {
    let ids = ["web", "api", "domain", "database", "provider"]
    let edges = [
        LayoutEdge(id: "request", sourceID: "web", targetID: "api"),
        LayoutEdge(id: "command", sourceID: "api", targetID: "domain"),
        LayoutEdge(id: "write", sourceID: "domain", targetID: "database"),
        LayoutEdge(id: "callback", sourceID: "provider", targetID: "api"),
        LayoutEdge(id: "cycle", sourceID: "database", targetID: "domain"),
    ]
    let metadata = Dictionary(uniqueKeysWithValues: ids.enumerated().map {
        ($1, LayoutNodeMetadata(layer: $0, scope: $0 < 4 ? "orders" : "payments", order: $0))
    })
    let layout = NetworkLayoutEngine.make(
        nodeIDs: ids, edges: edges, focusPaths: [], metadata: metadata,
        cardSize: CGSize(width: 196, height: 108), topInset: 74
    )
    let changedMetadata = Dictionary(uniqueKeysWithValues: ids.enumerated().map {
        ($1, LayoutNodeMetadata(layer: 7 - $0, scope: "different-\($0)", order: $0))
    })
    let changed = NetworkLayoutEngine.make(
        nodeIDs: ids, edges: edges, focusPaths: [], metadata: changedMetadata,
        cardSize: CGSize(width: 196, height: 108), topInset: 74
    )
    #expect(layout.scopeBands.isEmpty)
    #expect(layout.layerBands.isEmpty)
    #expect(layout.positions == changed.positions)
    #expect(overlaps(in: layout, cardSize: CGSize(width: 196, height: 108)).isEmpty)
}

@Test func linkRoutesReceiveStableSeparateLanes() {
    let lanes = (0..<24).map { NetworkLayoutEngine.routeLane(index: $0, count: 24) }
    #expect(Set(lanes).count == 24)
    #expect(lanes == lanes.sorted())
}

@Test func oppositeDirectionLinksReceiveDistinctParallelLanes() {
    let size = CGSize(width: 196, height: 108)
    let edges = [
        LayoutEdge(id: "forward", sourceID: "a", targetID: "b"),
        LayoutEdge(id: "reverse", sourceID: "b", targetID: "a"),
    ]
    let layout = NetworkLayoutEngine.make(
        nodeIDs: ["a", "b"], edges: edges, focusPaths: [["a", "b"], ["b", "a"]],
        cardSize: size, topInset: 190
    )
    let forward = Set(zip(layout.routes["forward"] ?? [], (layout.routes["forward"] ?? []).dropFirst()).map(Segment.init))
    let reverse = Set(zip(layout.routes["reverse"] ?? [], (layout.routes["reverse"] ?? []).dropFirst()).map(Segment.init))
    #expect(!forward.isEmpty)
    #expect(!reverse.isEmpty)
    #expect(forward.isDisjoint(with: reverse))
}

@Test func streetRoutesUseOnlyRightAngleSegments() {
    let points = NetworkLayoutEngine.orthogonalRoute(
        source: CGPoint(x: 96, y: 190),
        target: CGPoint(x: 752, y: 590),
        cardSize: CGSize(width: 196, height: 108),
        lane: 7
    )
    #expect(points.count >= 2)
    #expect(zip(points, points.dropFirst()).allSatisfy { left, right in
        left.x == right.x || left.y == right.y
    })
}

@Test func alignedBuildingsUseOneDirectRoadWithoutDecorativeBends() {
    let horizontal = NetworkLayoutEngine.orthogonalRoute(
        source: CGPoint(x: 40, y: 100), target: CGPoint(x: 400, y: 100),
        cardSize: CGSize(width: 196, height: 108), lane: 0
    )
    #expect(horizontal.count == 2)
    #expect(horizontal[0].y == horizontal[1].y)

    let vertical = NetworkLayoutEngine.orthogonalRoute(
        source: CGPoint(x: 100, y: 40), target: CGPoint(x: 100, y: 400),
        cardSize: CGSize(width: 196, height: 108), lane: 0
    )
    #expect(vertical.count == 2)
    #expect(vertical[0].x == vertical[1].x)
}

@Test func separateStreetLanesNeverCoverTheSameSegment() {
    let source = CGPoint(x: 96, y: 190)
    let target = CGPoint(x: 752, y: 590)
    let first = NetworkLayoutEngine.orthogonalRoute(source: source, target: target, cardSize: CGSize(width: 196, height: 108), lane: -9)
    let second = NetworkLayoutEngine.orthogonalRoute(source: source, target: target, cardSize: CGSize(width: 196, height: 108), lane: 9)
    let firstSegments = Set(zip(first, first.dropFirst()).map { Segment($0, $1) })
    let secondSegments = Set(zip(second, second.dropFirst()).map { Segment($0, $1) })
    #expect(firstSegments.isDisjoint(with: secondSegments))
}

@Test func cityStreetRoutesAvoidUnrelatedBuildings() {
    let ids = ["foundation", "interface", "runtime", "data", "quality"]
    let edges = [
        LayoutEdge(id: "foundation-runtime", sourceID: "foundation", targetID: "runtime"),
        LayoutEdge(id: "interface-data", sourceID: "interface", targetID: "data"),
        LayoutEdge(id: "runtime-quality", sourceID: "runtime", targetID: "quality"),
    ]
    let districts = ["foundation": 0, "interface": 1, "runtime": 2, "data": 3, "quality": 4]
    let size = CGSize(width: 196, height: 108)
    let layout = NetworkLayoutEngine.make(nodeIDs: ids, edges: edges, focusPaths: [], districts: districts, cardSize: size, topInset: 190)
    for edge in edges {
        let route = layout.routes[edge.id] ?? []
        #expect(!route.isEmpty)
        for id in ids where id != edge.sourceID && id != edge.targetID {
            let building = CGRect(origin: layout.positions[id]!, size: size).insetBy(dx: -1, dy: -1)
            #expect(zip(route, route.dropFirst()).allSatisfy { !segment($0, $1, intersects: building) })
        }
    }
}

private func overlaps(in layout: NetworkLayoutSnapshot, cardSize: CGSize) -> [(String, String)] {
    let entries = layout.positions.sorted { $0.key < $1.key }
    var result: [(String, String)] = []
    for left in entries.indices {
        for right in entries.indices where right > left {
            let lhs = CGRect(origin: entries[left].value, size: cardSize).insetBy(dx: -12, dy: -12)
            let rhs = CGRect(origin: entries[right].value, size: cardSize).insetBy(dx: -12, dy: -12)
            if lhs.intersects(rhs) { result.append((entries[left].key, entries[right].key)) }
        }
    }
    return result
}

private struct Segment: Hashable {
    let first: CGPoint
    let second: CGPoint

    init(_ first: CGPoint, _ second: CGPoint) {
        if first.x < second.x || (first.x == second.x && first.y <= second.y) {
            self.first = first
            self.second = second
        } else {
            self.first = second
            self.second = first
        }
    }
}

private func segment(_ first: CGPoint, _ second: CGPoint, intersects rect: CGRect) -> Bool {
    if first.x == second.x {
        return first.x > rect.minX && first.x < rect.maxX &&
            max(first.y, second.y) > rect.minY && min(first.y, second.y) < rect.maxY
    }
    return first.y > rect.minY && first.y < rect.maxY &&
        max(first.x, second.x) > rect.minX && min(first.x, second.x) < rect.maxX
}
