import Combine
import Foundation

private let logger = Mahjong3DLog.logger("PluginManager")

@MainActor
final class PluginManager: ObservableObject {
    @Published var isInstalled = false
    @Published var installedVersion: String?
    @Published var installedPath: String?
    @Published var isLoading = false
    @Published var lastError: String?

    private let bundleIdentifier = "io.github.elh.mahjong-3d.app.screensaver"

    var embeddedExtensionPath: String? {
        Bundle.main.builtInPlugInsURL?
            .appendingPathComponent("Mahjong3DScreenSaverExtension.appex")
            .path
    }

    var embeddedVersion: String? {
        guard
            let path = embeddedExtensionPath,
            let bundle = Bundle(path: path),
            let version = bundle.infoDictionary?["CFBundleShortVersionString"] as? String
        else {
            return nil
        }
        return version
    }

    init() {
        refresh()
    }

    func refresh() {
        isLoading = true
        lastError = nil

        Task {
            do {
                let result = try await queryPluginKit()
                await MainActor.run {
                    self.isInstalled = result.isRegistered
                    self.installedPath = result.path
                    self.installedVersion = result.version
                    self.isLoading = false
                }
            } catch {
                await MainActor.run {
                    self.isInstalled = false
                    self.installedPath = nil
                    self.installedVersion = nil
                    self.isLoading = false
                    self.lastError = error.localizedDescription
                }
            }
        }
    }

    func install() throws {
        guard let extensionPath = embeddedExtensionPath else {
            throw PluginError.embeddedExtensionNotFound
        }
        guard FileManager.default.fileExists(atPath: extensionPath) else {
            throw PluginError.embeddedExtensionNotFound
        }

        Mahjong3DLog.info(logger, "Registering extension at \(extensionPath)")
        isLoading = true
        lastError = nil
        do {
            _ = try runProcess("/usr/bin/pluginkit", arguments: ["-a", extensionPath])
            refresh()
        } catch {
            isLoading = false
            lastError = error.localizedDescription
            throw error
        }
    }

    func uninstall() throws {
        guard let extensionPath = installedPath ?? embeddedExtensionPath else {
            throw PluginError.extensionPathNotFound
        }

        Mahjong3DLog.info(logger, "Unregistering extension at \(extensionPath)")
        isLoading = true
        lastError = nil
        do {
            _ = try runProcess("/usr/bin/pluginkit", arguments: ["-r", extensionPath])
            refresh()
        } catch {
            isLoading = false
            lastError = error.localizedDescription
            throw error
        }
    }

    private func queryPluginKit() async throws -> (isRegistered: Bool, path: String?, version: String?) {
        let output = try runProcess("/usr/bin/pluginkit", arguments: ["-m", "-v", "-p", "com.apple.screensaver"])

        for line in output.components(separatedBy: "\n") where line.contains(bundleIdentifier) {
            Mahjong3DLog.info(logger, "Found extension in pluginkit output: \(line)")
            let version = versionFromPluginKitLine(line)
            let path = pathFromPluginKitLine(line)
            return (true, path, version)
        }

        return (false, nil, nil)
    }

    private func runProcess(_ executablePath: String, arguments: [String]) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executablePath)
        process.arguments = arguments

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe

        try process.run()
        process.waitUntilExit()

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let output = String(data: data, encoding: .utf8) ?? ""
        Mahjong3DLog.debug(logger, "Process output: \(output)")

        return output
    }
}

private func versionFromPluginKitLine(_ line: String) -> String? {
    guard
        let start = line.firstIndex(of: "("),
        let end = line[start...].firstIndex(of: ")")
    else {
        return nil
    }
    return String(line[line.index(after: start)..<end])
}

private func pathFromPluginKitLine(_ line: String) -> String? {
    guard let start = line.firstIndex(of: "/") else {
        return nil
    }
    return String(line[start...])
}

enum PluginError: LocalizedError {
    case embeddedExtensionNotFound
    case extensionPathNotFound

    var errorDescription: String? {
        switch self {
        case .embeddedExtensionNotFound:
            return "The embedded screen saver extension was not found in this app bundle."
        case .extensionPathNotFound:
            return "The screen saver extension path could not be resolved."
        }
    }
}
