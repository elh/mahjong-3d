import Foundation
import ScreenSaver

private let logger = Mahjong3DLog.logger("Extension")

@objc(Mahjong3DScreenSaverExtension)
final class Mahjong3DScreenSaverExtension: ScreenSaverExtension {
    override init() {
        logger.info("init pid=\(ProcessInfo.processInfo.processIdentifier, privacy: .public)")
        super.init()
    }
}
