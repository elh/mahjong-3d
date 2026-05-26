import AppKit
import CoreGraphics
import os.log
import ScreenSaver
import UniformTypeIdentifiers
import WebKit

@objc(Mahjong3DScreenSaverView)
final class Mahjong3DScreenSaverView: ScreenSaverView, WKNavigationDelegate {
    fileprivate static let webScheme = "mahjong3d-saver"
    private static let startupBackgroundColor = NSColor(
        calibratedRed: 0.075,
        green: 0.086,
        blue: 0.078,
        alpha: 1
    )
    private static let inactiveDebounceSeconds = 1.5
    private static let rendererCoordinator = ScreenSaverRendererCoordinator()
    private static var nextInstanceOrdinalValue = 0

    private var webView: WKWebView?
    private var webSchemeHandler: BundledWebSchemeHandler?
    private let previewMode: Bool
    fileprivate let instanceOrdinal: Int
    private let instanceID = UUID().uuidString.prefix(8)
    private let log = ScreenSaverLog()
    private let targetFrameInterval = 1.0 / 60.0
    private var lifecycleSequence = 0
    private var inactiveWorkItem: DispatchWorkItem?
    private var webActive = true
    private var webPreview: Bool
    private var renderFrameInFlight = false
    private var fullscreenRunActive = false
    private var fullscreenNeedsFreshStart = false
    private var ownsRenderer = false
    private var loadSequence = 0

    override init?(frame: NSRect, isPreview: Bool) {
        self.previewMode = isPreview
        self.webPreview = isPreview
        self.instanceOrdinal = Mahjong3DScreenSaverView.allocateInstanceOrdinal()
        super.init(frame: frame, isPreview: isPreview)
        animationTimeInterval = targetFrameInterval
        log.write("instance[\(instanceID)] lifecycle[\(nextLifecycleSequence())] init ordinal=\(instanceOrdinal) preview=\(isPreview) frame=\(frame)")
    }

    required init?(coder: NSCoder) {
        self.previewMode = false
        self.webPreview = false
        self.instanceOrdinal = Mahjong3DScreenSaverView.allocateInstanceOrdinal()
        super.init(coder: coder)
        animationTimeInterval = targetFrameInterval
        log.write("instance[\(instanceID)] lifecycle[\(nextLifecycleSequence())] init coder ordinal=\(instanceOrdinal) preview=false frame=\(frame)")
    }

    override func startAnimation() {
        super.startAnimation()
        let sequence = nextLifecycleSequence()
        log.write("instance[\(instanceID)] lifecycle[\(sequence)] startAnimation frame=\(frame) bounds=\(bounds)")
        cancelInactiveTransition(reason: "startAnimation", sequence: sequence)
        if !previewMode, !acquireRendererOwnership(sequence: sequence) {
            return
        }
        prepareWebViewForStart(sequence: sequence)
        syncWebViewFrame()
        setWebActive(true, reason: "startAnimation", sequence: sequence)
    }

    override func stopAnimation() {
        let sequence = nextLifecycleSequence()
        log.write("instance[\(instanceID)] lifecycle[\(sequence)] stopAnimation")
        if !previewMode {
            fullscreenNeedsFreshStart = true
        }
        scheduleInactiveTransition(sequence: sequence)
        super.stopAnimation()
    }

    override func animateOneFrame() {
        renderWebFrame()
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        log.write("instance[\(instanceID)] lifecycle[\(nextLifecycleSequence())] setFrameSize \(newSize)")
        syncWebViewFrame()
    }

    override func layout() {
        super.layout()
        syncWebViewFrame()
    }

    override func removeFromSuperview() {
        let sequence = nextLifecycleSequence()
        log.write("instance[\(instanceID)] lifecycle[\(sequence)] removeFromSuperview")
        cancelInactiveTransition(reason: "removeFromSuperview", sequence: sequence)
        setWebActive(false, reason: "teardown", sequence: sequence)
        tearDownWebView()
        fullscreenRunActive = false
        releaseRendererOwnership(reason: "removeFromSuperview", sequence: sequence)
        super.removeFromSuperview()
    }

    deinit {
        let sequence = nextLifecycleSequence()
        log.write("instance[\(instanceID)] lifecycle[\(sequence)] deinit")
        cancelInactiveTransition(reason: "deinit", sequence: sequence)
        setWebActive(false, reason: "deinit", sequence: sequence)
        tearDownWebView()
        fullscreenRunActive = false
        releaseRendererOwnership(reason: "deinit", sequence: sequence)
    }

