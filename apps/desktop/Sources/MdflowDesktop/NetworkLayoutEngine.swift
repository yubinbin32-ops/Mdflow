import Foundation

struct LayoutEdge: Equatable {
    let id: String
    let sourceID: String
    let targetID: String
}

struct NetworkLayoutSnapshot: Equatable {
    let positions: [String: CGPoint]
    let routes: [String: [CGPoint]]
    let size: CGSize
}

enum NetworkLayoutEngine {
    static let horizontalStreetWidth: CGFloat = 76
    static let verticalStreetWidth: CGFloat = 44

    static func make(
        nodeIDs: [String],
        edges: [LayoutEdge],
        focusPaths: [[String]],
        districts: [String: Int] = [:],
        cardSize: CGSize,
        topInset: CGFloat
    ) -> NetworkLayoutSnapshot {
        let nodes = Array(Set(nodeIDs)).sorted()
        guard !nodes.isEmpty else {
            return NetworkLayoutSnapshot(positions: [:], routes: [:], size: CGSize(width: 900, height: 620))
        }

        let visible = Set(nodes)
        let validEdges = edges.filter {
            visible.contains($0.sourceID) && visible.contains($0.targetID) && $0.sourceID != $0.targetID
        }
        let ranks = componentRanks(nodes: nodes, edges: validEdges)
        let ordered = orderedRanks(nodes: nodes, edges: validEdges, ranks: ranks, districts: districts, focusPaths: focusPaths)
        let maximumRows = ordered.values.map(\.count).max() ?? 1
        let sidePadding: CGFloat = 70
        let bottomPadding: CGFloat = 76
        var positions: [String: CGPoint] = [:]

        for rank in ordered.keys.sorted() {
            let members = ordered[rank] ?? []
            let columnHeight = CGFloat(members.count) * cardSize.height + CGFloat(max(0, members.count - 1)) * verticalStreetWidth
            let maximumHeight = CGFloat(maximumRows) * cardSize.height + CGFloat(max(0, maximumRows - 1)) * verticalStreetWidth
            let startY = topInset + max(0, (maximumHeight - columnHeight) / 2)
            for (row, id) in members.enumerated() {
                positions[id] = CGPoint(
                    x: sidePadding + CGFloat(rank) * (cardSize.width + horizontalStreetWidth),
                    y: startY + CGFloat(row) * (cardSize.height + verticalStreetWidth)
                )
            }
        }

        let frames = positions.mapValues { CGRect(origin: $0, size: cardSize) }
        let routes = route(edges: validEdges, frames: frames, cardSize: cardSize)
        let bounds = frames.values.reduce(CGRect.null) { $0.union($1) }
        return NetworkLayoutSnapshot(
            positions: positions,
            routes: routes,
            size: CGSize(width: max(900, bounds.maxX + sidePadding), height: max(620, bounds.maxY + bottomPadding))
        )
    }

    static func orthogonalRoute(source: CGPoint, target: CGPoint, cardSize: CGSize, lane: CGFloat) -> [CGPoint] {
        let sourceFrame = CGRect(origin: source, size: cardSize)
        let targetFrame = CGRect(origin: target, size: cardSize)
        let forward = targetFrame.midX >= sourceFrame.midX
        let start = CGPoint(x: forward ? sourceFrame.maxX : sourceFrame.minX, y: sourceFrame.midY + lane)
        let end = CGPoint(x: forward ? targetFrame.minX : targetFrame.maxX, y: targetFrame.midY + lane)
        let middleX = (start.x + end.x) / 2
        return compact([start, CGPoint(x: middleX, y: start.y), CGPoint(x: middleX, y: end.y), end])
    }

    static func routeLane(index: Int, count: Int, maximumSpread: CGFloat = 24) -> CGFloat {
        guard count > 1 else { return 0 }
        let step = min(5, maximumSpread * 2 / CGFloat(count - 1))
        return (CGFloat(index) - CGFloat(count - 1) / 2) * step
    }

