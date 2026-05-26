import AppKit
import ScreenSaver

private let logger = Mahjong3DLog.logger("ViewController")

@objc(Mahjong3DScreenSaverViewController)
final class Mahjong3DScreenSaverViewController: ScreenSaverViewController {
    private var saverView: Mahjong3DExtensionRendererView?

    override func loadView() {
        let frame = NSScreen.main?.frame ?? NSRect(x: 0, y: 0, width: 1920, height: 1080)
        installRenderer(frame: frame, isPreview: frame.width < 400 || frame.height < 300)
    }

    override func loadView(forFrame frame: NSRect, isPreview: Bool) {
        installRenderer(frame: frame, isPreview: isPreview)
    }

    private func installRenderer(frame: NSRect, isPreview: Bool) {
        Mahjong3DLog.info(logger, "load renderer frame=\(frame.debugDescription) preview=\(isPreview)")
        guard let renderer = Mahjong3DExtensionRendererView(frame: frame, isPreview: isPreview) else {
            self.view = NSView(frame: frame)
            return
        }
        saverView = renderer
        self.view = renderer
    }
}
