import Capacitor
import UIKit
import WebKit

/// A tap on a link in a mail first shows where the link goes, see `WebView.svelte`.
/// Every link in a mail has `target="_blank"`, see `sanitizeHTML()`, so WebKit asks
/// for a new window, and Capacitor would open the link in the system at once.
/// Instead, this gives the link and where the user tapped to our app.
@objc(LinkTapPlugin)
public class LinkTapPlugin: CAPPlugin, CAPBridgedPlugin, WKUIDelegate {
    public let identifier = "LinkTapPlugin"
    public let jsName = "LinkTap"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
    ]
    /// Capacitor's, which does everything else, e.g. `alert()`
    private var capacitorUIDelegate: WKUIDelegate?

    override public func load() {
        capacitorUIDelegate = webView?.uiDelegate
        webView?.uiDelegate = self
    }

    public func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                        for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url, hasListeners("linkTap") else {
            return capacitorUIDelegate?.webView?(webView, createWebViewWith: configuration,
                                                 for: navigationAction, windowFeatures: windowFeatures)
        }
        let tap = (webView as? TapWebView)?.lastTouch ?? .zero
        notifyListeners("linkTap", data: ["url": url.absoluteString, "x": Double(tap.x), "y": Double(tap.y)])
        return nil
    }

    override public func responds(to selector: Selector!) -> Bool {
        return super.responds(to: selector) || capacitorUIDelegate?.responds(to: selector) == true
    }

    override public func forwardingTarget(for selector: Selector!) -> Any? {
        return capacitorUIDelegate
    }

    /// Opens the link in the browser or another app, as Capacitor does
    @objc func open(_ call: CAPPluginCall) {
        guard let url = URL(string: call.getString("url") ?? "") else {
            return call.reject("URL missing")
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url) { opened in
                opened ? call.resolve() : call.reject("No app opens " + url.absoluteString)
            }
        }
    }
}

/// Remembers where the user last touched it, in CSS pixels
class TapWebView: WKWebView {
    var lastTouch = CGPoint.zero

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        if event?.type == .touches {
            lastTouch = point
        }
        return super.hitTest(point, with: event)
    }
}

class MainViewController: CAPBridgeViewController {
    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        return TapWebView(frame: frame, configuration: configuration)
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(LinkTapPlugin())
        bridge?.registerPluginInstance(LoginWebViewPlugin())
    }
}
