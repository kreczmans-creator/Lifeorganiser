package com.lifeorganiser.app

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * Two-way sync with a GitHub repository over the REST API — no git binary, no
 * clone on the handset. Changes are detected by comparing the git blob SHA of
 * each local file against the SHA recorded at the last sync and the SHA in the
 * remote tree, which gives a proper three-way merge:
 *
 *   local changed only  -> push
 *   remote changed only -> pull
 *   both changed        -> keep local, save the remote copy beside it, report it
 *
 * Pushing writes a real commit, so Claude Code sessions see ordinary history.
 */
class GitHubSync(private val prefs: Prefs, private val vault: VaultStore) {

    class SyncError(message: String) : Exception(message)

    private val api = "https://api.github.com"

    private fun request(
        method: String,
        path: String,
        body: JSONObject? = null,
    ): String {
        val url = URL(if (path.startsWith("http")) path else "$api$path")
        val conn = url.openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.connectTimeout = 20_000
        conn.readTimeout = 60_000
        conn.setRequestProperty("Authorization", "Bearer ${prefs.githubToken}")
        conn.setRequestProperty("Accept", "application/vnd.github+json")
        conn.setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
        conn.setRequestProperty("User-Agent", "LifeOrganiser-Android")

        if (body != null) {
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        }

        val code = try {
            conn.responseCode
        } catch (e: Exception) {
            throw SyncError("Network error: ${e.message}")
        }

        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val text = stream?.bufferedReader()?.use(BufferedReader::readText) ?: ""
        conn.disconnect()

        if (code !in 200..299) {
            val detail = try {
                JSONObject(text).optString("message", text)
            } catch (e: Exception) {
                text
            }
            throw SyncError(
                when (code) {
                    401 -> "GitHub rejected the token (401). Check it hasn't expired."
                    403 -> "Forbidden (403). The token needs Contents: read and write on this repo."
                    404 -> "Not found (404). Check the owner, repo and branch, and that the token can see it."
                    409, 422 -> "Conflict ($code): $detail. Sync again to pick up the newest commit."
                    else -> "GitHub error $code: $detail"
                }
            )
        }
        return text
    }

    /** Only markdown belonging to the vault; app sources and CI stay out of it. */
    private fun isVaultPath(path: String): Boolean {
        if (!path.endsWith(".md")) return false
        if (path.startsWith(".")) return false
        if (path.startsWith("android/")) return false
        return true
    }

    private fun headCommitSha(): String {
        val ref = request("GET", "/repos/${prefs.owner}/${prefs.repo}/git/ref/heads/${prefs.branch}")
        return JSONObject(ref).getJSONObject("object").getString("sha")
    }

    fun sync(): JSONObject {
        if (!prefs.isSyncConfigured()) {
            throw SyncError("Add your GitHub token, owner and repo in Settings first.")
        }

        val owner = prefs.owner
        val repo = prefs.repo
        val branch = prefs.branch

        val headSha = headCommitSha()

        val treeJson = JSONObject(
            request("GET", "/repos/$owner/$repo/git/trees/$headSha?recursive=1")
        )
        if (treeJson.optBoolean("truncated", false)) {
            throw SyncError("The repository tree is too large to sync from the phone.")
        }
        val baseTreeSha = treeJson.getString("sha")

        val remote = HashMap<String, String>()
        val entries = treeJson.getJSONArray("tree")
        for (i in 0 until entries.length()) {
            val entry = entries.getJSONObject(i)
            if (entry.getString("type") != "blob") continue
            val path = entry.getString("path")
            if (!isVaultPath(path)) continue
            remote[path] = entry.getString("sha")
        }

        val local = HashMap<String, String>()
        for (path in vault.list()) {
            if (!isVaultPath(path)) continue
            val bytes = vault.readBytes(path) ?: continue
            local[path] = VaultStore.gitBlobSha(bytes)
        }

        val recorded = prefs.syncState()
        val firstSync = recorded.isEmpty()

        val toPull = ArrayList<String>()
        val toDeleteLocally = ArrayList<String>()
        val toPush = ArrayList<String>()
        val toDeleteRemotely = ArrayList<String>()
        val conflicts = ArrayList<String>()

        for (path in (remote.keys + local.keys)) {
            val r = remote[path]
            val l = local[path]
            val base = recorded[path]

            when {
                r == l -> Unit // already agree

                // The very first sync behaves like a clone: the repo wins, and
                // anything the phone has that the repo lacks is offered up.
                firstSync -> if (r != null) toPull.add(path) else toPush.add(path)

                base == null -> when {
                    r == null -> toPush.add(path)
                    l == null -> toPull.add(path)
                    else -> conflicts.add(path)
                }

                l == base -> if (r == null) toDeleteLocally.add(path) else toPull.add(path)

                r == base -> if (l == null) toDeleteRemotely.add(path) else toPush.add(path)

                else -> conflicts.add(path)
            }
        }

        // Conflicts: the phone's copy stays as the working file and the repo's
        // copy lands beside it so nothing is ever silently lost.
        val conflictFiles = ArrayList<String>()
        for (path in conflicts) {
            val remoteSha = remote[path] ?: continue
            val content = fetchBlob(owner, repo, remoteSha)
            val target = path.removeSuffix(".md") + " (from repo).md"
            vault.write(target, content)
            conflictFiles.add(target)
        }

        for (path in toPull) {
            val sha = remote[path] ?: continue
            vault.write(path, fetchBlob(owner, repo, sha))
        }
        for (path in toDeleteLocally) {
            vault.delete(path)
        }

        var pushedCommit: String? = null
        if (toPush.isNotEmpty() || toDeleteRemotely.isNotEmpty()) {
            pushedCommit = push(owner, repo, branch, headSha, baseTreeSha, toPush, toDeleteRemotely)
        }

        // Record where everything stands now, so the next sync can diff again.
        val newState = HashMap<String, String>()
        for (path in vault.list()) {
            if (!isVaultPath(path)) continue
            // Conflict copies are local-only until the user deals with them.
            if (conflictFiles.contains(path)) continue
            val bytes = vault.readBytes(path) ?: continue
            newState[path] = VaultStore.gitBlobSha(bytes)
        }
        prefs.saveSyncState(newState)
        prefs.lastSyncAt = Clock.now()

        val conflictArray = JSONArray()
        conflictFiles.forEach { conflictArray.put(it) }

        return JSONObject().apply {
            put("pulled", toPull.size)
            put("pushed", toPush.size)
            put("deletedLocally", toDeleteLocally.size)
            put("deletedRemotely", toDeleteRemotely.size)
            put("conflicts", conflictArray)
            put("commit", pushedCommit ?: JSONObject.NULL)
            put("lastSyncAt", prefs.lastSyncAt)
        }
    }

