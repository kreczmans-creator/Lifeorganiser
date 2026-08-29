package com.lifeorganiser.app

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * Pulls iCalendar feeds — e.g. a Google Calendar "secret address in iCal
 * format" — and hands the raw ICS text to the UI, which does the parsing.
 * Read-only: nothing is ever written back to the calendar.
 */
class CalendarFetch(private val prefs: Prefs) {

    fun fetchAll(): JSONArray {
        val out = JSONArray()
        val urls = prefs.icalUrls.lines()
            .map { it.trim() }
            .filter { it.startsWith("https://") }

        for (url in urls) {
            val entry = JSONObject().put("url", url)
            try {
                entry.put("ok", true).put("body", fetch(url))
            } catch (e: Exception) {
                entry.put("ok", false).put("error", e.message ?: e.javaClass.simpleName)
            }
            out.put(entry)
        }
        return out
    }

    private fun fetch(url: String): String {
        var current = url
        // Google occasionally redirects the ICS endpoint across hosts, which
        // HttpURLConnection refuses to follow on its own.
        repeat(4) {
            val conn = URL(current).openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            conn.instanceFollowRedirects = true
            conn.setRequestProperty("User-Agent", "LifeOrganiser-Android")
            conn.setRequestProperty("Accept", "text/calendar, */*")

            val code = conn.responseCode
            if (code in 300..399) {
                val next = conn.getHeaderField("Location")
                    ?: throw Exception("Redirect without a Location header")
                conn.disconnect()
                current = if (next.startsWith("http")) next else URL(URL(current), next).toString()
                if (!current.startsWith("https://")) throw Exception("Refusing a non-HTTPS redirect")
                return@repeat
            }
            if (code !in 200..299) {
                conn.disconnect()
                throw Exception(
                    if (code == 404) "Calendar not found (404) — re-copy the secret iCal address"
                    else "Calendar fetch failed ($code)"
                )
            }

            // A personal ICS feed is rarely over a few hundred KB; 4MB is a
            // generous ceiling that still protects the WebView bridge.
            val body = conn.inputStream.bufferedReader().use(BufferedReader::readText)
            conn.disconnect()
            if (body.length > 4_000_000) throw Exception("Calendar feed too large")
            if (!body.contains("BEGIN:VCALENDAR")) throw Exception("Not an iCalendar feed")
            return body
        }
        throw Exception("Too many redirects")
    }
}
