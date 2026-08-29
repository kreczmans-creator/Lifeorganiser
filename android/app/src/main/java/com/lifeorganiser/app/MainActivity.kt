package com.lifeorganiser.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.content.ActivityNotFoundException
import android.net.Uri

/**
 * A single WebView hosting the UI, with [VaultBridge] giving it the filesystem,
 * GitHub sync and the clock. Everything the app knows lives in markdown files.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var bridge: VaultBridge

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val vault = VaultStore(this)
        vault.seedIfEmpty()
        val prefs = Prefs(this)

        webView = WebView(this)
        setContentView(
            webView,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
        )

        bridge = VaultBridge(webView, vault, prefs)
        bridge.darkMode = isNightMode()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            setSupportZoom(false)
            builtInZoomControls = false
            mediaPlaybackRequiresUserGesture = true
        }
        WebView.setWebContentsDebuggingEnabled(false)

        webView.addJavascriptInterface(bridge, "Android")

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                android.util.Log.d(
                    "LifeOrganiserWeb",
                    "${message.message()} @${message.sourceId()}:${message.lineNumber()}"
                )
                return true
            }
        }

        webView.webViewClient = object : WebViewClient() {
            // Keep the app on its own pages; send real links to the browser.
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                val url = request.url
                if (url.scheme == "file") return false
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, url))
                    true
                } catch (e: ActivityNotFoundException) {
                    true
                }
            }
        }

        readIntent(intent)
        webView.loadUrl("file:///android_asset/web/index.html")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        readIntent(intent)
        // The page is already up; let it pick the new intent up itself.
        webView.evaluateJavascript("window.__onNewIntent && window.__onNewIntent();", null)
    }

    private fun readIntent(intent: Intent?) {
        if (intent == null) return

        if (intent.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            val text = intent.getStringExtra(Intent.EXTRA_TEXT)
            val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)
            val shared = listOfNotNull(subject, text)
                .filter { it.isNotBlank() }
                .distinct()
                .joinToString(" — ")
            if (shared.isNotBlank()) {
                bridge.pendingShare = shared
                bridge.pendingRoute = "capture"
            }
            return
        }

        intent.getStringExtra("route")?.let { bridge.pendingRoute = it }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        bridge.darkMode = isNightMode()
        webView.evaluateJavascript("window.__onThemeChange && window.__onThemeChange();", null)
    }

    private fun isNightMode(): Boolean =
        resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK ==
            Configuration.UI_MODE_NIGHT_YES

    override fun onPause() {
        super.onPause()
        // Flush any in-flight edit and let the page kick off a background sync.
        webView.evaluateJavascript("window.__onPause && window.__onPause();", null)
    }

    @Deprecated("Deprecated in Java")
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        webView.evaluateJavascript("window.__onBack && window.__onBack();") { result ->
            // The page returns "true" when it consumed the gesture itself.
            if (result != "true") {
                moveTaskToBack(true)
            }
        }
    }
}
