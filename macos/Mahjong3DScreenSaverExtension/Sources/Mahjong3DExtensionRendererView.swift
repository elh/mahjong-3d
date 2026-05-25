import AppKit
import ScreenSaver
import UniformTypeIdentifiers
import WebKit

private let rendererLogger = Mahjong3DLog.logger("Renderer")

final class Mahjong3DExtensionRendererView: ScreenSaverView, WKNavigationDelegate, WKScriptMessageHandler {
    fileprivate static let webScheme = "mahjong3d-saver"
    private static let startupBackgroundColor = NSColor(
        calibratedRed: 0.075,
        green: 0.086,
        blue: 0.078,
        alpha: 1
    )
    private static let frameInterval = 1.0 / 30.0
    private static let renderFrameTimeout = 0.5
    private static let nativeFrameDriverEnabled = true
    private static let diagnosticMode = loadDiagnosticMode()

    private let instanceID = UUID().uuidString.prefix(8)
    private let nativePreview: Bool
    private var webView: WKWebView?
    private var webSchemeHandler: BundledWebSchemeHandler?
    private var nativeDiagnosticView: NativeDiagnosticView?
    private var frameTimer: Timer?
    private var renderFrameTimeoutTimer: Timer?
    private var renderFrameInFlight = false
    private var webActive = false
    private var webPreview: Bool
    private var loadSequence = 0

    override init?(frame frameRect: NSRect, isPreview: Bool) {
        nativePreview = isPreview
        webPreview = isPreview
        super.init(frame: frameRect, isPreview: isPreview)
        commonInit()
    }

    required init?(coder: NSCoder) {
        nativePreview = false
        webPreview = false
        super.init(coder: coder)
        commonInit()
    }

    deinit {
        stopRenderer(reason: "deinit")
        tearDownWebView()
        Mahjong3DLog.info(rendererLogger, "instance[\(self.instanceID)] deinit")
    }

    override func makeBackingLayer() -> CALayer {
        let layer = CALayer()
        layer.backgroundColor = Self.startupBackgroundColor.cgColor
        layer.isOpaque = true
        return layer
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        Mahjong3DLog.info(rendererLogger, "instance[\(self.instanceID)] viewDidMoveToWindow hasWindow=\(self.window != nil)")
        if window != nil {
            startRenderer(reason: "viewDidMoveToWindow")
        } else {
            stopRenderer(reason: "viewDidMoveToWindow nil window")
            tearDownWebView()
        }
    }

    override func startAnimation() {
        super.startAnimation()
        Mahjong3DLog.info(rendererLogger, "instance[\(self.instanceID)] startAnimation")
        startRenderer(reason: "startAnimation")
    }

    override func stopAnimation() {
        Mahjong3DLog.info(rendererLogger, "instance[\(self.instanceID)] stopAnimation")
        if window == nil {
            stopRenderer(reason: "stopAnimation nil window")
        } else {
            Mahjong3DLog.info(rendererLogger, "instance[\(self.instanceID)] ignoring stopAnimation while window is attached")
        }
        super.stopAnimation()
    }

    override func layout() {
        super.layout()
        syncWebViewFrame()
        syncNativeDiagnosticFrame()
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        syncWebViewFrame()
        syncNativeDiagnosticFrame()
    }

    private func commonInit() {
        wantsLayer = true
        layer?.backgroundColor = Self.startupBackgroundColor.cgColor
        animationTimeInterval = Self.frameInterval
        webPreview = nativePreview || bounds.width < 400 || bounds.height < 300
        Mahjong3DLog.info(rendererLogger, "instance[\(self.instanceID)] init size=\(self.bounds.size.debugDescription) preview=\(self.webPreview) diagnosticMode=\(Self.diagnosticMode)")
    }

