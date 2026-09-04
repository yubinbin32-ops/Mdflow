import Foundation
import Testing
@testable import MdflowDesktop

@Test func overviewLayoutIsDeterministicAndAvoidsNodeOverlap() {
    let ids = (0..<48).map { "node-\($0)" }
    let edges = (1..<48).map { LayoutEdge(id: "edge-\($0)", sourceID: "node-\($0 / 2)", targetID: "node-\($0)") }
    let first = NetworkLayoutEngine.make(nodeIDs: ids, edges: edges, focusPaths: [], cardSize: CGSize(width: 196, height: 108), topInset: 190)
    let second = NetworkLayoutEngine.make(nodeIDs: ids, edges: edges, focusPaths: [], cardSize: CGSize(width: 196, height: 108), topInset: 190)
    #expect(first == second)
    #expect(overlaps(in: first, cardSize: CGSize(width: 196, height: 108)).isEmpty)
}

@Test func focusedLayoutMakesAChainReadableAndKeepsOtherNodesOutsideIt() {
    let path = ["a", "b", "c", "d", "e", "f", "g", "h"]
    let ids = path + (0..<24).map { "other-\($0)" }
    let layout = NetworkLayoutEngine.make(nodeIDs: ids, edges: [], focusPaths: [path], cardSize: CGSize(width: 196, height: 108), topInset: 190)
    let firstRowX = path.prefix(4).compactMap { layout.positions[$0]?.x }
    let secondRowX = path.suffix(4).compactMap { layout.positions[$0]?.x }
    #expect(firstRowX == firstRowX.sorted())
    #expect(secondRowX == secondRowX.sorted(by: >))
    #expect(layout.positions["a"]?.y == layout.positions["d"]?.y)
    #expect(layout.positions["e"]?.y == layout.positions["h"]?.y)
    #expect((layout.positions["e"]?.y ?? 0) > (layout.positions["d"]?.y ?? 0))
    #expect(overlaps(in: layout, cardSize: CGSize(width: 196, height: 108)).isEmpty)
    let pathBounds = path.compactMap { layout.positions[$0] }.map {
        CGRect(origin: $0, size: CGSize(width: 196, height: 108))
    }.reduce(CGRect.null) { $0.union($1) }.insetBy(dx: -80, dy: -80)
    #expect(ids.filter { $0.hasPrefix("other") }.allSatisfy { id in
        guard let point = layout.positions[id] else { return false }
        return !pathBounds.intersects(CGRect(origin: point, size: CGSize(width: 196, height: 108)))
    })
}

@Test func linkRoutesReceiveStableSeparateLanes() {
    #expect(NetworkLayoutEngine.routeLane(for: "a") == NetworkLayoutEngine.routeLane(for: "a"))
    let lanes = Set((0..<24).map { NetworkLayoutEngine.routeLane(for: "edge-\($0)") })
    #expect(lanes.count > 4)
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
