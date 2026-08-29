package com.lifeorganiser.app

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * Optional. With an Anthropic API key set, the phone can do the thinking parts
 * — filing the Inbox, drafting a project, summarising the week — instead of
 * waiting for a Claude Code session. Everything else in the app works without
 * a key.
 */
class ClaudeAssist(private val prefs: Prefs) {

    class AssistError(message: String) : Exception(message)

    fun ask(system: String, user: String, maxTokens: Int = 2048): String {
        if (prefs.anthropicKey.isBlank()) {
            throw AssistError("Add an Anthropic API key in Settings to use AI actions.")
        }

        val body = JSONObject()
            .put("model", prefs.model)
            .put("max_tokens", maxTokens)
            .put("system", system)
            .put(
                "messages",
                JSONArray().put(
                    JSONObject().put("role", "user").put("content", user)
                )
            )

        val conn = (URL("https://api.anthropic.com/v1/messages").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 20_000
            readTimeout = 120_000
            setRequestProperty("x-api-key", prefs.anthropicKey)
            setRequestProperty("anthropic-version", "2023-06-01")
            setRequestProperty("content-type", "application/json")
            doOutput = true
        }
        conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }

        val code = try {
            conn.responseCode
        } catch (e: Exception) {
            throw AssistError("Network error: ${e.message}")
        }
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val text = stream?.bufferedReader()?.use(BufferedReader::readText) ?: ""
        conn.disconnect()

        if (code !in 200..299) {
            val detail = try {
                JSONObject(text).getJSONObject("error").optString("message", text)
            } catch (e: Exception) {
                text
            }
            throw AssistError(
                when (code) {
                    401 -> "Anthropic rejected the API key (401)."
                    429 -> "Rate limited (429). Try again shortly."
                    else -> "Anthropic error $code: $detail"
                }
            )
        }

        val content = JSONObject(text).getJSONArray("content")
        val out = StringBuilder()
        for (i in 0 until content.length()) {
            val block = content.getJSONObject(i)
            if (block.optString("type") == "text") out.append(block.optString("text"))
        }
        return out.toString().trim()
    }
}
