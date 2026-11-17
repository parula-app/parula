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
 * A tap on a link in a mail first shows where the link goes, see `WebView.svelte`.
 * The tap navigates the top frame, see the `sandbox` there, and Capacitor would open
 * every such link that leaves our app in the system at once.
 * Instead, this gives the link and where the user tapped to our app.
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

    /** The URLs that `Bridge.launchIntent()` would load in our WebView, we leave to it */
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

    /** Opens the link in the browser or another app, as `Bridge.launchIntent()` does */
    @PluginMethod
    fun open(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("URL missing")
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            call.resolve()
        } catch (ex: Exception) {
            call.reject(ex.message, ex)
        }
    }
}
