import Foundation
import Testing
@testable import MdflowDesktop

@Test func chainEnvelopeCorridorAvoidsEveryUnrelatedBlock() {
    let blocks = ["a", "b", "c", "obstacle"]
    let links = [
        LayoutEdge(id: "ab", sourceID: "a", targetID: "b"),
        LayoutEdge(id: "bc", sourceID: "b", targetID: "c"),
    ]
    let cardSize = CGSize(width: 196, height: 108)
    let layout = NetworkLayoutEngine.make(
        nodeIDs: blocks, edges: links, focusPaths: [["a", "b", "c"]],
        cardSize: cardSize, topInset: 70
    )
    let envelope = ChainEnvelopeEngine.make(
        nodeIDs: ["a", "b", "c"], linkIDs: ["ab", "bc"],
        layout: layout, cardSize: cardSize, expansion: 8
    )
    let obstacle = CGRect(origin: layout.positions["obstacle"]!, size: cardSize).insetBy(dx: -1, dy: -1)
    #expect(!envelope.intersectsUnrelatedBlock(obstacle))
}

@Test func selectionDoesNotParticipateInCanvasSceneIdentity() {
    let snapshot = GraphSnapshot.empty(name: "Stable", root: "/tmp/stable")
    let first = CanvasScene.compile(snapshot: snapshot, lenses: Set(ViewLens.allCases))
    let second = CanvasScene.compile(snapshot: snapshot, lenses: Set(ViewLens.allCases))
    #expect(first == second)
    #expect(first.projectID == snapshot.project.id)
    #expect(first.graphRevision == snapshot.project.graphRevision)
}

@Test func sharedBlocksAlwaysReceiveDistinctStableChainEnvelopeLanes() {
    let memberships = [
        "alpha": ["shared-a", "alpha-only"],
        "beta": ["shared-a", "shared-b"],
        "gamma": ["shared-b", "gamma-only"],
        "unrelated": ["other"],
    ]
    let first = ChainEnvelopeLaneAllocator.make(chainNodes: memberships)
    let second = ChainEnvelopeLaneAllocator.make(chainNodes: memberships)

    #expect(first == second)
    #expect(first["alpha"] != first["beta"])
    #expect(first["beta"] != first["gamma"])
}

@Test func chainEnvelopeLaneSpacingIsEqualAroundBlocksAndRoads() {
    let size = CGSize(width: 100, height: 60)
    let layout = NetworkLayoutSnapshot(
        positions: ["a": CGPoint(x: 0, y: 0), "b": CGPoint(x: 200, y: 0)],
        routes: ["ab": [CGPoint(x: 100, y: 30), CGPoint(x: 200, y: 30)]],
        layerBands: [], scopeBands: [], size: CGSize(width: 320, height: 180)
    )
    let inner = ChainEnvelopeEngine.make(
        nodeIDs: ["a", "b"], linkIDs: ["ab"], layout: layout,
        cardSize: size, expansion: ChainEnvelopeEngine.baseExpansion
    )
    let outer = ChainEnvelopeEngine.make(
        nodeIDs: ["a", "b"], linkIDs: ["ab"], layout: layout,
        cardSize: size, expansion: ChainEnvelopeEngine.baseExpansion + ChainEnvelopeEngine.laneSpacing
    )

    #expect(outer.nodeFrames[0].minX == inner.nodeFrames[0].minX - ChainEnvelopeEngine.laneSpacing)
    #expect(outer.corridorFrames[0].minY == inner.corridorFrames[0].minY - ChainEnvelopeEngine.laneSpacing)
}

@Test func lShapedChainProducesOneSnakeContourWithoutBoundingBoxFill() {
    let size = CGSize(width: 100, height: 60)
    let layout = NetworkLayoutSnapshot(
        positions: ["a": CGPoint(x: 0, y: 0), "b": CGPoint(x: 180, y: 0), "c": CGPoint(x: 180, y: 120)],
        routes: [
            "ab": [CGPoint(x: 100, y: 30), CGPoint(x: 180, y: 30)],
            "bc": [CGPoint(x: 230, y: 60), CGPoint(x: 230, y: 120)],
        ],
        layerBands: [], scopeBands: [], size: CGSize(width: 360, height: 260)
    )
    let envelope = ChainEnvelopeEngine.make(
        nodeIDs: ["a", "b", "c"], linkIDs: ["ab", "bc"], layout: layout, cardSize: size, expansion: 8
    )
    #expect(envelope.contours.count == 1)
    #expect(envelope.contains(CGPoint(x: 50, y: 30)))
    #expect(envelope.contains(CGPoint(x: 140, y: 30)))
    #expect(envelope.contains(CGPoint(x: 230, y: 90)))
    #expect(!envelope.contains(CGPoint(x: 50, y: 130)))
}

@Test func uShapedChainLeavesItsInnerCourtyardOutsideAndIsDeterministic() {
    let size = CGSize(width: 100, height: 60)
    let layout = NetworkLayoutSnapshot(
        positions: [
            "a": CGPoint(x: 0, y: 0), "b": CGPoint(x: 180, y: 0),
            "c": CGPoint(x: 180, y: 140), "d": CGPoint(x: 0, y: 140),
        ],
        routes: [
            "ab": [CGPoint(x: 100, y: 30), CGPoint(x: 180, y: 30)],
            "bc": [CGPoint(x: 230, y: 60), CGPoint(x: 230, y: 140)],
            "cd": [CGPoint(x: 180, y: 170), CGPoint(x: 100, y: 170)],
        ],
        layerBands: [], scopeBands: [], size: CGSize(width: 360, height: 300)
    )
    let first = ChainEnvelopeEngine.make(
        nodeIDs: ["a", "b", "c", "d"], linkIDs: ["ab", "bc", "cd"], layout: layout, cardSize: size, expansion: 8
    )
    let second = ChainEnvelopeEngine.make(
        nodeIDs: ["a", "b", "c", "d"], linkIDs: ["ab", "bc", "cd"], layout: layout, cardSize: size, expansion: 8
    )
    #expect(first == second)
    #expect(first.contours.count == 1)
    #expect(!first.contains(CGPoint(x: 140, y: 100)))
    #expect(first.contains(CGPoint(x: 230, y: 100)))
}
