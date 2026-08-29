package com.lifeorganiser.app

import android.content.Context
import org.json.JSONObject

/**
 * Settings and sync bookkeeping. Stored in app-private preferences: other apps
 * cannot read them, but they are not hardware-encrypted — use a fine-grained
 * GitHub token scoped to this one repository.
 */
class Prefs(context: Context) {

    private val prefs = context.getSharedPreferences("lifeorganiser_secure", Context.MODE_PRIVATE)

    var githubToken: String
        get() = prefs.getString("github_token", "") ?: ""
        set(v) = prefs.edit().putString("github_token", v).apply()

    var owner: String
        get() = prefs.getString("owner", "") ?: ""
        set(v) = prefs.edit().putString("owner", v).apply()

    var repo: String
        get() = prefs.getString("repo", "") ?: ""
        set(v) = prefs.edit().putString("repo", v).apply()

    var branch: String
        get() = prefs.getString("branch", "main") ?: "main"
        set(v) = prefs.edit().putString("branch", v).apply()

    var anthropicKey: String
        get() = prefs.getString("anthropic_key", "") ?: ""
        set(v) = prefs.edit().putString("anthropic_key", v).apply()

    var model: String
        get() = prefs.getString("model", "claude-sonnet-5") ?: "claude-sonnet-5"
        set(v) = prefs.edit().putString("model", v).apply()

    var autoSync: Boolean
        get() = prefs.getBoolean("auto_sync", true)
        set(v) = prefs.edit().putBoolean("auto_sync", v).apply()

    var lastSyncAt: String
        get() = prefs.getString("last_sync_at", "") ?: ""
        set(v) = prefs.edit().putString("last_sync_at", v).apply()

    /** path -> git blob sha as of the last successful sync. */
    fun syncState(): MutableMap<String, String> {
        val raw = prefs.getString("sync_state", "{}") ?: "{}"
        val map = HashMap<String, String>()
        try {
            val obj = JSONObject(raw)
            for (key in obj.keys()) map[key] = obj.getString(key)
        } catch (e: Exception) {
            // Corrupt state just means a full resync.
        }
        return map
    }

    fun saveSyncState(state: Map<String, String>) {
        val obj = JSONObject()
        for ((k, v) in state) obj.put(k, v)
        prefs.edit().putString("sync_state", obj.toString()).apply()
    }

    fun isSyncConfigured(): Boolean =
        githubToken.isNotBlank() && owner.isNotBlank() && repo.isNotBlank()

    fun toJson(): JSONObject = JSONObject().apply {
        // The token is never handed to the WebView; only whether one is set.
        put("hasToken", githubToken.isNotBlank())
        put("hasAnthropicKey", anthropicKey.isNotBlank())
        put("owner", owner)
        put("repo", repo)
        put("branch", branch)
        put("model", model)
        put("autoSync", autoSync)
        put("lastSyncAt", lastSyncAt)
        put("syncConfigured", isSyncConfigured())
    }

    fun applyJson(json: JSONObject) {
        if (json.has("githubToken")) githubToken = json.optString("githubToken")
        if (json.has("anthropicKey")) anthropicKey = json.optString("anthropicKey")
        if (json.has("owner")) owner = json.optString("owner")
        if (json.has("repo")) repo = json.optString("repo")
        if (json.has("branch")) branch = json.optString("branch").ifBlank { "main" }
        if (json.has("model")) model = json.optString("model").ifBlank { "claude-sonnet-5" }
        if (json.has("autoSync")) autoSync = json.optBoolean("autoSync", true)
    }
}