    private static func allocateInstanceOrdinal() -> Int {
        nextInstanceOrdinalValue += 1
        return nextInstanceOrdinalValue
    }

    private func acquireRendererOwnership(sequence: Int) -> Bool {
        let acquired = Self.rendererCoordinator.acquire(self)
        ownsRenderer = acquired
        if acquired {
            log.write("instance[\(instanceID)] lifecycle[\(sequence)] renderer ownership acquired builtIn=\(isLikelyBuiltInDisplay())")
            return true
        }

        log.write("instance[\(instanceID)] lifecycle[\(sequence)] renderer ownership denied builtIn=\(isLikelyBuiltInDisplay())")
        setWebActive(false, reason: "rendererOwnershipDenied", sequence: sequence)
        tearDownWebView()
        fullscreenRunActive = false
        fullscreenNeedsFreshStart = true
        return false
    }

    private func releaseRendererOwnership(reason: String, sequence: Int) {
        if ownsRenderer {
            Self.rendererCoordinator.release(self)
            ownsRenderer = false
            log.write("instance[\(instanceID)] lifecycle[\(sequence)] renderer ownership released reason=\(reason)")
        }
    }

    fileprivate func forceReleaseRenderer(reason: String) {
        let sequence = nextLifecycleSequence()
        log.write("instance[\(instanceID)] lifecycle[\(sequence)] renderer ownership revoked reason=\(reason)")
        cancelInactiveTransition(reason: "rendererRevoked", sequence: sequence)
        setWebActive(false, reason: "rendererRevoked", sequence: sequence)
        tearDownWebView()
        fullscreenRunActive = false
        fullscreenNeedsFreshStart = true
        ownsRenderer = false
    }

    fileprivate func isLikelyBuiltInDisplay() -> Bool {
        guard let screen = closestScreenBySize() else {
            return NSScreen.screens.count <= 1
        }

        guard
            let screenNumber = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
        else {
            return NSScreen.screens.count <= 1
        }

        return CGDisplayIsBuiltin(CGDirectDisplayID(screenNumber.uint32Value)) != 0
    }

    private func closestScreenBySize() -> NSScreen? {
        let targetSize = bounds.size == .zero ? frame.size : bounds.size
        guard targetSize.width > 0, targetSize.height > 0 else {
            return nil
        }

        return NSScreen.screens.min { left, right in
            screenSizeDistance(left, targetSize: targetSize) < screenSizeDistance(right, targetSize: targetSize)
        }
    }

    private func screenSizeDistance(_ screen: NSScreen, targetSize: NSSize) -> CGFloat {
        abs(screen.frame.width - targetSize.width) + abs(screen.frame.height - targetSize.height)
    }

    private func prepareWebViewForStart(sequence: Int) {
        if previewMode {
            if webView == nil {
                log.write("instance[\(instanceID)] lifecycle[\(sequence)] creating preview web view")
                configureWebView(sequence: sequence)
            }
            return
        }

        if fullscreenRunActive, !fullscreenNeedsFreshStart, webView != nil {
            return
        }

        log.write("instance[\(instanceID)] lifecycle[\(sequence)] creating fresh fullscreen web view")
        tearDownWebView()
        fullscreenRunActive = true
        fullscreenNeedsFreshStart = false
        configureWebView(sequence: sequence)
    }

