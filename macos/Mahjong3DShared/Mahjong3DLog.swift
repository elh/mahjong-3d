import Foundation
import os.log

enum Mahjong3DLog {
    private final class BundleToken {}

    static let subsystem = "io.github.elh.mahjong-3d.app"

    static func logger(_ category: String) -> Logger {
        Logger(subsystem: subsystem, category: category)
    }

    static var isEnabled: Bool {
        #if DEBUG
            return true
        #else
            return loggingFlagValue().map(isTruthy) ?? false
        #endif
    }

    static func debug(_ logger: Logger, _ message: @autoclosure () -> String) {
        guard isEnabled else {
            return
        }
        let text = message()
        logger.debug("\(text, privacy: .public)")
    }

    static func info(_ logger: Logger, _ message: @autoclosure () -> String) {
        guard isEnabled else {
            return
        }
        let text = message()
        logger.info("\(text, privacy: .public)")
    }

    static func error(_ logger: Logger, _ message: @autoclosure () -> String) {
        guard isEnabled else {
            return
        }
        let text = message()
        logger.error("\(text, privacy: .public)")
    }

    private static func loggingFlagValue() -> String? {
        let bundles = [Bundle(for: BundleToken.self), Bundle.main]
        return bundles.lazy
            .compactMap { $0.url(forResource: "LoggingEnabled", withExtension: "txt") }
            .compactMap { try? String(contentsOf: $0, encoding: .utf8) }
            .first
    }

    private static func isTruthy(_ rawValue: String) -> Bool {
        switch rawValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "1", "true", "yes", "on", "debug":
            return true
        default:
            return false
        }
    }
}