    private static func orderedRanks(
        nodes: [String], edges: [LayoutEdge], ranks: [String: Int], districts: [String: Int], focusPaths: [[String]]
    ) -> [Int: [String]] {
        var groups = Dictionary(grouping: nodes) { ranks[$0, default: 0] }
        var pathPosition: [String: Int] = [:]
        for path in focusPaths {
            for (index, id) in path.enumerated() where pathPosition[id] == nil { pathPosition[id] = index }
        }
        let incoming = Dictionary(grouping: edges, by: \.targetID)
        let outgoing = Dictionary(grouping: edges, by: \.sourceID)

        for rank in groups.keys {
            groups[rank]?.sort {
                let lhsPath = pathPosition[$0] ?? Int.max
                let rhsPath = pathPosition[$1] ?? Int.max
                if lhsPath != rhsPath { return lhsPath < rhsPath }
                let lhsDistrict = districts[$0, default: 2]
                let rhsDistrict = districts[$1, default: 2]
                if lhsDistrict != rhsDistrict { return lhsDistrict < rhsDistrict }
                return $0 < $1
            }
        }

        for _ in 0..<6 {
            var order = orderMap(groups)
            for rank in groups.keys.sorted() where rank > 0 {
                groups[rank]?.sort {
                    let lhs = barycenter(incoming[$0] ?? [], endpoint: \.sourceID, order: order)
                    let rhs = barycenter(incoming[$1] ?? [], endpoint: \.sourceID, order: order)
                    return lhs == rhs ? $0 < $1 : lhs < rhs
                }
            }
            order = orderMap(groups)
            for rank in groups.keys.sorted(by: >) {
                groups[rank]?.sort {
                    let lhs = barycenter(outgoing[$0] ?? [], endpoint: \.targetID, order: order)
                    let rhs = barycenter(outgoing[$1] ?? [], endpoint: \.targetID, order: order)
                    return lhs == rhs ? $0 < $1 : lhs < rhs
                }
            }
        }
        return groups
    }

    private static func orderMap(_ groups: [Int: [String]]) -> [String: CGFloat] {
        var result: [String: CGFloat] = [:]
        for members in groups.values {
            for (index, id) in members.enumerated() { result[id] = CGFloat(index) }
        }
        return result
    }

    private static func barycenter(
        _ edges: [LayoutEdge], endpoint: KeyPath<LayoutEdge, String>, order: [String: CGFloat]
    ) -> CGFloat {
        let values = edges.compactMap { order[$0[keyPath: endpoint]] }
        guard !values.isEmpty else { return .greatestFiniteMagnitude }
        return values.reduce(0, +) / CGFloat(values.count)
    }

    private static func componentRanks(nodes: [String], edges: [LayoutEdge]) -> [String: Int] {
        let adjacency = Dictionary(grouping: edges, by: \.sourceID).mapValues { $0.map(\.targetID) }
        var nextIndex = 0
        var stack: [String] = []
        var onStack: Set<String> = []
        var indices: [String: Int] = [:]
        var low: [String: Int] = [:]
        var components: [[String]] = []

        func visit(_ node: String) {
            indices[node] = nextIndex
            low[node] = nextIndex
            nextIndex += 1
            stack.append(node)
            onStack.insert(node)
            for target in adjacency[node] ?? [] {
                if indices[target] == nil {
                    visit(target)
                    low[node] = min(low[node]!, low[target]!)
                } else if onStack.contains(target) {
                    low[node] = min(low[node]!, indices[target]!)
                }
            }
            if low[node] == indices[node] {
                var component: [String] = []
                while let member = stack.popLast() {
                    onStack.remove(member)
                    component.append(member)
                    if member == node { break }
                }
                components.append(component.sorted())
            }
        }

        for node in nodes where indices[node] == nil { visit(node) }
        let componentOf = Dictionary(uniqueKeysWithValues: components.enumerated().flatMap { index, members in
            members.map { ($0, index) }
        })
        var incoming = Dictionary(uniqueKeysWithValues: components.indices.map { ($0, 0) })
        var outgoing: [Int: Set<Int>] = [:]
        for edge in edges {
            guard let source = componentOf[edge.sourceID], let target = componentOf[edge.targetID], source != target else { continue }
            if outgoing[source, default: []].insert(target).inserted { incoming[target, default: 0] += 1 }
        }
        var queue = components.indices.filter { incoming[$0] == 0 }.sorted()
        var componentRank = Dictionary(uniqueKeysWithValues: components.indices.map { ($0, 0) })
        while !queue.isEmpty {
            let source = queue.removeFirst()
            for target in (outgoing[source] ?? []).sorted() {
                componentRank[target] = max(componentRank[target, default: 0], componentRank[source, default: 0] + 1)
                incoming[target, default: 0] -= 1
                if incoming[target] == 0 { queue.append(target); queue.sort() }
            }
        }
        return Dictionary(uniqueKeysWithValues: nodes.map { ($0, componentRank[componentOf[$0]!, default: 0]) })
    }

