import Capacitor
import CryptoKit
import UIKit
import WebKit

/// Shows a login page, e.g. for OAuth2, in a `WKWebView` over our app, see `OAuth2EmbeddedBrowser.svelte`.
///
/// Like `<webview partition="persist:...">` on desktop, the page is jailed: It has no bridge to our app,
/// none of our files, and its own cookies and storage, in a data store per account.
@objc(LoginWebViewPlugin)
public class LoginWebViewPlugin: CAPPlugin, CAPBridgedPlugin, WKNavigationDelegate, WKUIDelegate {
    public let identifier = "LoginWebViewPlugin"
    public let jsName = "LoginWebView"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
    ]
    private var page: UINavigationController?
    private var doneURL: String?
    private var script: String?

    /// Pages under `doneURL` are not loaded, but only reported
    @objc func open(_ call: CAPPluginCall) {
        guard let url = URL(string: call.getString("url") ?? ""), let profile = call.getString("profile") else {
            return call.reject("URL or profile missing")
        }
        DispatchQueue.main.async {
            self.page?.dismiss(animated: false)
            self.doneURL = call.getString("doneURL")
            self.script = call.getString("script")
            // Not Capacitor's, so the page gets none of its scripts and URL schemes
            let configuration = WKWebViewConfiguration()
            if #available(iOS 17, *) {
                configuration.websiteDataStore = WKWebsiteDataStore(
                    forIdentifier: NSUUID(uuidBytes: Array(SHA256.hash(data: Data(profile.utf8)))) as UUID)
            } else {
                // Still separate from our app and the other accounts, but forgotten when closed
                configuration.websiteDataStore = .nonPersistent()
            }
            // Google refuses the login in a WKWebView, which it finds by the missing "Safari"
            // in the User-Agent, so we send that of Safari
            configuration.applicationNameForUserAgent = "Version/\(UIDevice.current.systemVersion) Mobile/15E148 Safari/604.1"
            let webView = WKWebView(frame: .zero, configuration: configuration)
            webView.navigationDelegate = self
            webView.uiDelegate = self
            webView.allowsBackForwardNavigationGestures = true
            let controller = UIViewController()
            controller.view = webView
            controller.navigationItem.leftBarButtonItem = UIBarButtonItem(
                barButtonSystemItem: .cancel, target: self, action: #selector(self.cancel))
            let page = UINavigationController(rootViewController: controller)
            page.modalPresentationStyle = .fullScreen
            self.page = page
            self.bridge?.viewController?.present(page, animated: true)
            webView.load(URLRequest(url: url))
            call.resolve()
        }
    }

    /// Without `close` event, which is only when the user closes it
    @objc func close(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.page?.dismiss(animated: true)
            self.page = nil
            call.resolve()
        }
    }

    @objc func cancel() {
        page?.dismiss(animated: true)
        page = nil
        notifyListeners("close", data: [:])
    }

    /// Also called for each redirect
    public func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard navigationAction.targetFrame?.isMainFrame == true, let url = navigationAction.request.url?.absoluteString else {
            return decisionHandler(.allow)
        }
        notifyListeners("navigate", data: ["url": url])
        if let doneURL, url.hasPrefix(doneURL) {
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    public func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        // The end of the hostname shows who gets the password
        page?.topViewController?.title = webView.url?.host
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let script {
            webView.evaluateJavaScript(script)
        }
    }

    /// Opens `target="_blank"` links in the same page, like Android, which has no second window
    public func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                        for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        webView.load(navigationAction.request)
        return nil
    }
}
