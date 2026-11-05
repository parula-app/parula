package im.mustang.capa

import android.os.Bundle
import android.view.MotionEvent
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(LinkTapPlugin::class.java)
        super.onCreate(savedInstanceState)
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        (bridge?.getPlugin("LinkTap")?.instance as? LinkTapPlugin)?.onTouch(event)
        return super.dispatchTouchEvent(event)
    }
}