    private static func route(edges: [LayoutEdge], frames: [String: CGRect], cardSize: CGSize) -> [String: [CGPoint]] {
        let outgoing = Dictionary(grouping: edges, by: \.sourceID).mapValues { $0.sorted { $0.id < $1.id } }
        let incoming = Dictionary(grouping: edges, by: \.targetID).mapValues { $0.sorted { $0.id < $1.id } }
        let obstacles = frames.values.map { $0.insetBy(dx: -8, dy: -8) }
        var used: [[CGPoint]] = []
        var result: [String: [CGPoint]] = [:]

        for edge in edges.sorted(by: { $0.id < $1.id }) {
            guard let source = frames[edge.sourceID], let target = frames[edge.targetID] else { continue }
            let sourceIndex = outgoing[edge.sourceID]?.firstIndex(of: edge) ?? 0
            let targetIndex = incoming[edge.targetID]?.firstIndex(of: edge) ?? 0
            let sourceCount = outgoing[edge.sourceID]?.count ?? 1
            let targetCount = incoming[edge.targetID]?.count ?? 1
            let horizontal = abs(target.midX - source.midX) >= abs(target.midY - source.midY)
            let candidates = routeCandidates(
                source: source,
                target: target,
                horizontal: horizontal,
                sourceOffset: portOffset(index: sourceIndex, count: sourceCount, span: horizontal ? cardSize.height : cardSize.width),
                targetOffset: portOffset(index: targetIndex, count: targetCount, span: horizontal ? cardSize.height : cardSize.width),
                obstacles: obstacles
            )
            let excluded = [source.insetBy(dx: -8, dy: -8), target.insetBy(dx: -8, dy: -8)]
            let valid = candidates.filter { pathIsClear($0, obstacles: obstacles, excluding: excluded) }
            let chosen = (valid.isEmpty ? candidates : valid).min { routeScore($0, used: used) < routeScore($1, used: used) } ?? []
            result[edge.id] = compact(chosen)
            used.append(compact(chosen))
        }
        return result
    }

    private static func routeCandidates(
        source: CGRect, target: CGRect, horizontal: Bool, sourceOffset: CGFloat, targetOffset: CGFloat, obstacles: [CGRect]
    ) -> [[CGPoint]] {
        let clearance: CGFloat = 18
        let allBounds = obstacles.reduce(CGRect.null) { $0.union($1) }
        if horizontal {
            let forward = target.midX >= source.midX
            let start = CGPoint(x: forward ? source.maxX : source.minX, y: source.midY + sourceOffset)
            let end = CGPoint(x: forward ? target.minX : target.maxX, y: target.midY + targetOffset)
            let escape = CGPoint(x: start.x + (forward ? clearance : -clearance), y: start.y)
            let approach = CGPoint(x: end.x + (forward ? -clearance : clearance), y: end.y)
            var tracks = [start.y, end.y, (start.y + end.y) / 2, allBounds.minY - 26, allBounds.maxY + 26]
            tracks += obstacles.flatMap { [$0.minY - 12, $0.maxY + 12] }
            var candidates = tracks.map { y in compact([start, escape, CGPoint(x: escape.x, y: y), CGPoint(x: approach.x, y: y), approach, end]) }
            let middleXs = [(escape.x + approach.x) / 2, escape.x + (forward ? clearance : -clearance), approach.x + (forward ? -clearance : clearance)]
            candidates += middleXs.map { x in compact([start, escape, CGPoint(x: x, y: escape.y), CGPoint(x: x, y: approach.y), approach, end]) }
            return candidates
        }

        let downward = target.midY >= source.midY
        let start = CGPoint(x: source.midX + sourceOffset, y: downward ? source.maxY : source.minY)
        let end = CGPoint(x: target.midX + targetOffset, y: downward ? target.minY : target.maxY)
        let escape = CGPoint(x: start.x, y: start.y + (downward ? clearance : -clearance))
        let approach = CGPoint(x: end.x, y: end.y + (downward ? -clearance : clearance))
        var tracks = [start.x, end.x, (start.x + end.x) / 2, allBounds.minX - 26, allBounds.maxX + 26]
        tracks += obstacles.flatMap { [$0.minX - 12, $0.maxX + 12] }
        return tracks.map { x in compact([start, escape, CGPoint(x: x, y: escape.y), CGPoint(x: x, y: approach.y), approach, end]) }
    }

