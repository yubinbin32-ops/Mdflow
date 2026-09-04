import Foundation

struct LayoutEdge: Equatable {
    let id: String
    let sourceID: String
    let targetID: String
}

struct NetworkLayoutSnapshot: Equatable {
    let positions: [String: CGPoint]
    let size: CGSize
}

enum NetworkLayoutEngine {
    static func make(
        nodeIDs: [String],
        edges: [LayoutEdge],
        focusPaths: [[String]],
        cardSize: CGSize,
        topInset: CGFloat
    ) -> NetworkLayoutSnapshot {
        let nodes = Array(Set(nodeIDs)).sorted()
        guard !nodes.isEmpty else {
            return NetworkLayoutSnapshot(positions: [:], size: CGSize(width: 1100, height: 720))
        }
        let visible = Set(nodes)
        let paths = focusPaths
            .map { $0.filter { visible.contains($0) } }
            .filter { !$0.isEmpty }
        if paths.isEmpty {
            return overview(nodes: nodes, edges: edges, cardSize: cardSize, topInset: topInset)
        }
        return focused(nodes: nodes, paths: paths, cardSize: cardSize, topInset: topInset)
    }

    static func routeLane(for id: String, spread: CGFloat = 10) -> CGFloat {
        let slot = Int(stableHash(id) % 9) - 4
        return CGFloat(slot) * spread
    }

    private static func overview(
        nodes: [String],
        edges: [LayoutEdge],
        cardSize: CGSize,
        topInset: CGFloat
    ) -> NetworkLayoutSnapshot {
        var degree = Dictionary(uniqueKeysWithValues: nodes.map { ($0, 0) })
        for edge in edges {
            degree[edge.sourceID, default: 0] += 1
            degree[edge.targetID, default: 0] += 1
        }
        let ordered = nodes.sorted {
            let lhs = degree[$0, default: 0]
            let rhs = degree[$1, default: 0]
            return lhs == rhs ? $0 < $1 : lhs > rhs
        }
        var centers: [String: CGPoint] = [:]
        centers[ordered[0]] = .zero
        var cursor = 1
        var ring = 1
        while cursor < ordered.count {
            let capacity = min(ordered.count - cursor, 8 + (ring - 1) * 6)
            let radiusX = CGFloat(250 + (ring - 1) * 250)
            let radiusY = CGFloat(180 + (ring - 1) * 185)
            let phase = CGFloat(stableHash(ordered[cursor]) % 360) * .pi / 180
            for index in 0..<capacity {
                let angle = phase + 2 * .pi * CGFloat(index) / CGFloat(capacity)
                centers[ordered[cursor + index]] = CGPoint(
                    x: cos(angle) * radiusX,
                    y: sin(angle) * radiusY
                )
            }
            cursor += capacity
            ring += 1
        }
        centers = separateOverlaps(in: centers, fixed: [], cardSize: cardSize)
        return normalize(centers: centers, cardSize: cardSize, topInset: topInset)
    }

    private static func focused(
        nodes: [String],
        paths: [[String]],
        cardSize: CGSize,
        topInset: CGFloat
    ) -> NetworkLayoutSnapshot {
        let horizontalGap: CGFloat = 92
        let verticalGap: CGFloat = 92
        let maximumColumns = 4
        var centers: [String: CGPoint] = [:]
        var occupied: [CGRect] = []
        var maxColumns = 1
        var nextRow = 0

        for path in paths {
            let columns = min(maximumColumns, max(path.count, 1))
            let rowCount = max(1, Int(ceil(Double(path.count) / Double(maximumColumns))))
            maxColumns = max(maxColumns, columns)
            for (index, id) in path.enumerated() where centers[id] == nil {
                let localRow = index / maximumColumns
                let offset = index % maximumColumns
                let column = localRow.isMultiple(of: 2) ? offset : maximumColumns - 1 - offset
                let center = CGPoint(
                    x: CGFloat(column) * (cardSize.width + horizontalGap),
                    y: CGFloat(nextRow + localRow) * (cardSize.height + verticalGap)
                )
                centers[id] = center
                occupied.append(rect(around: center, size: cardSize))
            }
            nextRow += rowCount
        }

        let focusedIDs = Set(paths.flatMap { $0 })
        let remaining = nodes.filter { !focusedIDs.contains($0) }
        let focusWidth = CGFloat(maxColumns - 1) * (cardSize.width + horizontalGap)
        let focusHeight = CGFloat(max(nextRow - 1, 0)) * (cardSize.height + verticalGap)
        let focusCenter = CGPoint(x: focusWidth / 2, y: focusHeight / 2)
        let focusedRects = focusedIDs.compactMap { centers[$0] }.map { rect(around: $0, size: cardSize) }
        let focusEnvelope = focusedRects.dropFirst().reduce(focusedRects.first ?? .null) { $0.union($1) }
            .insetBy(dx: -80, dy: -80)
        var cursor = 0
        var ring = 0
        while cursor < remaining.count {
            let capacity = min(remaining.count - cursor, 10 + ring * 6)
            let radiusX = max(focusWidth / 2 + cardSize.width * 1.5 + 220, CGFloat(620 + ring * 280))
            let radiusY = max(focusHeight / 2 + cardSize.height + 130, CGFloat(350 + ring * 190))
            let phase = CGFloat(stableHash(remaining[cursor]) % 360) * .pi / 180
            for index in 0..<capacity {
                var radiusMultiplier: CGFloat = 1
                var candidate = CGPoint.zero
                repeat {
                    let angle = phase + 2 * .pi * CGFloat(index) / CGFloat(capacity)
                    candidate = CGPoint(
                        x: focusCenter.x + cos(angle) * radiusX * radiusMultiplier,
                        y: focusCenter.y + sin(angle) * radiusY * radiusMultiplier
                    )
                    radiusMultiplier += 0.1
                } while focusEnvelope.intersects(rect(around: candidate, size: cardSize)) ||
                    occupied.contains(where: { $0.intersects(rect(around: candidate, size: cardSize).insetBy(dx: -24, dy: -24)) })
                centers[remaining[cursor + index]] = candidate
                occupied.append(rect(around: candidate, size: cardSize))
            }
            cursor += capacity
            ring += 1
        }
        centers = separateOverlaps(in: centers, fixed: focusedIDs, cardSize: cardSize)
        return normalize(centers: centers, cardSize: cardSize, topInset: topInset)
    }

