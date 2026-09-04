import Foundation

struct ProjectLocation {
    let root: URL
    let descriptor: ProjectDescriptor
    let database: URL

    static func resolve() throws -> ProjectLocation {
        let arguments = ProcessInfo.processInfo.arguments
        let explicitRoot: String? = {
            guard let index = arguments.firstIndex(of: "--project"), arguments.indices.contains(index + 1) else {
                return nil
            }
            return arguments[index + 1]
        }()
        let environmentRoot = ProcessInfo.processInfo.environment["MDFLOW_PROJECT_ROOT"]
        var candidate = URL(
            fileURLWithPath: explicitRoot ?? environmentRoot ?? FileManager.default.currentDirectoryPath,
            isDirectory: true
        ).standardizedFileURL

        while candidate.path != "/" {
            let descriptorURL = candidate.appending(path: ".mdflow/project.json")
            if FileManager.default.fileExists(atPath: descriptorURL.path) {
                let data = try Data(contentsOf: descriptorURL)
                let descriptor = try JSONDecoder().decode(ProjectDescriptor.self, from: data)
                let dataRoot: URL
                if let override = ProcessInfo.processInfo.environment["MDFLOW_DATA_DIR"] {
                    dataRoot = URL(fileURLWithPath: override, isDirectory: true)
                } else {
                    dataRoot = FileManager.default.homeDirectoryForCurrentUser
                        .appending(path: "Library/Application Support/mdflow/projects", directoryHint: .isDirectory)
                }
                return ProjectLocation(
                    root: candidate,
                    descriptor: descriptor,
                    database: dataRoot
                        .appending(path: descriptor.id, directoryHint: .isDirectory)
                        .appending(path: "mdflow.sqlite")
                )
            }
            candidate.deleteLastPathComponent()
        }
        throw CocoaError(.fileNoSuchFile, userInfo: [
            NSLocalizedDescriptionKey: "No .mdflow/project.json found. Open mdflow from a registered project."
        ])
    }
}