    private func startRenderer(reason: String) {
        guard window != nil else {
            return
        }

        wantsLayer = true
        layer?.backgroundColor = Self.startupBackgroundColor.cgColor
        webPreview = nativePreview || bounds.width < 400 || bounds.height < 300

        if Self.diagnosticMode == "native-layer" {
            tearDownWebView()
            configureNativeDiagnosticView()
            syncNativeDiagnosticFrame()
            nativeDiagnosticView?.start()
            Mahjong3DLog.info(rendererLogger, "instance[\(self.instanceID)] native diagnostic active reason=\(reason)")
            return
        }

        tearDownNativeDiagnosticView()
        if webView == nil {
            configureWebView()
        }

        syncWebViewFrame()
        setWebPreview(webPreview, reason: reason)
        setWebActive(true, reason: reason)
        if Self.nativeFrameDriverEnabled {
            startFrameTimer()
        } else {
            stopFrameTimer()
        }
    }

    private func stopRenderer(reason: String) {
        nativeDiagnosticView?.stop()
        stopFrameTimer()
        setWebActive(false, reason: reason)
    }

    private static func loadDiagnosticMode() -> String {
        let environmentValue = ProcessInfo.processInfo.environment["MAHJONG3D_SCREENSAVER_DIAGNOSTIC_MODE"]
        let resourceValue = Bundle(for: Mahjong3DExtensionRendererView.self)
            .url(forResource: "DiagnosticMode", withExtension: "txt")
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) }
        let rawValue = (environmentValue ?? resourceValue ?? "app")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        switch rawValue {
        case "app", "native-layer", "dom", "canvas2d", "webgl-static":
            return rawValue
        default:
            Mahjong3DLog.error(rendererLogger, "unsupported diagnostic mode \(rawValue); falling back to app")
            return "app"
        }
    }

    private func configureWebView() {
        let configuration = WKWebViewConfiguration()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configureInactiveSchedulingPolicy(configuration.preferences)
        configuration.suppressesIncrementalRendering = false
        configuration.websiteDataStore = .nonPersistent()

        let userContentController = WKUserContentController()
        userContentController.addUserScript(
            WKUserScript(
                source: """
                window.__mahjongScreenSaverNativeState = {
                  active: \(webActive ? "true" : "false"),
                  preview: \(webPreview ? "true" : "false")
                };
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
        } else {
            Mahjong3DLog.error(rendererLogger, "instance[\(self.instanceID)] missing Web resources")
        }

        let view = WKWebView(frame: bounds, configuration: configuration)
        view.autoresizingMask = [.width, .height]
        view.navigationDelegate = self
        view.setValue(false, forKey: "drawsBackground")
        addSubview(view)
        webView = view

        loadBundledWebApp()
    }

    private func configureInactiveSchedulingPolicy(_ preferences: WKPreferences) {
        if #available(macOS 14.0, *) {
            preferences.inactiveSchedulingPolicy = .none
            Mahjong3DLog.info(rendererLogger, "instance[\(self.instanceID)] WK inactiveSchedulingPolicy=none")
        } else {
            Mahjong3DLog.info(rendererLogger, "instance[\(self.instanceID)] WK inactiveSchedulingPolicy unavailable")
        }
    }

    private func loadBundledWebApp() {
        loadSequence += 1

        var components = URLComponents()
        components.scheme = Self.webScheme
        components.host = "app"
        components.path = "/index.html"
        components.queryItems = [
            URLQueryItem(name: "surface", value: "screensaver"),
            URLQueryItem(name: "session", value: "\(loadSequence)"),
        ]
        if webPreview {
            components.queryItems?.append(URLQueryItem(name: "preview", value: "1"))
        }
        if Self.diagnosticMode != "app" {
            components.queryItems?.append(URLQueryItem(name: "diagnostic", value: Self.diagnosticMode))
        }

        guard let appURL = components.url else {
            Mahjong3DLog.error(rendererLogger, "instance[\(self.instanceID)] failed to build app URL")
            return
        }

        Mahjong3DLog.info(rendererLogger, "instance[\(self.instanceID)] load \(appURL.absoluteString)")
        let request = URLRequest(
            url: appURL,
            cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
            timeoutInterval: 30
        )
        webView?.load(request)
    }

    private func configureNativeDiagnosticView() {
        guard nativeDiagnosticView == nil else {
            return
        }

        let view = NativeDiagnosticView(frame: bounds)
        view.autoresizingMask = [.width, .height]
        addSubview(view)
        nativeDiagnosticView = view
    }

    private func tearDownNativeDiagnosticView() {
        nativeDiagnosticView?.stop()
        nativeDiagnosticView?.removeFromSuperview()
        nativeDiagnosticView = nil
    }

    private func tearDownWebView() {
        guard let view = webView else {
            return
        }
        renderFrameInFlight = false
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

    private func syncNativeDiagnosticFrame() {
        nativeDiagnosticView?.frame = bounds
    }

    private func startFrameTimer() {
        guard frameTimer == nil else {
            return
        }

        let timer = Timer(timeInterval: Self.frameInterval, repeats: true) { [weak self] _ in
            self?.renderWebFrame()
        }
        frameTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func stopFrameTimer() {
        frameTimer?.invalidate()
        frameTimer = nil
        renderFrameTimeoutTimer?.invalidate()
        renderFrameTimeoutTimer = nil
        renderFrameInFlight = false
    }

    private func setWebActive(_ active: Bool, reason: String) {
        webActive = active
        evaluateBridgeCall("setActive(\(active ? "true" : "false"))", reason: reason)
    }

    private func setWebPreview(_ preview: Bool, reason: String) {
        webPreview = preview
        evaluateBridgeCall("setPreview(\(preview ? "true" : "false"))", reason: reason)
    }

    private func evaluateBridgeCall(_ call: String, reason: String) {
        let activeLiteral = webActive ? "true" : "false"
        let previewLiteral = webPreview ? "true" : "false"
        webView?.evaluateJavaScript(
            """
            window.__mahjongScreenSaverNativeState = { active: \(activeLiteral), preview: \(previewLiteral) };
            window.mahjongScreenSaver && window.mahjongScreenSaver.\(call);
            """,
            completionHandler: { errorResult, error in
                if let error {
                    Mahjong3DLog.debug(rendererLogger, "bridge \(call) reason=\(reason) failed result=\(String(describing: errorResult)) error=\(error.localizedDescription)")
                }
            }
        )
    }

    private func renderWebFrame() {
        guard webActive, let webView, !renderFrameInFlight else {
            return
        }

        renderFrameInFlight = true
        renderFrameTimeoutTimer?.invalidate()
        renderFrameTimeoutTimer = Timer.scheduledTimer(withTimeInterval: Self.renderFrameTimeout, repeats: false) { [weak self] _ in
            self?.renderFrameTimeoutTimer = nil
            self?.renderFrameInFlight = false
        }
        webView.evaluateJavaScript(
            """
            window.mahjongScreenSaver && window.mahjongScreenSaver.renderFrame && window.mahjongScreenSaver.renderFrame(performance.now());
            """,
            completionHandler: { [weak self] _, error in
                self?.renderFrameTimeoutTimer?.invalidate()
                self?.renderFrameTimeoutTimer = nil
                self?.renderFrameInFlight = false
                if let error {
                    Mahjong3DLog.debug(rendererLogger, "renderFrame failed: \(error.localizedDescription)")
                }
            }
        )
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Mahjong3DLog.info(rendererLogger, "instance[\(self.instanceID)] didFinish \(webView.url?.absoluteString ?? "unknown")")
        setWebPreview(webPreview, reason: "didFinish")
        setWebActive(true, reason: "didFinish")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        Mahjong3DLog.error(rendererLogger, "didFail \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        Mahjong3DLog.error(rendererLogger, "didFailProvisionalNavigation \(error.localizedDescription)")
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        Mahjong3DLog.info(rendererLogger, "\(String(describing: message.body))")
    }
}

private final class NativeDiagnosticView: NSView {
    private let markerLayer = CALayer()
    private let textLayer = CATextLayer()
    private var timer: Timer?
    private var frameCount = 0
    private let startedAt = ProcessInfo.processInfo.systemUptime

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        commonInit()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        commonInit()
    }

    deinit {
        stop()
    }

    override func layout() {
        super.layout()
        layoutLayers()
    }

    func start() {
        guard timer == nil else {
            return
        }

        tick()
        let timer = Timer(timeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            self?.tick()
        }
        self.timer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    private func commonInit() {
        wantsLayer = true
        layer?.backgroundColor = NSColor(calibratedRed: 0.07, green: 0.09, blue: 0.08, alpha: 1).cgColor

        markerLayer.backgroundColor = NSColor(calibratedRed: 0.91, green: 0.79, blue: 0.36, alpha: 1).cgColor
        markerLayer.cornerRadius = 12
        markerLayer.shadowColor = NSColor.black.cgColor
        markerLayer.shadowOpacity = 0.35
        markerLayer.shadowRadius = 18
        markerLayer.shadowOffset = CGSize(width: 0, height: -4)
        layer?.addSublayer(markerLayer)

        textLayer.contentsScale = NSScreen.main?.backingScaleFactor ?? 2
        textLayer.foregroundColor = NSColor.white.cgColor
        textLayer.backgroundColor = NSColor(calibratedWhite: 0, alpha: 0.45).cgColor
        textLayer.cornerRadius = 6
        textLayer.font = NSFont.monospacedSystemFont(ofSize: 14, weight: .medium)
        textLayer.fontSize = 14
        textLayer.alignmentMode = .left
        layer?.addSublayer(textLayer)

        layoutLayers()
    }

    private func tick() {
        frameCount += 1
        let elapsed = ProcessInfo.processInfo.systemUptime - startedAt
        let width = max(bounds.width, 1)
        let height = max(bounds.height, 1)
        let x = 24 + (sin(elapsed * 1.7) + 1) * 0.5 * max(width - 220, 1)
        let y = 80 + (cos(elapsed * 1.1) + 1) * 0.5 * max(height - 260, 1)

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        markerLayer.frame = CGRect(x: x, y: y, width: 180, height: 180)
        markerLayer.transform = CATransform3DMakeRotation(elapsed, 0, 0, 1)
        textLayer.string = "mode: native-layer\nframes: \(frameCount)\nt: \(Int(elapsed * 1000))ms"
        CATransaction.commit()

        if frameCount % 30 == 0 {
            Mahjong3DLog.info(rendererLogger, "nativeDiagnostic frameCount=\(self.frameCount) elapsedMs=\(Int(elapsed * 1000)) bounds=\(self.bounds.debugDescription)")
        }
    }

    private func layoutLayers() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        textLayer.frame = CGRect(x: 20, y: max(bounds.height - 92, 20), width: 220, height: 72)
        CATransaction.commit()
    }
}

private final class BundledWebSchemeHandler: NSObject, WKURLSchemeHandler {
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
            if let response = HTTPURLResponse(
                url: requestURL,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: [
                    "Cache-Control": "no-store, max-age=0",
                    "Content-Length": String(data.count),
                    "Content-Type": mimeType(for: fileURL),
                    "Pragma": "no-cache",
                ]
            ) {
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
        if let response = HTTPURLResponse(
            url: urlSchemeTask.request.url ?? URL(string: "\(Mahjong3DExtensionRendererView.webScheme)://app/")!,
            statusCode: statusCode,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Cache-Control": "no-store, max-age=0",
                "Content-Type": "text/plain; charset=utf-8",
                "Pragma": "no-cache",
            ]
        ) {
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
