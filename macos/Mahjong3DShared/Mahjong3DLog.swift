import Foundation
import os.log

enum Mahjong3DLog {
    static let subsystem = "io.github.elh.mahjong-3d.app"

    static func logger(_ category: String) -> Logger {
        Logger(subsystem: subsystem, category: category)
    }
}
