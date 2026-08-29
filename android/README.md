# Life Organiser for Android

The vault in your pocket. Same markdown files, same folder layout — capture,
tick, edit and review on the phone, then sync to GitHub so Claude Code and
Obsidian see exactly the same notes.

## Getting the app

You don't build anything. GitHub Actions builds the APK on every push and
attaches it to a rolling release:

**https://github.com/kreczmans-creator/lifeorganiser/releases/tag/apk-latest**

1. Open that page **on your phone**.
2. Tap `life-organiser.apk`.
3. Android will ask to allow installs from your browser — allow it, then
   install.

To update later, download it again from the same link. It installs over the
top; your notes and settings stay put.

> The build is signed with a throwaway key committed at
> `android/keystore/lifeorganiser.jks`. It exists so every build installs as
> an upgrade instead of forcing an uninstall, and it protects nothing — never
> reuse it for anything published.

## Connecting it to your repo

Open **Settings** in the app:

| Field | Value |
|---|---|
| Owner | `kreczmans-creator` |
| Repository | `lifeorganiser` |
| Branch | the branch you want the phone to write to |
| Token | a GitHub fine-grained personal access token |

Create the token at **github.com → Settings → Developer settings → Personal
access tokens → Fine-grained tokens**, scoped to **only this repository**,
with **Repository permissions → Contents: Read and write**. Tap **Test** to
confirm, then **Save**.

The token is stored in app-private preferences on the handset. Other apps
can't read it, but it isn't hardware-encrypted — which is why it should be
scoped to this one repo and nothing else.

Optionally add an **Anthropic API key** to unlock "Clarify all with Claude",
which files your whole Inbox in one go. Everything else works without it.

## What you can do on the phone

| | |
|---|---|
| **Today** | One Thing, today's tasks, habit ticks with streaks, due & overdue across the whole vault, project statuses, follow-ups and birthdays |
| **Capture** | The `+` button anywhere, a home-screen shortcut, or **share text from any app** straight into the Inbox |
| **Inbox** | File each capture into a project, goal, area, person, knowledge note, an existing note's task list, or the archive |
| **Notes** | Browse every section, open any note, tap checkboxes, edit raw markdown, follow `[[wikilinks]]` |
| **Sync** | One tap, or automatic on launch and when you leave the app |

Long-press the app icon for **Capture** and **Today** shortcuts.

## How sync works

There's no git binary on the phone. The app talks to the GitHub REST API and
compares the **git blob SHA** of every local file against the SHA recorded at
the last sync and the SHA in the remote tree:

- changed only on the phone → pushed
- changed only in the repo → pulled
- changed in both places → your phone's copy is kept, and the repo's version
  is saved beside it as `<note> (from repo).md` so nothing is ever lost

Pushes are real commits with real parents, so `git log` reads normally and
Claude Code sessions see ordinary history. The first sync behaves like a
clone: the repo wins, and anything only the phone has is pushed up.

Only `.md` files outside `android/` and dot-directories sync — app source and
CI config never land on the handset.

## Building it yourself

Requires the Android SDK (the CI runner has it; a plain container does not).

```bash
cd android
./gradlew assembleRelease
# app/build/outputs/apk/release/app-release.apk
```

The vault markdown at the repo root is copied into `assets/seed/` by the
`seedVault` Gradle task, so a fresh install has a working vault before you've
configured sync.

## Working on the UI

The interface is a WebView over `app/src/main/assets/web/`. When
`window.Android` is absent, `bridge.js` swaps in a localStorage-backed mock
with seed data — so you can open `app/src/main/assets/web/index.html` in a
desktop browser and get the whole app, no emulator needed.

```
web/index.html   shell
web/app.css      light + dark theming
web/md.js        markdown render/parse and the vault model
web/bridge.js    Android bridge, with the browser fallback
web/app.js       views, router, and the actions
```

Kotlin side: `MainActivity` hosts the WebView, `VaultBridge` exposes the
filesystem and network to JS, `VaultStore` is the on-disk vault, `GitHubSync`
is the sync engine, and `ClaudeAssist` is the optional API call.