    private static func portOffset(index: Int, count: Int, span: CGFloat) -> CGFloat {
        guard count > 1 else { return 0 }
        let step = min(13, (span - 34) / CGFloat(count - 1))
        return (CGFloat(index) - CGFloat(count - 1) / 2) * step
    }

    private static func pathIsClear(_ points: [CGPoint], obstacles: [CGRect], excluding: [CGRect]) -> Bool {
        let active = obstacles.filter { obstacle in !excluding.contains(where: { nearlyEqual($0, obstacle) }) }
        return zip(points, points.dropFirst()).allSatisfy { start, end in active.allSatisfy { !segment(start, end, crosses: $0) } }
    }

    private static func routeScore(_ points: [CGPoint], used: [[CGPoint]]) -> CGFloat {
        let length = zip(points, points.dropFirst()).reduce(CGFloat.zero) { $0 + abs($1.1.x - $1.0.x) + abs($1.1.y - $1.0.y) }
        let overlapPenalty = used.reduce(0) { $0 + sharedSegmentCount(points, $1) * 420 }
        return length + CGFloat(max(0, points.count - 2)) * 12 + CGFloat(overlapPenalty)
    }

    private static func sharedSegmentCount(_ lhs: [CGPoint], _ rhs: [CGPoint]) -> Int {
        Set(zip(lhs, lhs.dropFirst()).map(Segment.init)).intersection(Set(zip(rhs, rhs.dropFirst()).map(Segment.init))).count
    }

    private static func segment(_ start: CGPoint, _ end: CGPoint, crosses rect: CGRect) -> Bool {
        if start.x == end.x {
            return start.x > rect.minX && start.x < rect.maxX && max(start.y, end.y) > rect.minY && min(start.y, end.y) < rect.maxY
        }
        if start.y == end.y {
            return start.y > rect.minY && start.y < rect.maxY && max(start.x, end.x) > rect.minX && min(start.x, end.x) < rect.maxX
        }
        return true
    }

    private static func nearlyEqual(_ lhs: CGRect, _ rhs: CGRect) -> Bool {
        abs(lhs.minX - rhs.minX) < 0.1 && abs(lhs.minY - rhs.minY) < 0.1 && abs(lhs.width - rhs.width) < 0.1 && abs(lhs.height - rhs.height) < 0.1
    }

    private static func compact(_ points: [CGPoint]) -> [CGPoint] {
        var result: [CGPoint] = []
        for point in points {
            if result.last == point { continue }
            if result.count >= 2 {
                let a = result[result.count - 2]
                let b = result[result.count - 1]
                if (a.x == b.x && b.x == point.x) || (a.y == b.y && b.y == point.y) {
                    result[result.count - 1] = point
                    continue
                }
            }
            result.append(point)
        }
        return result
    }

    private struct Segment: Hashable {
        let start: CGPoint
        let end: CGPoint
        init(_ start: CGPoint, _ end: CGPoint) {
            if start.x < end.x || (start.x == end.x && start.y <= end.y) { self.start = start; self.end = end }
            else { self.start = end; self.end = start }
        }
    }
}
