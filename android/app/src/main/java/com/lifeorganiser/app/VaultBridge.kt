package com.lifeorganiser.app

import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * The surface the UI talks to. Synchronous calls (file I/O) return immediately;
 * anything touching the network runs on a worker and resolves a promise in JS
 * through [settle].
 */
class VaultBridge(
    private val webView: WebView,
    private val vault: VaultStore,
    private val prefs: Prefs,
) {
    private val worker = Executors.newSingleThreadExecutor()
    private val github = GitHubSync(prefs, vault)
    private val assist = ClaudeAssist(prefs)
    private val calendar = CalendarFetch(prefs)

    var pendingRoute: String? = null
    var pendingShare: String? = null

    private fun settle(id: String, ok: Boolean, payload: Any?) {
        val message = JSONObject()
            .put("id", id)
            .put("ok", ok)
            .put("payload", payload ?: JSONObject.NULL)
            .toString()
        webView.post {
            webView.evaluateJavascript("window.__settle($message);", null)
        }
    }

    private fun background(id: String, work: () -> Any?) {
        worker.execute {
            try {
                settle(id, true, work())
            } catch (e: Exception) {
                settle(id, false, e.message ?: e.javaClass.simpleName)
            }
        }
    }

    // ---- vault ------------------------------------------------------------

    @JavascriptInterface
    fun listFiles(): String {
        val array = JSONArray()
        vault.list().forEach { array.put(it) }
        return array.toString()
    }

    @JavascriptInterface
    fun readFile(path: String): String? = vault.read(path)

    @JavascriptInterface
    fun writeFile(path: String, content: String): Boolean = vault.write(path, content)

    @JavascriptInterface
    fun deleteFile(path: String): Boolean = vault.delete(path)

    @JavascriptInterface
    fun moveFile(from: String, to: String): Boolean = vault.move(from, to)

    @JavascriptInterface
    fun fileExists(path: String): Boolean = vault.exists(path)

    /** One call for the whole vault, so the UI can render without N round trips. */
    @JavascriptInterface
    fun readAll(): String {
        val out = JSONObject()
        for (path in vault.list()) {
            if (!path.endsWith(".md")) continue
            vault.read(path)?.let { out.put(path, it) }
        }
        return out.toString()
    }

    // ---- time -------------------------------------------------------------

    @JavascriptInterface
    fun today(): String = Clock.today()

    @JavascriptInterface
    fun now(): String = Clock.now()

    @JavascriptInterface
    fun isoWeek(): String = Clock.isoWeek()

    // ---- settings ---------------------------------------------------------

    @JavascriptInterface
    fun getPrefs(): String = prefs.toJson().toString()

    @JavascriptInterface
    fun setPrefs(json: String): Boolean = try {
        prefs.applyJson(JSONObject(json))
        true
    } catch (e: Exception) {
        false
    }

    // ---- network ----------------------------------------------------------

    @JavascriptInterface
    fun sync(id: String) = background(id) { github.sync() }

    @JavascriptInterface
    fun testConnection(id: String) = background(id) { github.testConnection() }

    @JavascriptInterface
    fun aiAsk(id: String, system: String, user: String) =
        background(id) { assist.ask(system, user) }

    @JavascriptInterface
    fun fetchCalendars(id: String) = background(id) { calendar.fetchAll() }

    // ---- app plumbing -----------------------------------------------------

    /** Route and shared text handed over by an intent, consumed once. */
    @JavascriptInterface
    fun takeLaunchIntent(): String {
        val out = JSONObject()
            .put("route", pendingRoute ?: JSONObject.NULL)
            .put("share", pendingShare ?: JSONObject.NULL)
        pendingRoute = null
        pendingShare = null
        return out.toString()
    }

    @JavascriptInterface
    fun isDark(): Boolean = darkMode

    var darkMode: Boolean = false

    @JavascriptInterface
    fun log(message: String) {
        android.util.Log.d("LifeOrganiser", message)
    }
}
