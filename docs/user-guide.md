# Using Gitorian

[Back to the Gitorian overview](../README.md)

## Getting started

1. Install [Git](https://git-scm.com/downloads) and make sure `git` is available on your `PATH`.
2. Open Settings → Repositories and choose a folder containing your local Git repositories. Review the discovered repositories, select those to track, and import them.
3. Check each repository’s author emails, history start, remote, and comparison base. The app reads existing local refs; fetch repositories with your usual Git tools when you need newer remote history.
4. Open a week, review activity and diffs, and start writing. Drafts save locally; activity can be cited in the entry.
5. Connect GitHub or GitLab for pull requests and reviews to complete onboarding. Optionally connect Notion for publishing. Previous entries includes your autosaved local writing.

Local Git activity and writing do not require either integration.

Add screenshots and diagrams with `/image`, clipboard paste, or file drop. PNG, JPEG, still WebP, and self-contained SVG are supported up to 5 MB and 40 million pixels per image (10 files at a time). Images save locally and remain available offline. Write a caption directly below an image; it also supplies alternative text and the Notion caption. Image actions appear in its upper corner, with a compact menu for small images. Click an image for a lightbox with zoom, navigation, and download controls. Drops show an insertion guide, imports show a skeleton, and failures clear the placeholder with an error toast. Finish or cancel image imports before publishing. Templates support the same images.

## Updates

Updates download in the background while you write. Once ready, a toast and an icon with a white dot appear in the hub and writing workspace. Choose **Update now** to save your writing, install and restart, or dismiss the toast and use the header icon later. Quitting normally does not install an update.

## Data storage and privacy

The app stores journal state in `journal.sqlite` in Electron’s per-user application data directory (`app.getPath('userData')`). Default locations are `%APPDATA%/Gitorian` on Windows, `~/Library/Application Support/Gitorian` on macOS, and `$XDG_CONFIG_HOME/Gitorian` or `~/.config/Gitorian` on Linux. SQLite may also create `-wal` and `-shm` files.

This database is **not encrypted**. It includes image bytes, drafts, repository paths and remotes, author emails, imported activity, cached diffs and revision evidence, and cached Notion entries. Treat it as private source and writing data. There is no app-operated journal storage or analytics service. A small OAuth helper handles Notion credential exchange and refresh. Connected integrations make requests to GitHub and Notion; external links and Notion avatars can also access the network. Publishing sends the entry content, images, and citations to the chosen Notion destination.

Integration tokens live separately in `github.secret` and `notion.secret`, encrypted using Electron `safeStorage` when a supported operating-system credential backend is available. Without one (including Linux’s `basic_text` backend), new tokens remain in memory for the session and require sign-in again after restart. Disconnecting removes the local token; revoke access in GitHub or Notion too if you want to invalidate it remotely. Disconnecting does not erase cached journal data.

Use Settings → Backup to export or import journal state. Format 3 exports include captured patches and revision evidence, and omit repository folder paths and integration tokens. They still contain writing, all imported images (including removed images), activity, account metadata, repository remotes, and author emails, so keep them private. Import replaces this device’s journal and requires locating repositories again. JSON backups support up to 512 MiB. Only format 3 backups are accepted by this pre-release schema. The former development database is left untouched and is not imported automatically. Imported image bytes remain durable for undo and unsaved recovery; automatic cache collection prunes only eligible patches and resolved publication history. For a full local backup, close the app and copy its entire data directory; encrypted tokens may not be portable to another machine or account.

## Integration setup and permissions

### GitHub (optional)

In Settings > Connections, choose **Sign in with GitHub**, then follow the browser sign-in and device-code prompts. Everyone authorizes Gitorian's shared OAuth app using their own GitHub account. No app registration, client ID entry, or client secret is needed. Authentication runs directly between your device and GitHub; no Gitorian authentication server is involved.

Sign-in requests `repo`, `read:user`, and `user:email`. These allow private repository access, reading your profile, and reading your account email addresses to match authored activity. **The `repo` scope also grants write access**, even though the current GitHub integration only reads repository activity and diffs. Review this broad grant before authorizing, particularly for work repositories. Organization policies may restrict access. The integration supports GitHub.com remotes; GitHub Enterprise and other Git hosts are not supported for PR/review imports.

### Notion (optional)

In Settings > Connections, choose **Connect** beside Notion and approve Gitorian in your browser. The app prepares a private **Weekly Journal** parent page automatically. Read content, Insert content and Update content permissions support reading saved entries, creating pages and updating published writing. Local writing remains available without connecting.

The connection uses a small hosted OAuth module to protect the app's client secret and exchange/refresh your credentials. Your journal content and images travel directly from the desktop to Notion. Credentials stay on your device; the helper does not permanently store them. Existing installed integration tokens remain usable until disconnected.

You can change the destination to an existing parent page or database data source in Settings. Database destinations require the data source ID and exact title-property name. Test a custom destination before publishing. See [Notion development and release deployment](notion-oauth.md) for running the local OAuth module, configuring Netlify, and automatic deployment on published releases.

## Known limitations

- This is version 0.1.6. Cross-platform packaging is configured, but that is not a claim that all platforms have been validated or that installers are signed/notarized.
- Imports depend on accessible local repositories, matching author emails, the configured history range, and available refs. Remote activity needs network access and sufficient GitHub permissions; API limits can delay collection.
- Large diffs are limited (approximately 2 MB); individual GitHub detail lists above 3,000 records are rejected. Use the original repository or GitHub for complete evidence.
- Notion conversion supports a subset of its content model; complex blocks may not round-trip exactly. Publishing can modify remote page content. Review uncertain publish results in Notion before retrying.
- Backups are manual. There is no built-in synchronization of the local database across devices, and publishing keeps a remote snapshot of your locally autosaved writing.
- Tagged releases are built into drafts for installation verification before manual publication. In-app updates are available for packaged Windows installs starting with 0.1.5; the first installation and other platforms use manual downloads.
