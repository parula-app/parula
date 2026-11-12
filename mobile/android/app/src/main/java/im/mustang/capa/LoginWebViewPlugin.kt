package im.mustang.capa

import android.graphics.Bitmap
import android.net.Uri
import android.text.TextUtils
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentDialog
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Shows a login page, e.g. for OAuth2, in a WebView over our app, see `OAuth2EmbeddedBrowser.svelte`.
 *
 * Like `<webview partition="persist:...">` on desktop, the page is jailed: It has no bridge to our app,
 * no files, starts no other apps, and has its own cookies and storage, in a WebView profile per account.
 */
@CapacitorPlugin(name = "LoginWebView")
class LoginWebViewPlugin : Plugin() {
    private var dialog: ComponentDialog? = null

    /** Pages under `doneURL` are not loaded, but only reported */
    @PluginMethod
    fun open(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("URL missing")
        val profile = call.getString("profile") ?: return call.reject("Profile missing")
        val doneURL = call.getString("doneURL")
        val script = call.getString("script")
        activity.runOnUiThread {
            try {
                if (!WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
                    // Without profiles, the page would share the cookies of our app and of all accounts
                    return@runOnUiThread call.unavailable("Android System WebView is too old for profiles")
                }
                this.dialog?.dismiss()
                val cookies = ProfileStore.getInstance().getOrCreateProfile(profile).cookieManager
                val webView = WebView(activity)
                WebViewCompat.setProfile(webView, profile) // before anything else uses the WebView
                webView.settings.javaScriptEnabled = true
                webView.settings.domStorageEnabled = true // `localStorage`
                webView.settings.allowFileAccess = false
                webView.settings.allowContentAccess = false
                // Google refuses the login in a WebView, which it finds by "; wv" in the User-Agent,
                // so we send that of Chrome. Without the default User-Agent in ours, WebView also
                // sends no Client Hints, which would say "Android WebView".
                webView.settings.userAgentString = webView.settings.userAgentString
                    .replace("; wv", "").replace(" Version/4.0", "")
                // As on desktop. The cookie jar is only for this account anyways.
                cookies.setAcceptThirdPartyCookies(webView, true)

                val title = TextView(activity)
                title.isSingleLine = true
                title.ellipsize = TextUtils.TruncateAt.START // The end of the hostname shows who gets the password
                val close = ImageButton(activity, null, android.R.attr.actionButtonStyle)
                close.setImageResource(android.R.drawable.ic_menu_close_clear_cancel)
                close.contentDescription = activity.getString(android.R.string.cancel)
                val toolbar = LinearLayout(activity)
                toolbar.gravity = Gravity.CENTER_VERTICAL
                toolbar.addView(close)
                toolbar.addView(title, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
                val layout = LinearLayout(activity)
                layout.orientation = LinearLayout.VERTICAL
                layout.addView(toolbar)
                layout.addView(webView, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
                ViewCompat.setOnApplyWindowInsetsListener(layout) { view, insets ->
                    val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
                    view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                    WindowInsetsCompat.CONSUMED
                }

                val dialog = ComponentDialog(activity, android.R.style.Theme_DeviceDefault_NoActionBar)
                dialog.setContentView(layout)
                // Android 15 draws an app window under the system bars and the keyboard anyways,
                // so we leave the space ourselves, on all versions, see above.
                WindowCompat.setDecorFitsSystemWindows(dialog.window!!, false)
                @Suppress("DEPRECATION") // Before Android 11, we get the keyboard insets only with this
                dialog.window!!.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
                dialog.onBackPressedDispatcher.addCallback(dialog, object : OnBackPressedCallback(true) {
                    override fun handleOnBackPressed() {
                        if (webView.canGoBack()) webView.goBack() else dialog.cancel()
                    }
                })
                close.setOnClickListener { dialog.cancel() }
                dialog.setOnCancelListener { notifyListeners("close", JSObject()) }
                dialog.setOnDismissListener {
                    cookies.flush() // WebView writes them only every 30 s, and our app may end before
                    webView.destroy()
                }

                webView.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        val pageURL = request.url.toString()
                        // Android doesn't ask us for a POST, so `onPageStarted()` reports all pages, too
                        if (doneURL != null && pageURL.startsWith(doneURL)) {
                            notifyListeners("navigate", JSObject().put("url", pageURL))
                            return true
                        }
                        // Unlike Capacitor, we start no other app, e.g. for `intent:`,
                        // and stay on the page, instead of the error page of the WebView
                        return request.isForMainFrame && !(pageURL.startsWith("https:") || pageURL.startsWith("http:"))
                    }

                    override fun onPageStarted(view: WebView, pageURL: String, favicon: Bitmap?) {
                        title.text = Uri.parse(pageURL).host
                        notifyListeners("navigate", JSObject().put("url", pageURL))
                    }

                    override fun onPageFinished(view: WebView, pageURL: String) {
                        script?.let { view.evaluateJavascript(it, null) }
                    }
                }
                webView.loadUrl(url)
                dialog.show()
                this.dialog = dialog
                call.resolve()
            } catch (ex: Exception) {
                call.reject(ex.message, ex)
            }
        }
    }

    /** Without `close` event, which is only when the user closes it */
    @PluginMethod
    fun close(call: PluginCall) {
        activity.runOnUiThread {
            dialog?.dismiss()
            dialog = null
            call.resolve()
        }
    }
}