    private func configureWebView(sequence: Int) {
        wantsLayer = true
        layer?.backgroundColor = Self.startupBackgroundColor.cgColor

        let configuration = WKWebViewConfiguration()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configureInactiveSchedulingPolicy(configuration.preferences)
        configuration.suppressesIncrementalRendering = false
        configuration.websiteDataStore = .nonPersistent()
        let userContentController = WKUserContentController()
        userContentController.addUserScript(
            WKUserScript(
                source: """
                document.documentElement.style.backgroundColor = '#131614';
                document.documentElement.style.colorScheme = 'dark';
                document.addEventListener('DOMContentLoaded', function() {
                  if (document.body) {
                    document.body.style.backgroundColor = '#131614';
                  }
                  var root = document.getElementById('root');
                  if (root) {
                    root.style.backgroundColor = '#131614';
                  }
                });
                window.addEventListener('error', function(event) {
                  window.webkit.messageHandlers.mahjong3DLog.postMessage('js error: ' + event.message + ' at ' + event.filename + ':' + event.lineno + ':' + event.colno);
                });
                window.addEventListener('unhandledrejection', function(event) {
                  window.webkit.messageHandlers.mahjong3DLog.postMessage('unhandled rejection: ' + String(event.reason && (event.reason.stack || event.reason.message || event.reason)));
                });
                """,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: false
            )
        )
        userContentController.add(self, name: "mahjong3DLog")
        configuration.userContentController = userContentController
        if let webRootURL = Bundle(for: Self.self).resourceURL?.appendingPathComponent("Web", isDirectory: true) {
            let schemeHandler = BundledWebSchemeHandler(webRootURL: webRootURL)
            configuration.setURLSchemeHandler(schemeHandler, forURLScheme: Self.webScheme)
            webSchemeHandler = schemeHandler
            log.write("instance[\(instanceID)] web root \(webRootURL.path)")
        } else {
            log.write("instance[\(instanceID)] missing web root")
        }

        let view = WKWebView(frame: bounds, configuration: configuration)
        view.autoresizingMask = [.width, .height]
        view.navigationDelegate = self
        view.setValue(false, forKey: "drawsBackground")
        addSubview(view)
        webView = view
        syncWebViewFrame()

        loadBundledWebApp(sequence: sequence)
    }

