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

@Test func overviewLayoutUsesOrderedStagesAndDistrictStreets() {
    let ids = ["start", "ui", "service", "data", "test"]
    let edges = [
        LayoutEdge(id: "one", sourceID: "start", targetID: "ui"),
        LayoutEdge(id: "two", sourceID: "ui", targetID: "service"),
        LayoutEdge(id: "three", sourceID: "service", targetID: "data"),
        LayoutEdge(id: "four", sourceID: "data", targetID: "test"),
    ]
    let districts = ["start": 0, "ui": 1, "service": 2, "data": 3, "test": 4]
    let layout = NetworkLayoutEngine.make(nodeIDs: ids, edges: edges, focusPaths: [], districts: districts, cardSize: CGSize(width: 196, height: 108), topInset: 190)
    let x = ids.compactMap { layout.positions[$0]?.x }
    let y = ids.compactMap { layout.positions[$0]?.y }
    #expect(x == x.sorted())
    #expect(y == y.sorted())
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
    let overview = NetworkLayoutEngine.make(nodeIDs: ids, edges: pathEdges + otherEdges, focusPaths: [], cardSize: size, topInset: 190)
    let focused = NetworkLayoutEngine.make(nodeIDs: ids, edges: pathEdges + otherEdges, focusPaths: [path], cardSize: size, topInset: 190)

    #expect(path.compactMap { focused.positions[$0]?.x } == path.compactMap { focused.positions[$0]?.x }.sorted())
    #expect(overview.positions == focused.positions)
    #expect(overlaps(in: focused, cardSize: size).isEmpty)
}

@Test func linkRoutesReceiveStableSeparateLanes() {
    let lanes = (0..<24).map { NetworkLayoutEngine.routeLane(index: $0, count: 24) }
    #expect(Set(lanes).count == 24)
    #expect(lanes == lanes.sorted())
}

@Test func streetRoutesUseOnlyRightAngleSegments() {
    let points = NetworkLayoutEngine.orthogonalRoute(
        source: CGPoint(x: 96, y: 190),
        target: CGPoint(x: 752, y: 590),
        cardSize: CGSize(width: 196, height: 108),
        lane: 7
    )
    #expect(points.count >= 4)
    #expect(zip(points, points.dropFirst()).allSatisfy { left, right in
        left.x == right.x || left.y == right.y
    })
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
