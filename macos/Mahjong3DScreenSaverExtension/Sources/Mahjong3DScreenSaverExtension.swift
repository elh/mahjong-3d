import Foundation
import ScreenSaver

private let logger = Mahjong3DLog.logger("Extension")

@objc(Mahjong3DScreenSaverExtension)
final class Mahjong3DScreenSaverExtension: ScreenSaverExtension {
    override init() {
        Mahjong3DLog.info(logger, "init pid=\(ProcessInfo.processInfo.processIdentifier)")
        super.init()
    }
}
