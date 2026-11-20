import Capacitor
import CryptoKit
import UIKit
import WebKit

/// Shows a web page, e.g. a web app, in a `WKWebView` over our app, see `showNativePage()` in `WebView.svelte`.
///
/// Like `<webview partition="persist:...">` on desktop, the page is jailed: It has no bridge to our app,
/// none of our files, and its own cookies and storage, in a data store per session.
/// A page stays alive while it's hidden, until JS closes it.
@objc(WebPagePlugin)
public class WebPagePlugin: CAPPlugin, CAPBridgedPlugin, WKNavigationDelegate, WKUIDelegate {
    public let identifier = "WebPagePlugin"
    public let jsName = "WebPage"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
    ]
    /// The pages that JS opened, by their ID
    private var pages: [String: UINavigationController] = [:]

    /// Creates the page, if it's new, and shows or hides it
    @objc func open(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let url = URL(string: call.getString("url") ?? ""),
              let profile = call.getString("profile") else {
            return call.reject("ID, URL or profile missing")
        }
        let hidden = call.getBool("hidden", false)
        DispatchQueue.main.async {
            guard let app = self.bridge?.viewController else {
                return call.reject("App not loaded")
            }
            let page = self.pages[id] ?? self.createPage(id, url, profile, app)
            self.pages[id] = page
            if hidden {
                self.hide(page)
            } else {
                page.view.isHidden = false
                app.view.bringSubviewToFront(page.view)
            }
            call.resolve()
        }
    }

    /// Ends the page
    @objc func close(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
        DispatchQueue.main.async {
            if let page = self.pages.removeValue(forKey: id) {
                page.willMove(toParent: nil)
                page.view.removeFromSuperview()
                page.removeFromParent()
            }
            call.resolve()
        }
    }

    /// Over our app, not presented, so that several pages can stay alive, and show one at a time
    private func createPage(_ id: String, _ url: URL, _ profile: String, _ app: UIViewController) -> UINavigationController {
        // Not Capacitor's, so the page gets none of its scripts and URL schemes
        let configuration = WKWebViewConfiguration()
        if #available(iOS 17, *) {
            configuration.websiteDataStore = WKWebsiteDataStore(
                forIdentifier: NSUUID(uuidBytes: Array(SHA256.hash(data: Data(profile.utf8)))) as UUID)
        } else {
            // Still separate from our app and the other sessions, but forgotten when our app ends
            configuration.websiteDataStore = .nonPersistent()
        }
        // Google refuses the login in a WKWebView, which it finds by the missing "Safari"
        // in the User-Agent, so we send that of Safari
        configuration.applicationNameForUserAgent = "Version/\(UIDevice.current.systemVersion) Mobile/15E148 Safari/604.1"
        // As on desktop, see `isPermissionAllowed()` in `desktop/src/main/index.ts`: iOS asks the user
        // for the camera, and there's no location or microphone, because our app has no usage description.
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        let controller = UIViewController()
        controller.view = webView
        controller.navigationItem.leftBarButtonItem = UIBarButtonItem(systemItem: .close, primaryAction: UIAction { [weak self] _ in
            // The user goes back to our app. The page stays alive.
            guard let self, let page = self.pages[id] else { return }
            self.hide(page)
            self.notifyListeners("hide", data: ["id": id])
        })
        let page = UINavigationController(rootViewController: controller)
        app.addChild(page)
        page.view.frame = app.view.bounds
        page.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        app.view.addSubview(page.view)
        page.didMove(toParent: app)
        webView.load(URLRequest(url: url))
        return page
    }

    private func hide(_ page: UIViewController) {
        page.view.endEditing(true) // else the keyboard stays
        page.view.isHidden = true
    }

    /// Also called for each redirect
    public func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard navigationAction.targetFrame?.isMainFrame == true, let url = navigationAction.request.url,
              let scheme = url.scheme, !["https", "http"].contains(scheme) else {
            return decisionHandler(.allow)
        }
        // WebKit can't show it. Our app opens only some URL schemes, e.g. `mailto:`, see `openExternalURL()`.
        notifyListeners("link", data: ["url": url.absoluteString])
        decisionHandler(.cancel)
    }

    public func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        // The end of the hostname shows whose page it is
        (webView.next as? UIViewController)?.title = webView.url?.host
    }

    /// iOS ended the page, e.g. because it needed the memory
    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    /// Opens `target="_blank"` links in the same page, like Android, which has no second window
    public func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                        for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        webView.load(navigationAction.request)
        return nil
    }
}
