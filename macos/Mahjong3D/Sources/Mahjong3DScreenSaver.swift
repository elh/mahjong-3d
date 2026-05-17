import AppKit
import os.log
import ScreenSaver
import UniformTypeIdentifiers
import WebKit

@objc(Mahjong3DScreenSaverView)
final class Mahjong3DScreenSaverView: ScreenSaverView, WKNavigationDelegate {
    fileprivate static let webScheme = "mahjong3d-saver"

    private var webView: WKWebView?
    private var webSchemeHandler: BundledWebSchemeHandler?
    private let previewMode: Bool
    private let log = ScreenSaverLog()

    override init?(frame: NSRect, isPreview: Bool) {
        self.previewMode = isPreview
        super.init(frame: frame, isPreview: isPreview)
        animationTimeInterval = 1.0 / 30.0
        log.write("init preview=\(isPreview) frame=\(frame)")
        configureWebView()
    }

    required init?(coder: NSCoder) {
        self.previewMode = false
        super.init(coder: coder)
        animationTimeInterval = 1.0 / 30.0
        log.write("init coder preview=false frame=\(frame)")
        configureWebView()
    }

    override func startAnimation() {
        super.startAnimation()
        log.write("startAnimation frame=\(frame) bounds=\(bounds)")
        syncWebViewFrame()
        setWebActive(true)
    }

    override func stopAnimation() {
        log.write("stopAnimation")
        setWebActive(false)
        super.stopAnimation()
    }

    override func animateOneFrame() {
        // Rendering is driven by the embedded web app; native animation only
        // exists so ScreenSaverEngine can deliver lifecycle callbacks.
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        log.write("setFrameSize \(newSize)")
        syncWebViewFrame()
    }

    override func layout() {
        super.layout()
        syncWebViewFrame()
    }

    override func removeFromSuperview() {
        log.write("removeFromSuperview")
        tearDownWebView()
        super.removeFromSuperview()
    }

    deinit {
        log.write("deinit")
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
        components.query = previewMode
            ? "surface=screensaver&preview=1"
            : "surface=screensaver"

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

    private func setWebActive(_ active: Bool) {
        evaluateBridgeCall("setActive(\(active ? "true" : "false"))")
    }

    private func setWebPreview(_ preview: Bool) {
        evaluateBridgeCall("setPreview(\(preview ? "true" : "false"))")
    }

    private func evaluateBridgeCall(_ call: String) {
        webView?.evaluateJavaScript(
            "window.mahjongScreenSaver && window.mahjongScreenSaver.\(call);",
            completionHandler: { [log] _, error in
                if let error {
                    log.write("bridge \(call) failed: \(error.localizedDescription)")
                }
            }
        )
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        log.write("didFinish \(webView.url?.absoluteString ?? "unknown")")
        setWebPreview(previewMode)
        setWebActive(true)
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
