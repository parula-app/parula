package im.mustang.capa.nodeprocess

import android.content.res.AssetManager
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import android.util.Log
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import java.io.File


// Use ViewModels so it has the same lifecycle as the activity or App
// <https://developer.android.com/topic/libraries/architecture/viewmodel#lifecycle>
class NodeProcess(val filesDir: File, val assetManager: AssetManager) : ViewModel() {
    private val TAG = "NodeProcess"
    private lateinit var job: Job
    private val mainJS = "index.mjs"
    private val nodeDir = "nodejs"

    companion object {
        private var librariesLoaded = false
    }

    private suspend fun loadLibraries() {
        if (librariesLoaded) return
        withContext(Dispatchers.IO) {
            Log.d(TAG, "Starting to load node.js libraries")
            System.loadLibrary("node-process")
            System.loadLibrary("node")
            Log.d(TAG, "node.js libraries loaded")
            librariesLoaded = true
        }
    }

    // Node.js assets are in the APK archived and cannot be accessed with a path
    // Because we have node native modules and multiple files, we need to have them
    // copied to a physical location, for node to find the `.node` files using relative paths
    private suspend fun copyNodeAssets(): String {
        val from = "public/$nodeDir"
        val to = "${filesDir.absoluteFile}/$nodeDir"

        Log.d(TAG, "Copying assets from $from to $to")
        FileOperations.copyAssetsDir(assetManager, from, to)
        Log.d(TAG, "Assets copied")

        val mainJS = File(to, mainJS)
        if (!mainJS.exists()) {
            throw Exception("Main JS file not found")
        }
        return mainJS.absolutePath
    }

    private external fun startNode(args: Array<String>): Int

    fun start() {
        if (this::job.isInitialized && job.isActive) return
        job = viewModelScope.launch(Dispatchers.IO) {
            try {
                var mainJSPath: String
                coroutineScope {
                    val loadLibrariesTask = async(Dispatchers.IO) { loadLibraries() }
                    val copyNodeTask = async(Dispatchers.IO) {  return@async copyNodeAssets() }

                    loadLibrariesTask.await()
                    mainJSPath = copyNodeTask.await()
                }

                val args = arrayOf("node", mainJSPath)
                Log.d(TAG, "Starting node with arguments: \"${args.joinToString(" ")}\"")
                startNode(args)
            } catch (e: Exception) {
                Log.e(TAG, "Error starting node", e)
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        if (this::job.isInitialized && job.isActive) {
            Log.d(TAG, "Cancelling job")
            job.cancel()
        }
    }
}
