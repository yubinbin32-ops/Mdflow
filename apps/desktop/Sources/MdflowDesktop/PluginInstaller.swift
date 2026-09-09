import CryptoKit
import Foundation

struct EditorPlatformStatus: Identifiable, Equatable {
    let id: String
    let name: String
    let iconSystemName: String
    var isAppInstalled: Bool
    var isSynced: Bool
    var installedVersion: String?
    var targetVersion: String
    var isOutdated: Bool
    var configPath: String
    var appVersion: String = ""
    var installedBuild: String? = nil
    var targetBuild: String = ""

    var isAppVersionMismatch: Bool {
        !appVersion.isEmpty && appVersion != targetVersion
    }

    var isBuildMismatch: Bool {
        installedBuild != nil && !targetBuild.isEmpty && installedBuild != targetBuild
    }
}

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

    static let fallbackVersion = "0.3.3"

    private static let buildFiles = [
        ".codex-plugin/plugin.json",
        "server/mdflow-mcp.mjs",
        "skills/mdflow/SKILL.md"
    ]

    private static func pluginBuildID(pluginRoot: URL) -> String? {
        var hasher = SHA256()
        for relativePath in buildFiles {
            let fileURL = pluginRoot.appending(path: relativePath)
            guard let data = try? Data(contentsOf: fileURL) else { return nil }
            hasher.update(data: Data(relativePath.utf8))
            hasher.update(data: Data([0]))
            hasher.update(data: data)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    static func bundledPluginBuildID(marketplaceRoot: URL?) -> String {
        guard let marketplaceRoot else { return "" }
        let pluginRoot = marketplaceRoot.appending(path: "plugins/mdflow", directoryHint: .isDirectory)
        return pluginBuildID(pluginRoot: pluginRoot) ?? ""
    }

    static func bundledAppVersion(marketplaceRoot: URL?) -> String {
        if let marketplaceRoot {
            let infoURL = marketplaceRoot.appending(path: "apps/desktop/Resources/Info.plist")
            if let data = try? Data(contentsOf: infoURL),
               let plist = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil) as? [String: Any],
               let version = plist["CFBundleShortVersionString"] as? String,
               !version.isEmpty {
                return version
            }
        }
        if let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
           !version.isEmpty {
            return version
        }
        return fallbackVersion
    }

    static func bundledTargetVersion(marketplaceRoot: URL?) -> String {
        if let marketplaceRoot {
            let pluginJsonURL = marketplaceRoot.appending(path: "plugins/mdflow/.codex-plugin/plugin.json")
            if let data = try? Data(contentsOf: pluginJsonURL),
               let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
               let ver = json["version"] as? String {
                let clean = ver.components(separatedBy: "+").first ?? ver
                if !clean.isEmpty { return clean }
            }
            let packageJsonURL = marketplaceRoot.appending(path: "package.json")
            if let data = try? Data(contentsOf: packageJsonURL),
               let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
               let ver = json["version"] as? String, !ver.isEmpty {
                return ver
            }
        }
        return fallbackVersion
    }

    static func detectAllPlatforms(projectRoot: URL?, marketplaceRoot: URL?) -> [EditorPlatformStatus] {
        var platforms: [EditorPlatformStatus] = []
        let targetVersion = bundledTargetVersion(marketplaceRoot: marketplaceRoot)
        let targetBuild = bundledPluginBuildID(marketplaceRoot: marketplaceRoot)
        let appVersion = bundledAppVersion(marketplaceRoot: marketplaceRoot)
        let versionsCompatible = appVersion == targetVersion
        let home = FileManager.default.homeDirectoryForCurrentUser

        // 1. Claude Desktop
        let claudeConfigURL = home.appending(path: "Library/Application Support/Claude/claude_desktop_config.json")
        let claudeAppExists = FileManager.default.fileExists(atPath: "/Applications/Claude.app") ||
                              FileManager.default.fileExists(atPath: "/Applications/Claude Desktop.app") ||
                              FileManager.default.fileExists(atPath: home.appending(path: "Applications/Claude.app").path)
        let claudeMetadata = claudeAppExists ? readMcpMetadata(at: claudeConfigURL) : (version: nil, build: nil)
        let claudeInstalledVer = claudeMetadata.version
        let claudeSynced = claudeAppExists && versionsCompatible && claudeInstalledVer != nil && claudeInstalledVer == targetVersion && claudeMetadata.build == targetBuild
        let claudeOutdated = claudeAppExists && claudeInstalledVer != nil && claudeInstalledVer != targetVersion
        platforms.append(EditorPlatformStatus(
            id: "claude",
            name: "Claude Desktop",
            iconSystemName: "bubble.left.and.text.bubble.right.fill",
            isAppInstalled: claudeAppExists,
            isSynced: claudeSynced,
            installedVersion: claudeInstalledVer,
            targetVersion: targetVersion,
            isOutdated: claudeOutdated,
            configPath: "~/Library/Application Support/Claude/claude_desktop_config.json",
            appVersion: appVersion,
            installedBuild: claudeMetadata.build,
            targetBuild: targetBuild
        ))

        // 2. Cursor
        let cursorAppExists = FileManager.default.fileExists(atPath: "/Applications/Cursor.app") ||
                              FileManager.default.fileExists(atPath: home.appending(path: "Applications/Cursor.app").path)
        let userCursorURL = home.appending(path: ".cursor/mcp.json")
        let cursorMetadata = cursorAppExists ? readMcpMetadata(at: userCursorURL) : (version: nil, build: nil)
        let cursorInstalledVer = cursorMetadata.version
        let cursorSynced = cursorAppExists && versionsCompatible && cursorInstalledVer != nil && cursorInstalledVer == targetVersion && cursorMetadata.build == targetBuild
        let cursorOutdated = cursorAppExists && cursorInstalledVer != nil && cursorInstalledVer != targetVersion
        platforms.append(EditorPlatformStatus(
            id: "cursor",
            name: "Cursor",
            iconSystemName: "chevron.left.forwardslash.chevron.right",
            isAppInstalled: cursorAppExists,
            isSynced: cursorSynced,
            installedVersion: cursorInstalledVer,
            targetVersion: targetVersion,
            isOutdated: cursorOutdated,
            configPath: "~/.cursor/mcp.json",
            appVersion: appVersion,
            installedBuild: cursorMetadata.build,
            targetBuild: targetBuild
        ))

        // 3. Antigravity
        let antigravityAppExists = FileManager.default.fileExists(atPath: "/Applications/Antigravity.app") ||
                                   FileManager.default.fileExists(atPath: home.appending(path: ".gemini/antigravity").path)
        let antigravityUserURL = home.appending(path: ".gemini/config/mcp_config.json")
        let antigravityMetadata = antigravityAppExists ? readMcpMetadata(at: antigravityUserURL) : (version: nil, build: nil)
        let antigravityInstalledVer = antigravityMetadata.version
        let antigravitySynced = antigravityAppExists && versionsCompatible && antigravityInstalledVer != nil && antigravityInstalledVer == targetVersion && antigravityMetadata.build == targetBuild
        let antigravityOutdated = antigravityAppExists && antigravityInstalledVer != nil && antigravityInstalledVer != targetVersion
        platforms.append(EditorPlatformStatus(
            id: "antigravity",
            name: "Antigravity",
            iconSystemName: "sparkles",
            isAppInstalled: antigravityAppExists,
            isSynced: antigravitySynced,
            installedVersion: antigravityInstalledVer,
            targetVersion: targetVersion,
            isOutdated: antigravityOutdated,
            configPath: "~/.gemini/config/mcp_config.json",
            appVersion: appVersion,
            installedBuild: antigravityMetadata.build,
            targetBuild: targetBuild
        ))

        // 4. OpenCode
        let opencodeConfigDir = home.appending(path: ".config/opencode")
        let opencodeUserURL = opencodeConfigDir.appending(path: "mcp.json")
        let opencodeAppExists = FileManager.default.fileExists(atPath: "/Applications/OpenCode.app") ||
                                FileManager.default.fileExists(atPath: home.appending(path: "Applications/OpenCode.app").path) ||
                                FileManager.default.fileExists(atPath: "/opt/homebrew/bin/opencode") ||
                                FileManager.default.fileExists(atPath: "/usr/local/bin/opencode")
        let opencodeMetadata = opencodeAppExists ? readMcpMetadata(at: opencodeUserURL) : (version: nil, build: nil)
        let opencodeInstalledVer = opencodeMetadata.version
        let opencodeSynced = opencodeAppExists && versionsCompatible && opencodeInstalledVer != nil && opencodeInstalledVer == targetVersion && opencodeMetadata.build == targetBuild
        let opencodeOutdated = opencodeAppExists && opencodeInstalledVer != nil && opencodeInstalledVer != targetVersion
        platforms.append(EditorPlatformStatus(
            id: "opencode",
            name: "OpenCode",
            iconSystemName: "curlybraces",
            isAppInstalled: opencodeAppExists,
            isSynced: opencodeSynced,
            installedVersion: opencodeInstalledVer,
            targetVersion: targetVersion,
            isOutdated: opencodeOutdated,
            configPath: "~/.config/opencode/mcp.json",
            appVersion: appVersion,
            installedBuild: opencodeMetadata.build,
            targetBuild: targetBuild
        ))

        // 5. Codex
        let codexUrl = try? codexExecutable()
        let codexAppExists = codexUrl != nil ||
                             FileManager.default.fileExists(atPath: "/Applications/ChatGPT.app") ||
                             FileManager.default.fileExists(atPath: home.appending(path: ".codex").path)
        let codexStatus = readCodexStatus(targetVersion: targetVersion, targetBuild: targetBuild)
        platforms.append(EditorPlatformStatus(
            id: "codex",
            name: "Codex",
            iconSystemName: "command",
            isAppInstalled: codexAppExists,
            isSynced: codexAppExists && versionsCompatible && codexStatus.isSynced,
            installedVersion: codexAppExists ? codexStatus.version : nil,
            targetVersion: targetVersion,
            isOutdated: codexAppExists && codexStatus.isOutdated,
            configPath: "~/.codex/config.toml",
            appVersion: appVersion,
            installedBuild: codexAppExists ? codexStatus.build : nil,
            targetBuild: targetBuild
        ))

        return platforms
    }

    static func syncPlatform(id: String, projectRoot: URL?, marketplaceRoot: URL) throws {
        let targetVersion = bundledTargetVersion(marketplaceRoot: marketplaceRoot)
        let targetBuild = bundledPluginBuildID(marketplaceRoot: marketplaceRoot)
        let appVersion = bundledAppVersion(marketplaceRoot: marketplaceRoot)
        guard appVersion == targetVersion else {
            throw CommandFailure(output: "mdflow app v\(appVersion) and plugin v\(targetVersion) are different; rebuild or re-sync from one matching bundle.")
        }
        let serverScript = marketplaceRoot
            .appending(path: "plugins/mdflow/server/mdflow-mcp.mjs")
            .standardizedFileURL.path
        let skillSource = marketplaceRoot
            .appending(path: "plugins/mdflow/skills/mdflow")
            .standardizedFileURL
        let home = FileManager.default.homeDirectoryForCurrentUser

        switch id {
        case "claude":
            let claudeConfigURL = home.appending(path: "Library/Application Support/Claude/claude_desktop_config.json")
            try? FileManager.default.createDirectory(at: claudeConfigURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            _ = configureJsonMcp(at: claudeConfigURL, serverScript: serverScript, version: targetVersion, build: targetBuild)

        case "cursor":
            // 1. User/Global Cursor config ONLY
            let userCursorDir = home.appending(path: ".cursor")
            try? FileManager.default.createDirectory(at: userCursorDir, withIntermediateDirectories: true)
            _ = configureJsonMcp(at: userCursorDir.appending(path: "mcp.json"), serverScript: serverScript, version: targetVersion, build: targetBuild)
            syncDirectory(from: skillSource, to: userCursorDir.appending(path: "skills/mdflow"))

            // 2. Only update project root IF .cursor directory already explicitly existed
            if let root = projectRoot {
                let projectCursorDir = root.appending(path: ".cursor")
                if FileManager.default.fileExists(atPath: projectCursorDir.path) {
                    _ = configureJsonMcp(at: projectCursorDir.appending(path: "mcp.json"), serverScript: serverScript, version: targetVersion, build: targetBuild)
                }
            }

        case "antigravity":
            // 1. User/Global Antigravity config ONLY
            let geminiConfigDir = home.appending(path: ".gemini/config")
            try? FileManager.default.createDirectory(at: geminiConfigDir, withIntermediateDirectories: true)
            _ = configureJsonMcp(at: geminiConfigDir.appending(path: "mcp_config.json"), serverScript: serverScript, version: targetVersion, build: targetBuild)
            syncDirectory(from: skillSource, to: geminiConfigDir.appending(path: "skills/mdflow"))

            // 2. Only update project root IF .agents/mcp_config.json already explicitly existed
            if let root = projectRoot {
                let projectAgentsConfig = root.appending(path: ".agents/mcp_config.json")
                if FileManager.default.fileExists(atPath: projectAgentsConfig.path) {
                    _ = configureJsonMcp(at: projectAgentsConfig, serverScript: serverScript, version: targetVersion, build: targetBuild)
                }
            }

        case "opencode":
            // 1. User/Global OpenCode config ONLY
            let userOpencodeDir = home.appending(path: ".config/opencode")
            try? FileManager.default.createDirectory(at: userOpencodeDir, withIntermediateDirectories: true)
            _ = configureJsonMcp(at: userOpencodeDir.appending(path: "mcp.json"), serverScript: serverScript, version: targetVersion, build: targetBuild)
            syncDirectory(from: skillSource, to: userOpencodeDir.appending(path: "skills/mdflow"))

            // 2. Only update project root IF .opencode directory already explicitly existed
            if let root = projectRoot {
                let projectOpencodeDir = root.appending(path: ".opencode")
                if FileManager.default.fileExists(atPath: projectOpencodeDir.path) {
                    _ = configureJsonMcp(at: projectOpencodeDir.appending(path: "mcp.json"), serverScript: serverScript, version: targetVersion, build: targetBuild)
                }
            }

        case "codex":
            let codexConfigURL = home.appending(path: ".codex/config.toml")
            let userPluginsMdflow = home.appending(path: "plugins/mdflow")
            let personalMarketplaceDir = home.appending(path: ".agents/plugins")
            let personalMarketplaceURL = personalMarketplaceDir.appending(path: "marketplace.json")

            // 1. Clean up legacy marketplace mdflow-development if present
            cleanCodexLegacyMarketplace(configURL: codexConfigURL)
            try? FileManager.default.removeItem(at: home.appending(path: ".codex/plugins/cache/mdflow-development"))
            if let executable = try? codexExecutable() {
                _ = try? run(executable, arguments: ["plugin", "remove", "mdflow@mdflow-development", "--json"])
                _ = try? run(executable, arguments: ["plugin", "marketplace", "remove", "mdflow-development", "--json"])
            }

            // 2. Sync plugin bundle to ~/plugins/mdflow
            let pluginSource = marketplaceRoot.appending(path: "plugins/mdflow")
            syncDirectory(from: pluginSource, to: userPluginsMdflow)

            // Update version in ~/plugins/mdflow/.codex-plugin/plugin.json
            let pluginJsonURL = userPluginsMdflow.appending(path: ".codex-plugin/plugin.json")
            if let data = try? Data(contentsOf: pluginJsonURL),
               var json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                json["version"] = targetVersion
                if let updatedData = try? JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted, .sortedKeys]) {
                    try? updatedData.write(to: pluginJsonURL)
                }
            }

            // 3. Ensure ~/.agents/plugins/marketplace.json has personal marketplace with mdflow
            try? FileManager.default.createDirectory(at: personalMarketplaceDir, withIntermediateDirectories: true)
            let marketplaceEntry: [String: Any] = [
                "name": "personal",
                "interface": [
                    "displayName": "Personal"
                ],
                "plugins": [
                    [
                        "name": "mdflow",
                        "source": [
                            "source": "local",
                            "path": "./plugins/mdflow"
                        ],
                        "policy": [
                            "installation": "AVAILABLE",
                            "authentication": "ON_INSTALL"
                        ],
                        "category": "Productivity"
                    ]
                ]
            ]
            if let mpData = try? JSONSerialization.data(withJSONObject: marketplaceEntry, options: [.prettyPrinted, .sortedKeys]) {
                try? mpData.write(to: personalMarketplaceURL)
            }

            // 4. Install plugin via official codex plugin add mdflow@personal
            if let executable = try? codexExecutable() {
                let installResult = try? run(executable, arguments: ["plugin", "add", "mdflow@personal", "--json"])
                if installResult?.status != 0 {
                    configureTomlMcp(at: codexConfigURL, serverScript: serverScript, version: targetVersion, build: targetBuild)
                }
            }

            // 5. The plugin manifest owns its MCP server. Registering the same
            // server again with `codex mcp add` creates duplicate tool surfaces
            // and makes the agent choose between stale and current instances.
            // Keep the legacy TOML fallback only when the Codex executable is
            // unavailable and the native plugin cannot be installed.
            if (try? codexExecutable()) == nil {
                configureTomlMcp(at: codexConfigURL, serverScript: serverScript, version: targetVersion, build: targetBuild)
            }

        default:
            break
        }
    }

    static func installAll(projectRoot: URL?, marketplaceRoot: URL) throws {
        let statuses = detectAllPlatforms(projectRoot: projectRoot, marketplaceRoot: marketplaceRoot)
        for platform in statuses where platform.isAppInstalled {
            try syncPlatform(id: platform.id, projectRoot: projectRoot, marketplaceRoot: marketplaceRoot)
        }
    }

    static func install(marketplaceRoot: URL) throws {
        try installAll(projectRoot: nil, marketplaceRoot: marketplaceRoot)
    }

    static func isInstalled(marketplaceRoot: URL) throws -> Bool {
        let platforms = detectAllPlatforms(projectRoot: nil, marketplaceRoot: marketplaceRoot)
        return platforms.contains { $0.isSynced }
    }

    private static func readMcpMetadata(at configURL: URL) -> (version: String?, build: String?) {
        guard FileManager.default.fileExists(atPath: configURL.path),
              let data = try? Data(contentsOf: configURL),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let servers = json["mcpServers"] as? [String: Any],
              let mdflow = servers["mdflow"] as? [String: Any] else {
            return (nil, nil)
        }
        var version: String?
        if let ver = mdflow["_version"] as? String {
            version = ver
        } else if let ver = mdflow["version"] as? String {
            version = ver
        }
        // A server entry without an mdflow version is legacy/unknown, not
        // proof that the installed plugin matches the current App bundle.
        return (version, mdflow["_build"] as? String)
    }

    private static func configureJsonMcp(at configURL: URL, serverScript: String, version: String, build: String) -> Bool {
        var json: [String: Any] = [:]
        if FileManager.default.fileExists(atPath: configURL.path),
           let data = try? Data(contentsOf: configURL),
           let existing = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
            json = existing
        }
        var mcpServers = json["mcpServers"] as? [String: Any] ?? [:]
        mcpServers["mdflow"] = [
            "command": "node",
            "args": [serverScript],
            "_version": version,
            "_build": build
        ]
        json["mcpServers"] = mcpServers
        guard let outputData = try? JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted, .sortedKeys]) else {
            return false
        }
        do {
            try outputData.write(to: configURL)
            return true
        } catch {
            return false
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

    private static func syncDirectory(from sourceURL: URL, to destURL: URL) {
        let fm = FileManager.default
        guard fm.fileExists(atPath: sourceURL.path) else { return }
        try? fm.createDirectory(at: destURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let temporaryURL = destURL.deletingLastPathComponent()
            .appending(path: ".\(destURL.lastPathComponent).tmp-\(UUID().uuidString)")
        do {
            try? fm.removeItem(at: temporaryURL)
            try fm.copyItem(at: sourceURL, to: temporaryURL)
            if fm.fileExists(atPath: destURL.path) {
                try fm.removeItem(at: destURL)
            }
            try fm.moveItem(at: temporaryURL, to: destURL)
        } catch {
            try? fm.removeItem(at: temporaryURL)
        }
    }

    private static func readCodexStatus(targetVersion: String, targetBuild: String) -> (isInstalled: Bool, isSynced: Bool, isOutdated: Bool, version: String?, build: String?) {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let pluginJsonURL = home.appending(path: "plugins/mdflow/.codex-plugin/plugin.json")
        let codexConfigURL = home.appending(path: ".codex/config.toml")
        
        guard FileManager.default.fileExists(atPath: codexConfigURL.path),
              let content = try? String(contentsOf: codexConfigURL, encoding: .utf8) else {
            return (false, false, false, nil, nil)
        }

        // The plugin is only considered installed if actively registered in ~/.codex/config.toml
        let hasPlugin = content.contains("[plugins.\"mdflow@personal\"]") || content.contains("[plugins.\"mdflow")
        let hasMcp = content.contains("[mcp_servers.mdflow]")
        guard hasPlugin || hasMcp else {
            return (false, false, false, nil, nil)
        }

        var detectedVer: String? = nil
        var detectedBuild: String? = nil
        let installedPluginRoot = home.appending(path: "plugins/mdflow", directoryHint: .isDirectory)
        detectedBuild = pluginBuildID(pluginRoot: installedPluginRoot)
        
        if FileManager.default.fileExists(atPath: pluginJsonURL.path),
           let data = try? Data(contentsOf: pluginJsonURL),
           let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
           let ver = json["version"] as? String {
            detectedVer = ver.components(separatedBy: "+").first ?? ver
        }

        if detectedVer == nil {
            for line in content.components(separatedBy: .newlines) {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed.starts(with: "MDFLOW_VERSION") {
                    let parts = trimmed.components(separatedBy: "=")
                    if parts.count >= 2 {
                        detectedVer = parts[1].trimmingCharacters(in: CharacterSet(charactersIn: " \"'"))
                        break
                    }
                }
            }
        }

        if detectedBuild == nil {
            for line in content.components(separatedBy: .newlines) {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed.starts(with: "MDFLOW_BUILD") {
                    let parts = trimmed.components(separatedBy: "=")
                    if parts.count >= 2 {
                        detectedBuild = parts[1].trimmingCharacters(in: CharacterSet(charactersIn: " \"'"))
                        break
                    }
                }
            }
        }

        guard let ver = detectedVer else {
            return (true, false, false, nil, detectedBuild)
        }
        let isSynced = (ver == targetVersion)
        let isOutdated = (ver != targetVersion)
        return (true, isSynced && detectedBuild == targetBuild, isOutdated, ver, detectedBuild)
    }

    private static func cleanCodexLegacyMarketplace(configURL: URL) {
        guard let configContent = try? String(contentsOf: configURL, encoding: .utf8),
              configContent.contains("mdflow-development") else { return }
        var cleanedLines: [String] = []
        var skipSection = false
        for line in configContent.components(separatedBy: .newlines) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed == "[marketplaces.mdflow-development]" || trimmed == "[plugins.\"mdflow@mdflow-development\"]" {
                skipSection = true
                continue
            }
            if skipSection && trimmed.hasPrefix("[") {
                skipSection = false
            }
            if !skipSection {
                cleanedLines.append(line)
            }
        }
        try? cleanedLines.joined(separator: "\n").write(to: configURL, atomically: true, encoding: .utf8)
    }

    private static func configureTomlMcp(at configURL: URL, serverScript: String, version: String, build: String) {
        var content = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        if !content.contains("[mcp_servers.mdflow]") {
            content += """
            
            [mcp_servers.mdflow]
            command = "node"
            args = ["--no-warnings=ExperimentalWarning", "\(serverScript)"]
            
            [mcp_servers.mdflow.env]
            MDFLOW_VERSION = "\(version)"
            MDFLOW_BUILD = "\(build)"
            """
            try? content.write(to: configURL, atomically: true, encoding: .utf8)
        }
    }
}
