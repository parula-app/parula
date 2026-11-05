package im.mustang.capa

import android.content.Intent
import android.net.Uri
import android.view.MotionEvent
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * On Android, a tap on a link in a mail navigates the top frame, see `WebView.svelte`.
 * Capacitor would open every such link that leaves our app in the system at once.
 * Instead, this gives the link and the tap position to the frontend, which asks the user first.
 */
@CapacitorPlugin(name = "LinkTap")
class LinkTapPlugin : Plugin() {
    /** Where the user last tapped, in CSS pixels of the WebView */
    private var tapX = 0.0
    private var tapY = 0.0

    /** Called by `MainActivity` for all touches */
    fun onTouch(event: MotionEvent) {
        if (event.actionMasked != MotionEvent.ACTION_UP) {
            return
        }
        val webViewOnScreen = IntArray(2)
        bridge.webView.getLocationOnScreen(webViewOnScreen)
        val density = bridge.webView.resources.displayMetrics.density.toDouble()
        tapX = (event.rawX - webViewOnScreen[0]) / density
        tapY = (event.rawY - webViewOnScreen[1]) / density
    }

    /** The same URLs that `Bridge.launchIntent()` would load in our WebView, we leave to it */
    override fun shouldOverrideLoad(url: Uri): Boolean? {
        val appURL = Uri.parse(bridge.appUrl)
        if (url.scheme == "data" || url.scheme == "blob" ||
            (url.scheme == appURL.scheme && url.host == appURL.host) ||
            !hasListeners("linkTap")) {
            return null
        }
        val tap = JSObject()
        tap.put("url", url.toString())
        tap.put("x", tapX)
        tap.put("y", tapY)
        notifyListeners("linkTap", tap)
        return true
    }

    @PluginMethod
    fun open(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("URL missing")
        startActivity(call, Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    }

    @PluginMethod
    fun openWith(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("URL missing")
        startActivity(call, Intent.createChooser(Intent(Intent.ACTION_VIEW, Uri.parse(url)), null))
    }

    private fun startActivity(call: PluginCall, intent: Intent) {
        try {
            activity.startActivity(intent)
            call.resolve()
        } catch (ex: Exception) {
            call.reject(ex.message, ex)
        }
    }
}