    private static func separateOverlaps(
        in centers: [String: CGPoint],
        fixed: Set<String>,
        cardSize: CGSize
    ) -> [String: CGPoint] {
        var result = centers
        let ids = result.keys.sorted()
        let requiredWidth = cardSize.width + 28
        let requiredHeight = cardSize.height + 28
        for _ in 0..<240 {
            var changed = false
            for leftIndex in ids.indices {
                for rightIndex in ids.indices where rightIndex > leftIndex {
                    let leftID = ids[leftIndex]
                    let rightID = ids[rightIndex]
                    guard let left = result[leftID], let right = result[rightID] else { continue }
                    let dx = right.x - left.x
                    let dy = right.y - left.y
                    let overlapX = requiredWidth - abs(dx)
                    let overlapY = requiredHeight - abs(dy)
                    guard overlapX > 0, overlapY > 0 else { continue }
                    changed = true
                    let leftFixed = fixed.contains(leftID)
                    let rightFixed = fixed.contains(rightID)
                    if leftFixed && rightFixed { continue }
                    if overlapX < overlapY {
                        let direction: CGFloat = dx == 0 ? (leftID < rightID ? 1 : -1) : (dx > 0 ? 1 : -1)
                        let shift = overlapX + 1
                        if leftFixed {
                            result[rightID]?.x += direction * shift
                        } else if rightFixed {
                            result[leftID]?.x -= direction * shift
                        } else {
                            result[leftID]?.x -= direction * shift / 2
                            result[rightID]?.x += direction * shift / 2
                        }
                    } else {
                        let direction: CGFloat = dy == 0 ? (leftID < rightID ? 1 : -1) : (dy > 0 ? 1 : -1)
                        let shift = overlapY + 1
                        if leftFixed {
                            result[rightID]?.y += direction * shift
                        } else if rightFixed {
                            result[leftID]?.y -= direction * shift
                        } else {
                            result[leftID]?.y -= direction * shift / 2
                            result[rightID]?.y += direction * shift / 2
                        }
                    }
                }
            }
            if !changed { break }
        }
        return result
    }

    private static func normalize(
        centers: [String: CGPoint],
        cardSize: CGSize,
        topInset: CGFloat
    ) -> NetworkLayoutSnapshot {
        let rects = centers.values.map { rect(around: $0, size: cardSize) }
        guard let first = rects.first else {
            return NetworkLayoutSnapshot(positions: [:], size: CGSize(width: 1100, height: 720))
        }
        let bounds = rects.dropFirst().reduce(first) { $0.union($1) }
        let sidePadding: CGFloat = 96
        let bottomPadding: CGFloat = 110
        let offset = CGPoint(x: sidePadding - bounds.minX, y: topInset - bounds.minY)
        let positions = centers.mapValues { center in
            CGPoint(
                x: center.x - cardSize.width / 2 + offset.x,
                y: center.y - cardSize.height / 2 + offset.y
            )
        }
        return NetworkLayoutSnapshot(
            positions: positions,
            size: CGSize(
                width: max(1100, bounds.width + sidePadding * 2),
                height: max(720, bounds.height + topInset + bottomPadding)
            )
        )
    }

    private static func rect(around center: CGPoint, size: CGSize) -> CGRect {
        CGRect(x: center.x - size.width / 2, y: center.y - size.height / 2, width: size.width, height: size.height)
    }

    private static func stableHash(_ value: String) -> UInt64 {
        value.utf8.reduce(14_695_981_039_346_656_037) { partial, byte in
            (partial ^ UInt64(byte)) &* 1_099_511_628_211
        }
    }
}
