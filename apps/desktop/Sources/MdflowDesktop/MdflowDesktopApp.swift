import SwiftUI

@main
struct MdflowDesktopApp: App {
    var body: some Scene {
        WindowGroup("ContextOS") {
            ContentView()
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1320, height: 780)
    }
}
