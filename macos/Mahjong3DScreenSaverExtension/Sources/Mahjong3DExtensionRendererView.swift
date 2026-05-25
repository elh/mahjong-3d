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
    private static let frameInterval = 1.0 / 60.0
    private static let nativeFrameDriverEnabled = false

    private let instanceID = UUID().uuidString.prefix(8)
    private let nativePreview: Bool
    private var webView: WKWebView?
    private var webSchemeHandler: BundledWebSchemeHandler?
    private var frameTimer: Timer?
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
        rendererLogger.info("instance[\(self.instanceID, privacy: .public)] deinit")
    }

    override func makeBackingLayer() -> CALayer {
        let layer = CALayer()
        layer.backgroundColor = Self.startupBackgroundColor.cgColor
        layer.isOpaque = true
        return layer
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        rendererLogger.info("instance[\(self.instanceID, privacy: .public)] viewDidMoveToWindow hasWindow=\(self.window != nil, privacy: .public)")
        if window != nil {
            startRenderer(reason: "viewDidMoveToWindow")
        } else {
            stopRenderer(reason: "viewDidMoveToWindow nil window")
            tearDownWebView()
        }
    }

    override func startAnimation() {
        super.startAnimation()
        rendererLogger.info("instance[\(self.instanceID, privacy: .public)] startAnimation")
        startRenderer(reason: "startAnimation")
    }

    override func stopAnimation() {
        rendererLogger.info("instance[\(self.instanceID, privacy: .public)] stopAnimation")
        if window == nil {
            stopRenderer(reason: "stopAnimation nil window")
        } else {
            rendererLogger.info("instance[\(self.instanceID, privacy: .public)] ignoring stopAnimation while window is attached")
        }
        super.stopAnimation()
    }

    override func layout() {
        super.layout()
        syncWebViewFrame()
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        syncWebViewFrame()
    }

    private func commonInit() {
        wantsLayer = true
        layer?.backgroundColor = Self.startupBackgroundColor.cgColor
        animationTimeInterval = Self.frameInterval
        webPreview = nativePreview || bounds.width < 400 || bounds.height < 300
        rendererLogger.info("instance[\(self.instanceID, privacy: .public)] init size=\(self.bounds.size.debugDescription, privacy: .public) preview=\(self.webPreview, privacy: .public)")
    }

    private func startRenderer(reason: String) {
        guard window != nil else {
            return
        }

        wantsLayer = true
        layer?.backgroundColor = Self.startupBackgroundColor.cgColor
        webPreview = nativePreview || bounds.width < 400 || bounds.height < 300

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
        stopFrameTimer()
        setWebActive(false, reason: reason)
    }

    private func configureWebView() {
        let configuration = WKWebViewConfiguration()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
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
            rendererLogger.error("instance[\(self.instanceID, privacy: .public)] missing Web resources")
        }

        let view = WKWebView(frame: bounds, configuration: configuration)
        view.autoresizingMask = [.width, .height]
        view.navigationDelegate = self
        view.setValue(false, forKey: "drawsBackground")
        addSubview(view)
        webView = view

        loadBundledWebApp()
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

        guard let appURL = components.url else {
            rendererLogger.error("instance[\(self.instanceID, privacy: .public)] failed to build app URL")
            return
        }

        rendererLogger.info("instance[\(self.instanceID, privacy: .public)] load \(appURL.absoluteString, privacy: .public)")
        let request = URLRequest(
            url: appURL,
            cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
            timeoutInterval: 30
        )
        webView?.load(request)
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
                    rendererLogger.debug("bridge \(call, privacy: .public) reason=\(reason, privacy: .public) failed result=\(String(describing: errorResult), privacy: .public) error=\(error.localizedDescription, privacy: .public)")
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
            completionHandler: { [weak self] _, error in
                self?.renderFrameInFlight = false
                if let error {
                    rendererLogger.debug("renderFrame failed: \(error.localizedDescription, privacy: .public)")
                }
            }
        )
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        rendererLogger.info("instance[\(self.instanceID, privacy: .public)] didFinish \(webView.url?.absoluteString ?? "unknown", privacy: .public)")
        setWebPreview(webPreview, reason: "didFinish")
        setWebActive(true, reason: "didFinish")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        rendererLogger.error("didFail \(error.localizedDescription, privacy: .public)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        rendererLogger.error("didFailProvisionalNavigation \(error.localizedDescription, privacy: .public)")
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        rendererLogger.info("\(String(describing: message.body), privacy: .public)")
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
