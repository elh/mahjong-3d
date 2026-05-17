import AppKit
import os.log
import ScreenSaver
import UniformTypeIdentifiers
import WebKit

@objc(Mahjong3DScreenSaverView)
final class Mahjong3DScreenSaverView: ScreenSaverView, WKNavigationDelegate {
    fileprivate static let webScheme = "mahjong3d-saver"
    private static let inactiveDebounceSeconds = 1.5
    private static let diagnosticSurfaceOverride: String? = nil

    private var webView: WKWebView?
    private var webSchemeHandler: BundledWebSchemeHandler?
    private let previewMode: Bool
    private let log = ScreenSaverLog()
    private var lifecycleSequence = 0
    private var inactiveWorkItem: DispatchWorkItem?
    private var webActive = true
    private var webPreview: Bool
    private var renderFrameInFlight = false
    private var renderFrameSequence = 0

    override init?(frame: NSRect, isPreview: Bool) {
        self.previewMode = isPreview
        self.webPreview = isPreview
        super.init(frame: frame, isPreview: isPreview)
        animationTimeInterval = 1.0 / 30.0
        log.write("lifecycle[\(nextLifecycleSequence())] init preview=\(isPreview) frame=\(frame)")
        configureWebView()
    }

    required init?(coder: NSCoder) {
        self.previewMode = false
        self.webPreview = false
        super.init(coder: coder)
        animationTimeInterval = 1.0 / 30.0
        log.write("lifecycle[\(nextLifecycleSequence())] init coder preview=false frame=\(frame)")
        configureWebView()
    }

    override func startAnimation() {
        super.startAnimation()
        let sequence = nextLifecycleSequence()
        log.write("lifecycle[\(sequence)] startAnimation frame=\(frame) bounds=\(bounds)")
        cancelInactiveTransition(reason: "startAnimation", sequence: sequence)
        syncWebViewFrame()
        setWebActive(true, reason: "startAnimation", sequence: sequence)
    }

    override func stopAnimation() {
        let sequence = nextLifecycleSequence()
        log.write("lifecycle[\(sequence)] stopAnimation")
        scheduleInactiveTransition(sequence: sequence)
        super.stopAnimation()
    }

    override func animateOneFrame() {
        renderWebFrame()
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        log.write("lifecycle[\(nextLifecycleSequence())] setFrameSize \(newSize)")
        syncWebViewFrame()
    }

    override func layout() {
        super.layout()
        syncWebViewFrame()
    }

    override func removeFromSuperview() {
        let sequence = nextLifecycleSequence()
        log.write("lifecycle[\(sequence)] removeFromSuperview")
        cancelInactiveTransition(reason: "removeFromSuperview", sequence: sequence)
        setWebActive(false, reason: "teardown", sequence: sequence)
        tearDownWebView()
        super.removeFromSuperview()
    }

    deinit {
        let sequence = nextLifecycleSequence()
        log.write("lifecycle[\(sequence)] deinit")
        cancelInactiveTransition(reason: "deinit", sequence: sequence)
        setWebActive(false, reason: "deinit", sequence: sequence)
        tearDownWebView()
    }

    private func configureWebView() {
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor

        let configuration = WKWebViewConfiguration()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.suppressesIncrementalRendering = false
        let userContentController = WKUserContentController()
        userContentController.addUserScript(
            WKUserScript(
                source: """
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
            log.write("web root \(webRootURL.path)")
        } else {
            log.write("missing web root")
        }

        let view = WKWebView(frame: bounds, configuration: configuration)
        view.autoresizingMask = [.width, .height]
        view.navigationDelegate = self
        view.setValue(false, forKey: "drawsBackground")
        addSubview(view)
        webView = view
        syncWebViewFrame()

        loadBundledWebApp()
    }

    private func loadBundledWebApp() {
        var components = URLComponents()
        components.scheme = Self.webScheme
        components.host = "app"
        components.path = "/index.html"
        let surface = Self.diagnosticSurfaceOverride ?? "screensaver"
        components.query = previewMode
            ? "surface=\(surface)&preview=1"
            : "surface=\(surface)"

        guard let appURL = components.url else {
            log.write("failed to build app URL")
            return
        }

        log.write("load \(appURL.absoluteString)")
        webView?.load(URLRequest(url: appURL))
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
        webView?.layer?.backgroundColor = NSColor.black.cgColor
        log.write("syncWebViewFrame bounds=\(bounds) webFrame=\(webView?.frame ?? .zero)")
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
            self.log.write("lifecycle[\(sequence)] inactive debounce fired")
            self.setWebActive(false, reason: "debouncedStopAnimation", sequence: sequence)
            self.inactiveWorkItem = nil
        }
        inactiveWorkItem = workItem
        log.write("lifecycle[\(sequence)] inactive debounce scheduled \(Self.inactiveDebounceSeconds)s")
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
        log.write("lifecycle[\(sequence)] inactive debounce canceled reason=\(reason)")
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
        renderFrameSequence += 1
        let frameSequence = renderFrameSequence
        webView.evaluateJavaScript(
            """
            window.__mahjongScreenSaverNativeFrameCount = (window.__mahjongScreenSaverNativeFrameCount || 0) + 1;
            window.mahjongScreenSaver && window.mahjongScreenSaver.renderFrame && window.mahjongScreenSaver.renderFrame(performance.now());
            """,
            completionHandler: { [weak self, log] _, error in
                self?.renderFrameInFlight = false
                if let error {
                    log.write("renderFrame[\(frameSequence)] failed: \(error.localizedDescription)")
                } else if frameSequence == 1 || frameSequence % 60 == 0 {
                    log.write("renderFrame[\(frameSequence)] delivered")
                }
            }
        )
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let sequence = nextLifecycleSequence()
        log.write("lifecycle[\(sequence)] didFinish \(webView.url?.absoluteString ?? "unknown")")
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
                    "Content-Length": String(data.count),
                    "Content-Type": mimeType(for: fileURL),
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
            headerFields: ["Content-Type": "text/plain; charset=utf-8"]
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
    private let fileURL: URL?

    init() {
        let directoryURL = FileManager.default
            .homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/Mahjong3D", isDirectory: true)
        try? FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        self.fileURL = directoryURL.appendingPathComponent("screensaver.log", isDirectory: false)
    }

    func write(_ message: String) {
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
