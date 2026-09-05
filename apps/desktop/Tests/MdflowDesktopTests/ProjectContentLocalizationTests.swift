import Testing
@testable import MdflowDesktop

@Test func appLanguageNeverReplacesCanonicalProjectContent() {
    let legacyTranslation = LocalizedTextItem(
        entityType: "block",
        entityId: "canvas",
        locale: "zh-Hans",
        field: "title",
        value: "可缩放画布"
    )

    let english = GraphStore.projectContent(
        "Zoomable canvas",
        appLanguage: .english,
        localizations: [legacyTranslation]
    )
    let chinese = GraphStore.projectContent(
        "Zoomable canvas",
        appLanguage: .zhHans,
        localizations: [legacyTranslation]
    )

    #expect(english == "Zoomable canvas")
    #expect(chinese == "Zoomable canvas")
}

@Test func historyItemKeepsCompactDiffMetadataSeparateFromEntityFacts() {
    let item = HistoryItem(
        id: 1,
        entityType: "block",
        entityId: "canvas",
        action: "updated",
        revision: 2,
        summary: "Update canvas contract",
        planID: "migration",
        chainScopeID: "canvas-scope",
        changedFields: ["summary"],
        fieldDiffs: [HistoryFieldDiff(field: "summary", before: "old", after: "new")],
        affectedRefs: ["block:canvas", "chain:city-canvas"],
        evidenceRefs: ["checkpoint:canvas-proof"],
        createdAt: "2026-09-05T00:00:00Z"
    )

    #expect(item.changedFields == ["summary"])
    #expect(item.affectedRefs.contains("chain:city-canvas"))
    #expect(item.fieldDiffs.first?.before == "old")
    #expect(item.fieldDiffs.first?.after == "new")
}

@Test func historyDiffDecoderSelectsOnlyChangedFields() {
    let diffs = ProjectDatabase.historyFieldDiffs(
        beforeJSON: "{\"title\":\"Canvas\",\"summary\":\"old\",\"body\":\"unchanged\"}",
        afterJSON: "{\"title\":\"Canvas\",\"summary\":\"new\",\"body\":\"unchanged\"}",
        fields: ["summary"]
    )

    #expect(diffs == [HistoryFieldDiff(field: "summary", before: "old", after: "new")])
}