    private fun fetchBlob(owner: String, repo: String, sha: String): String {
        val blob = JSONObject(request("GET", "/repos/$owner/$repo/git/blobs/$sha"))
        val encoded = blob.getString("content").replace("\n", "").replace("\r", "")
        return String(Base64.decode(encoded, Base64.NO_WRAP), Charsets.UTF_8)
    }

    private fun push(
        owner: String,
        repo: String,
        branch: String,
        headSha: String,
        baseTreeSha: String,
        toPush: List<String>,
        toDeleteRemotely: List<String>,
    ): String {
        val tree = JSONArray()

        for (path in toPush) {
            val bytes = vault.readBytes(path) ?: continue
            val blobSha = JSONObject(
                request(
                    "POST", "/repos/$owner/$repo/git/blobs",
                    JSONObject()
                        .put("content", Base64.encodeToString(bytes, Base64.NO_WRAP))
                        .put("encoding", "base64")
                )
            ).getString("sha")

            tree.put(
                JSONObject()
                    .put("path", path)
                    .put("mode", "100644")
                    .put("type", "blob")
                    .put("sha", blobSha)
            )
        }

        for (path in toDeleteRemotely) {
            tree.put(
                JSONObject()
                    .put("path", path)
                    .put("mode", "100644")
                    .put("type", "blob")
                    .put("sha", JSONObject.NULL)
            )
        }

        if (tree.length() == 0) return headSha

        val newTreeSha = JSONObject(
            request(
                "POST", "/repos/$owner/$repo/git/trees",
                JSONObject().put("base_tree", baseTreeSha).put("tree", tree)
            )
        ).getString("sha")

        val changed = toPush.size + toDeleteRemotely.size
        val summary = if (changed == 1) {
            val only = (toPush + toDeleteRemotely).first()
            "Update ${only.substringAfterLast('/').removeSuffix(".md")} from phone"
        } else {
            "Sync $changed notes from phone"
        }

        val commitSha = JSONObject(
            request(
                "POST", "/repos/$owner/$repo/git/commits",
                JSONObject()
                    .put("message", "$summary\n\nvia Life Organiser for Android")
                    .put("tree", newTreeSha)
                    .put("parents", JSONArray().put(headSha))
            )
        ).getString("sha")

        request(
            "PATCH", "/repos/$owner/$repo/git/refs/heads/$branch",
            JSONObject().put("sha", commitSha)
        )

        return commitSha
    }

    /** Confirm the token and repo work before the user relies on them. */
    fun testConnection(): JSONObject {
        if (!prefs.isSyncConfigured()) throw SyncError("Fill in token, owner and repo first.")
        val repoJson = JSONObject(request("GET", "/repos/${prefs.owner}/${prefs.repo}"))

        // A branch that doesn't exist (e.g. the untouched "main" default in a
        // repo whose default branch is named differently) is self-corrected to
        // the repo's real default rather than left as a confusing 404.
        var correctedFrom: String? = null
        val head = try {
            headCommitSha()
        } catch (e: SyncError) {
            val default = repoJson.optString("default_branch")
            if (default.isNotBlank() && default != prefs.branch) {
                correctedFrom = prefs.branch
                prefs.branch = default
                headCommitSha()
            } else {
                throw e
            }
        }

        return JSONObject()
            .put("repo", repoJson.optString("full_name"))
            .put("private", repoJson.optBoolean("private"))
            .put("branch", prefs.branch)
            .put("correctedFrom", correctedFrom ?: JSONObject.NULL)
            .put("head", head.take(7))
    }
}
