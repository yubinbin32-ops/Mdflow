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
