import Foundation

enum PluginInstallStatus: Equatable {
    case checking
    case notInstalled
    case installing
    case installed
    case failed(String)
}

enum PluginInstaller {
    struct CommandFailure: LocalizedError {
        let output: String
        var errorDescription: String? { output }
    }

    static func install(marketplaceRoot: URL) throws {
        let executable = try codexExecutable()
        let addMarketplace = try run(executable, arguments: ["plugin", "marketplace", "add", marketplaceRoot.path, "--json"])
        if addMarketplace.status != 0 {
            let marketplaces = try run(executable, arguments: ["plugin", "marketplace", "list", "--json"])
            guard marketplaces.status == 0, marketplaces.output.contains("mdflow-development") else {
                throw CommandFailure(output: addMarketplace.output.nonEmpty ?? "Unable to register the mdflow marketplace.")
            }
        }

        let install = try run(executable, arguments: ["plugin", "add", "mdflow@mdflow-development", "--json"])
        let alreadyInstalled = install.output.localizedCaseInsensitiveContains("already installed")
            || install.output.localizedCaseInsensitiveContains("already exists")
        guard install.status == 0 || alreadyInstalled else {
            throw CommandFailure(output: install.output.nonEmpty ?? "Unable to install the mdflow plugin.")
        }
    }

    static func isInstalled(marketplaceRoot: URL) throws -> Bool {
        let executable = try codexExecutable()
        let result = try run(executable, arguments: ["plugin", "list", "--marketplace", "mdflow-development", "--json"])
        guard result.status == 0 else {
            throw CommandFailure(output: result.output.nonEmpty ?? "Unable to read the mdflow plugin status.")
        }

        guard let data = result.output.data(using: .utf8),
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let installed = object["installed"] as? [[String: Any]] else {
            throw CommandFailure(output: "Codex returned an invalid plugin status response.")
        }

        let expectedMarketplace = marketplaceRoot.standardizedFileURL.path
        let expectedPlugin = marketplaceRoot
            .appending(path: "plugins/mdflow", directoryHint: .isDirectory)
            .standardizedFileURL.path

        return installed.contains { plugin in
            let pluginSource = (plugin["source"] as? [String: Any])?["path"] as? String
            let marketplaceSource = (plugin["marketplaceSource"] as? [String: Any])?["source"] as? String
            return plugin["pluginId"] as? String == "mdflow@mdflow-development"
                && (plugin["installed"] as? Bool ?? false)
                && (plugin["enabled"] as? Bool ?? false)
                && URL(fileURLWithPath: pluginSource ?? "").standardizedFileURL.path == expectedPlugin
                && URL(fileURLWithPath: marketplaceSource ?? "").standardizedFileURL.path == expectedMarketplace
        }
    }

    private static func codexExecutable() throws -> URL {
        let manager = FileManager.default
        let candidates = [
            "/Applications/Codex.app/Contents/Resources/codex",
            "/Applications/ChatGPT.app/Contents/Resources/codex",
            "/opt/homebrew/bin/codex",
            "/usr/local/bin/codex",
        ]
        if let path = candidates.first(where: { manager.isExecutableFile(atPath: $0) }) {
            return URL(fileURLWithPath: path)
        }
        let lookup = try run(URL(fileURLWithPath: "/usr/bin/which"), arguments: ["codex"])
        let path = lookup.output.trimmingCharacters(in: .whitespacesAndNewlines)
        guard lookup.status == 0, manager.isExecutableFile(atPath: path) else {
            throw CommandFailure(output: "Codex CLI was not found. Install or open Codex, then try again.")
        }
        return URL(fileURLWithPath: path)
    }

    private static func run(_ executable: URL, arguments: [String]) throws -> (status: Int32, output: String) {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = executable
        process.arguments = arguments
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()
        process.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        return (process.terminationStatus, String(decoding: data, as: UTF8.self))
    }
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}
