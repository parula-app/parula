package im.mustang.capa

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import im.mustang.capa.nodeprocess.NodeProcess

class MainActivity : BridgeActivity() {
    private lateinit var nodeProcess: NodeProcess

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Initialize after onCreate to the application context
        nodeProcess = NodeProcess(applicationContext.filesDir, applicationContext.assets)
        nodeProcess.start()
    }
}