    private func configureInactiveSchedulingPolicy(_ preferences: WKPreferences) {
        if #available(macOS 14.0, *) {
            preferences.inactiveSchedulingPolicy = .none
            log.write("instance[\(instanceID)] WK inactiveSchedulingPolicy=none")
        } else {
            log.write("instance[\(instanceID)] WK inactiveSchedulingPolicy unavailable")
        }
    }

    private func loadBundledWebApp(sequence: Int) {
        loadSequence += 1
        var components = URLComponents()
        components.scheme = Self.webScheme
        components.host = "app"
        components.path = "/index.html"
        components.queryItems = [
            URLQueryItem(name: "surface", value: "screensaver"),
            URLQueryItem(name: "session", value: "\(loadSequence)"),
        ]
        if previewMode {
            components.queryItems?.append(URLQueryItem(name: "preview", value: "1"))
        }

        guard let appURL = components.url else {
            log.write("failed to build app URL")
            return
        }

        log.write("instance[\(instanceID)] load \(appURL.absoluteString)")
        let request = URLRequest(
            url: appURL,
            cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
            timeoutInterval: 30
        )
        webView?.load(request)
        log.write("instance[\(instanceID)] lifecycle[\(sequence)] load session=\(loadSequence)")
    }

    private func tearDownWebView() {
        guard let view = webView else {
            return
        }
        inactiveWorkItem?.cancel()
        inactiveWorkItem = nil
        view.stopLoading()
        view.navigationDelegate = nil
        view.configuration.userContentController.removeScriptMessageHandler(forName: "mahjong3DLog")
        view.removeFromSuperview()
        webView = nil
        webSchemeHandler = nil
    }

    private func syncWebViewFrame() {
        webView?.frame = bounds
        webView?.layer?.backgroundColor = Self.startupBackgroundColor.cgColor
    }

    private func nextLifecycleSequence() -> Int {
        lifecycleSequence += 1
        return lifecycleSequence
    }

    private func scheduleInactiveTransition(sequence: Int) {
        inactiveWorkItem?.cancel()
        let workItem = DispatchWorkItem { [weak self] in
            guard let self else {
                return
            }
            self.log.write("instance[\(self.instanceID)] lifecycle[\(sequence)] inactive debounce fired")
            self.setWebActive(false, reason: "debouncedStopAnimation", sequence: sequence)
            if !self.previewMode {
                self.tearDownWebView()
                self.fullscreenRunActive = false
                self.fullscreenNeedsFreshStart = true
                self.releaseRendererOwnership(reason: "debouncedStopAnimation", sequence: sequence)
                self.log.write("instance[\(self.instanceID)] lifecycle[\(sequence)] fullscreen web view torn down after stop")
            }
            self.inactiveWorkItem = nil
        }
        inactiveWorkItem = workItem
        log.write("instance[\(instanceID)] lifecycle[\(sequence)] inactive debounce scheduled \(Self.inactiveDebounceSeconds)s")
        DispatchQueue.main.asyncAfter(
            deadline: .now() + Self.inactiveDebounceSeconds,
            execute: workItem
        )
    }

    private func cancelInactiveTransition(reason: String, sequence: Int) {
        guard let inactiveWorkItem else {
            return
        }
        inactiveWorkItem.cancel()
        self.inactiveWorkItem = nil
        log.write("instance[\(instanceID)] lifecycle[\(sequence)] inactive debounce canceled reason=\(reason)")
    }

    private func setWebActive(_ active: Bool, reason: String, sequence: Int) {
        webActive = active
        evaluateBridgeCall("setActive(\(active ? "true" : "false"))", reason: reason, sequence: sequence)
    }

    private func setWebPreview(_ preview: Bool, reason: String, sequence: Int) {
        webPreview = preview
        evaluateBridgeCall("setPreview(\(preview ? "true" : "false"))", reason: reason, sequence: sequence)
    }

    private func evaluateBridgeCall(_ call: String, reason: String, sequence: Int) {
        let activeLiteral = webActive ? "true" : "false"
        let previewLiteral = webPreview ? "true" : "false"
        webView?.evaluateJavaScript(
            """
            window.__mahjongScreenSaverNativeState = { active: \(activeLiteral), preview: \(previewLiteral) };
            window.mahjongScreenSaver && window.mahjongScreenSaver.\(call);
            """,
            completionHandler: { [log] _, error in
                if let error {
                    log.write("lifecycle[\(sequence)] bridge \(call) reason=\(reason) failed: \(error.localizedDescription)")
                } else {
                    log.write("lifecycle[\(sequence)] bridge \(call) reason=\(reason) active=\(activeLiteral) preview=\(previewLiteral)")
                }
            }
        )
    }

    private func renderWebFrame() {
        guard webActive, let webView, !renderFrameInFlight else {
            return
        }

        renderFrameInFlight = true
        webView.evaluateJavaScript(
            """
            window.mahjongScreenSaver && window.mahjongScreenSaver.renderFrame && window.mahjongScreenSaver.renderFrame(performance.now());
            """,
            completionHandler: { [weak self, log] _, error in
                self?.renderFrameInFlight = false
                if let error {
                    log.write("renderFrame failed: \(error.localizedDescription)")
                }
            }
        )
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let sequence = nextLifecycleSequence()
        log.write("instance[\(instanceID)] lifecycle[\(sequence)] didFinish \(webView.url?.absoluteString ?? "unknown")")
        cancelInactiveTransition(reason: "didFinish", sequence: sequence)
        setWebPreview(previewMode, reason: "didFinish", sequence: sequence)
        setWebActive(true, reason: "didFinish", sequence: sequence)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        log.write("didFail \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        log.write("didFailProvisionalNavigation \(error.localizedDescription)")
    }
}

extension Mahjong3DScreenSaverView: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        log.write("\(message.body)")
    }
}

final class ScreenSaverRendererCoordinator {
    private weak var owner: Mahjong3DScreenSaverView?
    private var ownerOrdinal = -1
    private var ownerIsBuiltInDisplay = false

    func acquire(_ candidate: Mahjong3DScreenSaverView) -> Bool {
        let candidateIsBuiltInDisplay = candidate.isLikelyBuiltInDisplay()

        guard let currentOwner = owner else {
            setOwner(candidate, isBuiltInDisplay: candidateIsBuiltInDisplay)
            return true
        }

        if currentOwner === candidate {
            return true
        }

        guard shouldReplaceOwner(
            withOrdinal: candidate.instanceOrdinal,
            isBuiltInDisplay: candidateIsBuiltInDisplay
        ) else {
            return false
        }

        currentOwner.forceReleaseRenderer(reason: "rendererTakenOver")
        setOwner(candidate, isBuiltInDisplay: candidateIsBuiltInDisplay)
        return true
    }

    func release(_ candidate: Mahjong3DScreenSaverView) {
        guard owner === candidate else {
            return
        }

        owner = nil
        ownerOrdinal = -1
        ownerIsBuiltInDisplay = false
    }

