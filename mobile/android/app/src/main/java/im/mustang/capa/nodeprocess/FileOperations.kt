package im.mustang.capa.nodeprocess

import android.content.res.AssetManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream

object FileOperations {
    // Asynchronous copying throws error if any file fails to copy
    suspend fun copyAssetsDir(assetManager: AssetManager, from: String, to: String): Unit = coroutineScope {
        // Get the list of files in the assets directory
        val files = assetManager.list(from)

        if (files == null) {
            throw Exception("Error copying assets directory $from")
        } else if (files.isEmpty()) {
            //If it's a file, it won't have any assets "inside" it.
            copyAssetFile(assetManager, from, to)
        } else {
            File(to).mkdirs()
            val copyTasks = files.map{ file ->
                async(Dispatchers.IO) {
                    val fromPath = "$from/$file"
                    val toPath = "$to/$file"
                    copyAssetsDir(assetManager, fromPath, toPath)
                }
            }
            copyTasks.awaitAll()
        }

    }

    // Copy files with IO coroutine context to prevent blocking
    suspend fun copyAssetFile(assetManager: AssetManager, from: String, to: String): Unit = withContext(Dispatchers.IO) {
        val inputStream = assetManager.open(from)
        File(to).createNewFile()
        val outputStream = FileOutputStream(to)
        inputStream.copyTo(outputStream)
        inputStream.close()
        outputStream.flush()
        outputStream.close()
    }
}
