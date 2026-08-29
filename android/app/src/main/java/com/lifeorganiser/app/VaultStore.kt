package com.lifeorganiser.app

import android.content.Context
import java.io.File
import java.security.MessageDigest

/**
 * The vault on disk: plain markdown under filesDir/vault, mirroring the layout
 * of the git repository so the same files work in Claude Code and Obsidian.
 */
class VaultStore(private val context: Context) {

    val root: File = File(context.filesDir, "vault")

    init {
        if (!root.exists()) root.mkdirs()
    }

    /** Resolve a vault-relative path, refusing anything that escapes the root. */
    private fun resolve(path: String): File? {
        if (path.isBlank() || path.startsWith("/")) return null
        val file = File(root, path)
        val canonicalRoot = root.canonicalPath
        val canonical = try { file.canonicalPath } catch (e: Exception) { return null }
        if (canonical != canonicalRoot && !canonical.startsWith("$canonicalRoot/")) return null
        return file
    }

    fun list(): List<String> {
        if (!root.isDirectory) return emptyList()
        val out = ArrayList<String>()
        root.walkTopDown()
            .filter { it.isFile && !it.name.startsWith(".") }
            .forEach { out.add(it.relativeTo(root).path) }
        out.sort()
        return out
    }

    fun read(path: String): String? {
        val file = resolve(path) ?: return null
        if (!file.isFile) return null
        return try { file.readText() } catch (e: Exception) { null }
    }

    fun readBytes(path: String): ByteArray? {
        val file = resolve(path) ?: return null
        if (!file.isFile) return null
        return try { file.readBytes() } catch (e: Exception) { null }
    }

    fun write(path: String, content: String): Boolean {
        val file = resolve(path) ?: return false
        return try {
            file.parentFile?.mkdirs()
            file.writeText(content)
            true
        } catch (e: Exception) {
            false
        }
    }

    fun delete(path: String): Boolean {
        val file = resolve(path) ?: return false
        return try { !file.exists() || file.delete() } catch (e: Exception) { false }
    }

    fun move(from: String, to: String): Boolean {
        val src = resolve(from) ?: return false
        val dst = resolve(to) ?: return false
        if (!src.isFile) return false
        return try {
            dst.parentFile?.mkdirs()
            src.copyTo(dst, overwrite = true)
            src.delete()
        } catch (e: Exception) {
            false
        }
    }

    fun exists(path: String): Boolean = resolve(path)?.isFile == true

    /** Copy the bundled starter vault in on first launch. */
    fun seedIfEmpty(): Boolean {
        if (list().isNotEmpty()) return false
        val assets = context.assets
        var copied = 0

        fun copyDir(assetPath: String, target: File) {
            val children = try { assets.list(assetPath) ?: return } catch (e: Exception) { return }
            if (children.isEmpty()) {
                // A leaf: an actual file.
                try {
                    target.parentFile?.mkdirs()
                    assets.open(assetPath).use { input ->
                        target.outputStream().use { input.copyTo(it) }
                    }
                    copied++
                } catch (e: Exception) {
                    // Not a readable file; ignore.
                }
                return
            }
            for (child in children) copyDir("$assetPath/$child", File(target, child))
        }

        copyDir("seed", root)
        return copied > 0
    }

    companion object {
        /** The SHA-1 git itself would give this content, so sync can diff against a tree. */
        fun gitBlobSha(bytes: ByteArray): String {
            val digest = MessageDigest.getInstance("SHA-1")
            digest.update("blob ${bytes.size}".toByteArray(Charsets.UTF_8))
            digest.update(0)
            digest.update(bytes)
            return digest.digest().joinToString("") { "%02x".format(it) }
        }
    }
}