    private func shouldReplaceOwner(withOrdinal candidateOrdinal: Int, isBuiltInDisplay candidateIsBuiltInDisplay: Bool) -> Bool {
        if candidateIsBuiltInDisplay, !ownerIsBuiltInDisplay {
            return true
        }

        if ownerIsBuiltInDisplay, !candidateIsBuiltInDisplay {
            return false
        }

        return candidateOrdinal > ownerOrdinal
    }

    private func setOwner(_ candidate: Mahjong3DScreenSaverView, isBuiltInDisplay: Bool) {
        owner = candidate
        ownerOrdinal = candidate.instanceOrdinal
        ownerIsBuiltInDisplay = isBuiltInDisplay
    }
}

final class BundledWebSchemeHandler: NSObject, WKURLSchemeHandler {
    private let webRootURL: URL

    init(webRootURL: URL) {
        self.webRootURL = webRootURL
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let requestURL = urlSchemeTask.request.url else {
            finish(urlSchemeTask, statusCode: 400)
            return
        }

        let requestPath = sanitizedRequestPath(requestURL.path)
        let fileURL = webRootURL.appendingPathComponent(requestPath, isDirectory: false)

        guard fileURL.path.hasPrefix(webRootURL.path) else {
            finish(urlSchemeTask, statusCode: 403)
            return
        }

        do {
            let data = try Data(contentsOf: fileURL)
            let response = HTTPURLResponse(
                url: requestURL,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: [
                    "Cache-Control": "no-store, max-age=0",
                    "Content-Length": String(data.count),
                    "Content-Type": mimeType(for: fileURL),
                    "Pragma": "no-cache",
                ]
            )
            if let response {
                urlSchemeTask.didReceive(response)
            }
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            finish(urlSchemeTask, statusCode: 404)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private func sanitizedRequestPath(_ path: String) -> String {
        let trimmedPath = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if trimmedPath.isEmpty {
            return "index.html"
        }

        let components = trimmedPath
            .split(separator: "/")
            .filter { $0 != "." && $0 != ".." }
        return components.joined(separator: "/")
    }

    private func finish(_ urlSchemeTask: WKURLSchemeTask, statusCode: Int) {
        let response = HTTPURLResponse(
            url: urlSchemeTask.request.url ?? URL(string: "\(Mahjong3DScreenSaverView.webScheme)://app/")!,
            statusCode: statusCode,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Cache-Control": "no-store, max-age=0",
                "Content-Type": "text/plain; charset=utf-8",
                "Pragma": "no-cache",
            ]
        )
        if let response {
            urlSchemeTask.didReceive(response)
        }
        urlSchemeTask.didFinish()
    }

    private func mimeType(for fileURL: URL) -> String {
        switch fileURL.pathExtension.lowercased() {
        case "html":
            return "text/html; charset=utf-8"
        case "js":
            return "text/javascript; charset=utf-8"
        case "css":
            return "text/css; charset=utf-8"
        case "svg":
            return "image/svg+xml"
        case "png":
            return "image/png"
        case "jpg", "jpeg":
            return "image/jpeg"
        case "wasm":
            return "application/wasm"
        case "json":
            return "application/json; charset=utf-8"
        case "md":
            return "text/markdown; charset=utf-8"
        default:
            return UTType(filenameExtension: fileURL.pathExtension)?.preferredMIMEType
                ?? "application/octet-stream"
        }
    }
}

final class ScreenSaverLog {
    private let logger = Logger(subsystem: "io.github.elh.mahjong-3d.saver", category: "ScreenSaver")
    private let isEnabled: Bool
    private let fileURL: URL?

    init() {
        self.isEnabled = ProcessInfo.processInfo.environment["MAHJONG3D_SCREENSAVER_LOG"] == "1"
        guard isEnabled else {
            self.fileURL = nil
            return
        }

        let directoryURL = FileManager.default
            .homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/Mahjong3D", isDirectory: true)
        try? FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        self.fileURL = directoryURL.appendingPathComponent("screensaver.log", isDirectory: false)
    }

    func write(_ message: String) {
        guard isEnabled else {
            return
        }

        let line = "\(Date()) \(message)\n"
        logger.info("\(message, privacy: .public)")
        guard
            let fileURL,
            let data = line.data(using: .utf8)
        else {
            return
        }

        if FileManager.default.fileExists(atPath: fileURL.path),
           let handle = try? FileHandle(forWritingTo: fileURL) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: data)
            return
        }

        try? data.write(to: fileURL)
    }
}
