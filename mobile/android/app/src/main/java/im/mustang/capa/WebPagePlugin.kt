package im.mustang.capa

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.text.TextUtils
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentDialog
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
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
 * Shows a web page, e.g. a web app, in a WebView over our app, see `showNativePage()` in `WebView.svelte`.
 *
 * Like `<webview partition="persist:...">` on desktop, the page is jailed: It has no bridge to our app,
 * none of our files, starts no other apps, and has its own cookies and storage, in a WebView profile
 * per session. A page stays alive while it's hidden, until JS closes it.
 */
@CapacitorPlugin(name = "WebPage")
class WebPagePlugin : Plugin() {
    /** The pages that JS opened, by their ID */
    private val pages = HashMap<String, Page>()
    /** `<input type="file">` in a page: Gets the files that the user chose */
    private var chosenFiles: ValueCallback<Array<Uri>>? = null
    private lateinit var fileChooser: ActivityResultLauncher<Intent>

    override fun load() {
        // Android lets us wait for the file chooser only if we ask before our activity started, i.e. now
        fileChooser = bridge.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            chosenFiles?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
            chosenFiles = null
        }
    }

    /** Creates the page, if it's new, and shows or hides it */
    @PluginMethod
    fun open(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("ID missing")
        val url = call.getString("url") ?: return call.reject("URL missing")
        val profile = call.getString("profile") ?: return call.reject("Profile missing")
        val hidden = call.getBoolean("hidden", false)!!
        activity.runOnUiThread {
            try {
                if (!WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
                    // Without profiles, the page would share the cookies of our app and of all sessions
                    return@runOnUiThread call.unavailable("Android System WebView is too old for profiles")
                }
                val page = pages.getOrPut(id) { Page(id, url, profile) }
                if (hidden) page.hide() else page.show()
                call.resolve()
            } catch (ex: Exception) {
                call.reject(ex.message, ex)
            }
        }
    }

    /** Ends the page */
    @PluginMethod
    fun close(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("ID missing")
        activity.runOnUiThread {
            pages.remove(id)?.close()
            call.resolve()
        }
    }

    override fun handleOnPause() {
        // WebView writes the cookies only every 30 s, and Android may end our app in the background
        pages.values.forEach { it.cookies.flush() }
    }

    override fun handleOnDestroy() {
        pages.values.forEach { it.close() }
        pages.clear()
    }

    /** A WebView in a dialog over our app, with a bar to go back to our app */
    private inner class Page(id: String, url: String, profile: String) :
        ComponentDialog(activity, android.R.style.Theme_DeviceDefault_NoActionBar) {
        val cookies = ProfileStore.getInstance().getOrCreateProfile(profile).cookieManager
        private val webView = WebView(activity)

        init {
            WebViewCompat.setProfile(webView, profile) // before anything else uses the WebView
            webView.settings.javaScriptEnabled = true
            webView.settings.domStorageEnabled = true // `localStorage`
            webView.settings.allowFileAccess = false
            webView.settings.allowContentAccess = false
            // Permissions as on desktop, see `isPermissionAllowed()` in `desktop/src/main/index.ts`: No location.
            // Camera and microphone, which web pages get there, our app itself doesn't have on Android.
            webView.settings.setGeolocationEnabled(false)
            // Google refuses the login in a WebView, which it finds by "; wv" in the User-Agent,
            // so we send that of Chrome. Without the default User-Agent in ours, WebView also
            // sends no Client Hints, which would say "Android WebView".
            webView.settings.userAgentString = webView.settings.userAgentString
                .replace("; wv", "").replace(" Version/4.0", "")
            // As on desktop. The cookie jar is only for this session anyways.
            cookies.setAcceptThirdPartyCookies(webView, true)

            val title = TextView(activity)
            title.isSingleLine = true
            title.ellipsize = TextUtils.TruncateAt.START // The end of the hostname shows whose page it is
            val back = ImageButton(activity, null, android.R.attr.actionButtonStyle)
            back.setImageResource(android.R.drawable.ic_menu_close_clear_cancel)
            back.contentDescription = activity.title // our app, where it goes
            val toolbar = LinearLayout(activity)
            toolbar.gravity = Gravity.CENTER_VERTICAL
            toolbar.addView(back)
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
            setContentView(layout)
            // Android 15 draws an app window under the system bars and the keyboard anyways,
            // so we leave the space ourselves, on all versions, see above.
            WindowCompat.setDecorFitsSystemWindows(window!!, false)
            @Suppress("DEPRECATION") // Before Android 11, we get the keyboard insets only with this
            window!!.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)

            /** The user goes back to our app. The page stays alive. */
            val leave = {
                hide()
                notifyListeners("hide", JSObject().put("id", id))
            }
            back.setOnClickListener { leave() }
            onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (webView.canGoBack()) webView.goBack() else leave()
                }
            })

            webView.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (!request.isForMainFrame || listOf("https", "http").contains(request.url.scheme)) {
                        return false
                    }
                    // Unlike Capacitor, we start no other app, e.g. for `intent:`, and stay on the page,
                    // instead of the error page of the WebView. Our app opens only some URL schemes,
                    // e.g. `mailto:`, see `openExternalURL()`.
                    notifyListeners("link", JSObject().put("url", request.url.toString()))
                    return true
                }

                override fun onPageStarted(view: WebView, pageURL: String, favicon: Bitmap?) {
                    title.text = Uri.parse(pageURL).host
                }

                /** Android ended the page, e.g. because it needed the memory, and without this, our app, too.
                 * JS opens the page again, when the user wants to see it. */
                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    pages.remove(id)?.close()
                    notifyListeners("hide", JSObject().put("id", id))
                    return true
                }
            }
            webView.webChromeClient = object : WebChromeClient() {
                /** The page gets only the files that the user chooses */
                override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>,
                                               params: FileChooserParams): Boolean {
                    try {
                        fileChooser.launch(params.createIntent())
                    } catch (ex: ActivityNotFoundException) {
                        return false
                    }
                    chosenFiles = callback
                    return true
                }
            }
            webView.loadUrl(url)
        }

        fun close() {
            cookies.flush()
            dismiss()
            webView.destroy()
        }
    }
}
