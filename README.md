# Gitorian

A desktop journal for developers. Review your week’s Git commits, GitHub pull requests and reviews, then write a journal entry with links back to the work. Keep drafts locally and optionally publish to Notion.

## Downloads

Download installers from [GitHub Releases](https://github.com/XII-A/gitorian/releases). Windows x64 installers and checksums are available for published releases. GitHub’s automatically generated source archives are source code, not installers.

The release workflow builds **Windows 10/11 x64** NSIS installers and attaches `SHA256SUMS` to a draft release. Initial Windows installers are **unsigned**, which may cause browser or SmartScreen warnings. Verify the downloaded checksum before installing. macOS and Linux packaging remains available for development but is not included in the release workflow. This is an early app; back up your journal before trying an update.

Install version 0.1.6 manually to enable future in-app updates on Windows. Updates download in the background while you write. Once ready, a toast and an icon with a white dot appear in the hub and writing workspace. Choose **Update now** to save your writing, install and restart, or dismiss the toast and use the header icon later. Quitting normally does not install an update.

## Getting started

1. Install [Git](https://git-scm.com/downloads) and make sure `git` is available on your `PATH`.
2. Open Settings → Repositories and choose a folder containing your local Git repositories. Review the discovered repositories, select those to track, and import them.
3. Check each repository’s author emails, history start, remote, and comparison base. The app reads existing local refs; fetch repositories with your usual Git tools when you need newer remote history.
4. Open a week, review activity and diffs, and start writing. Drafts save locally; activity can be cited in the entry.
5. Optionally connect GitHub for pull requests and reviews, and Notion for publishing and reading saved entries.

Local Git activity and writing do not require either integration.

Add screenshots and diagrams with `/image`, clipboard paste, or file drop. PNG, JPEG, still WebP, and self-contained SVG are supported up to 5 MB and 40 million pixels per image (10 files at a time). Images save locally and remain available offline. Write a caption directly below an image; it also supplies alternative text and the Notion caption. Image actions appear in its upper corner, with a compact menu for small images. Click an image for a lightbox with zoom, navigation, and download controls. Drops show an insertion guide, imports show a skeleton, and failures clear the placeholder with an error toast. Finish or cancel image imports before publishing. Templates support the same images.

## Data storage and privacy

The app stores journal state in `gitorian.sqlite` in Electron’s per-user application data directory (`app.getPath('userData')`). Default locations are `%APPDATA%/Gitorian` on Windows, `~/Library/Application Support/Gitorian` on macOS, and `$XDG_CONFIG_HOME/Gitorian` or `~/.config/Gitorian` on Linux. SQLite may also create `-wal` and `-shm` files.

This database is **not encrypted**. It includes image bytes, drafts, repository paths and remotes, author emails, imported activity, cached diffs and revision evidence, and cached Notion entries. Treat it as private source and writing data. There is no app-operated journal storage or analytics service. A small OAuth helper handles Notion credential exchange and refresh. Connected integrations make requests to GitHub and Notion; external links and Notion avatars can also access the network. Publishing sends the entry content, images, and citations to the chosen Notion destination.

Integration tokens live separately in `github.secret` and `notion.secret`, encrypted using Electron `safeStorage` when a supported operating-system credential backend is available. Without one (including Linux’s `basic_text` backend), new tokens remain in memory for the session and require sign-in again after restart. Disconnecting removes the local token; revoke access in GitHub or Notion too if you want to invalidate it remotely. Disconnecting does not erase cached journal data.

Use Settings → Backup to export or import journal state. Exports omit repository folder paths, cached diffs, and revision diff bodies; they do **not** include integration tokens. They still contain writing, all imported images (including removed images), activity, account metadata, repository remotes, and author emails, so keep them private. Import replaces this device’s journal and requires locating repositories again. JSON backups support up to 512 MiB. Existing text-only backups remain importable; new image-bearing backups require this app version or newer. Removed image bytes are retained for undo and recovery; there is no automatic image cleanup yet. For a full local backup, close the app and copy its entire data directory; encrypted tokens may not be portable to another machine or account.

## Integration setup and permissions

### GitHub (optional)

In Settings > Connections, choose **Sign in with GitHub**, then follow the browser sign-in and device-code prompts. Everyone authorizes Gitorian's shared OAuth app using their own GitHub account. No app registration, client ID entry, or client secret is needed. Authentication runs directly between your device and GitHub; no Gitorian authentication server is involved.

Sign-in requests `repo`, `read:user`, and `user:email`. These allow private repository access, reading your profile, and reading your account email addresses to match authored activity. **The `repo` scope also grants write access**, even though the current GitHub integration only reads repository activity and diffs. Review this broad grant before authorizing, particularly for work repositories. Organization policies may restrict access. The integration supports GitHub.com remotes; GitHub Enterprise and other Git hosts are not supported for PR/review imports.

### Notion (optional)

In Settings ? Connections, choose **Connect** beside Notion and approve Gitorian in your browser. The app prepares a private **Weekly Journal** parent page automatically. Read content, Insert content and Update content permissions support reading saved entries, creating pages and updating published writing. Local writing remains available without connecting.

The connection uses a small hosted OAuth module to protect the app's client secret and exchange/refresh your credentials. Your journal content and images travel directly from the desktop to Notion. Credentials stay on your device; the helper does not permanently store them. Existing installed integration tokens remain usable until disconnected.

You can change the destination to an existing parent page or database data source in Settings. Database destinations require the data source ID and exact title-property name. Test a custom destination before publishing. See [Notion development and release deployment](docs/notion-oauth.md) for running the local OAuth module, configuring Netlify, and automatic deployment on published releases.

## Known limitations

- This is version 0.1.6. Cross-platform packaging is configured, but that is not a claim that all platforms have been validated or that installers are signed/notarized.
- Imports depend on accessible local repositories, matching author emails, the configured history range, and available refs. Remote activity needs network access and sufficient GitHub permissions; API limits can delay collection.
- Large diffs are limited (approximately 2 MB); individual GitHub detail lists above 3,000 records are rejected. Use the original repository or GitHub for complete evidence.
- Notion conversion supports a subset of its content model; complex blocks may not round-trip exactly. Publishing can modify remote page content. Review uncertain publish results in Notion before retrying.
- Backups are manual. There is no built-in synchronization of the local database across devices, and published entries are separate from unfinished local drafts.
- Tagged releases are built into drafts for installation verification before manual publication. In-app updates are available for packaged Windows installs starting with 0.1.5; the first installation and other platforms use manual downloads.

## Development

Requirements: Node.js **22.19 or newer**, **pnpm 10.24.0** (pinned in `package.json`), and Git.

```sh
git clone https://github.com/XII-A/gitorian.git
cd gitorian
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` watches the main process, preload, and renderer. Development uses the application data directory too; back up existing data before experimenting with storage changes.

```sh
pnpm check        # TypeScript, lint, formatting, and unit/integration tests
pnpm build        # Production compilation
pnpm start        # Preview the compiled desktop app
pnpm package:dir  # Build an unpacked desktop app
pnpm package      # Build an installer for the current platform into release/
```

Build on the target operating system for the most predictable installer results. Packaging alone does not publish a GitHub Release. Review build output, signing, and installer behavior before uploading release assets.

The app icon's editable source is `resources/icon.svg`, exported from [Paper](https://app.paper.design/file/01M5S7QJ9BJRNKDCTRHEA0E1CF). After replacing it, run `pnpm icons` and commit the generated PNG, Windows ICO, and macOS ICNS files. The runtime window icon and Linux package use the PNG; Windows and macOS packages use their native formats. Windows resource editing stays enabled to embed the icon while signing remains disabled.

## Releasing and repository protection

PRs and pushes to `main` run **CI checks** (typecheck, lint, formatting, tests, and production compilation) on Windows. The release workflow runs the checks again for a `vMAJOR.MINOR.PATCH` tag that matches `package.json` and points to a commit on `main`. It builds an unsigned Windows x64 installer, the update feed (`latest.yml`) and installer blockmap, computes SHA-256 checksums for all three, and uploads them to a **draft** GitHub Release. It never publishes automatically or overwrites an existing release.

After the release changes are merged into `main`, a maintainer creates a release candidate with:

```sh
git switch main
git pull --ff-only
git tag v0.1.6
git push origin v0.1.6
```

When creating or updating a release description, use the [release description template](docs/release-notes.md) and save the finished copy in `.github/release-notes.md`.

Download the installer and `SHA256SUMS` from the draft and follow the [maintainer verification checklist](docs/release-notes.md#maintainer-verification) on a test account or machine. Confirm the hash with `Get-FileHash -Algorithm SHA256`, install, and test repository import, writing persistence, backup restore, and any integrations being claimed as tested. Record results under `.ai-docs/verification/`, then publish that same draft manually. Draft downloads require repository write access. Do not grant write access just to share an installer. A failed candidate should be fixed with a new version/tag rather than replacing a tested asset or moving a tag.

If an infrastructure or billing problem prevented the workflow from running, fix it and use **Actions → Draft Windows release → Run workflow** on `main`, supplying the existing tag. This retries the original tagged source without moving the tag. Existing releases are still protected from replacement. Private-repository Actions are subject to your account's included minutes, billing status, and spending limits; workflow files cannot override an account billing block.

The only release-write token is GitHub's short-lived workflow token in the upload job. PR/build jobs have read-only repository permissions, checkout credentials are not persisted, and third-party actions are pinned to commit SHAs. Temporary installer artifacts expire after one day; Release attachments remain until removed. Code signing certificates are not configured. Add Windows signing before wider distribution; macOS support should include Developer ID signing and notarization.

Public visibility permits reading/forking and submitting PRs, not merging. Keep collaborator write access limited to trusted maintainers. On GitHub Free, branch/tag rules cannot be enforced while this repository is private. After making it public, run the checked-in protection setup from PowerShell using an authenticated owner account:

```powershell
./.github/configure-protection.ps1          # Preview
./.github/configure-protection.ps1 -Apply   # Activate and verify
```

The setup requires PRs, successful **CI checks** from GitHub Actions, an up-to-date branch, and resolved review threads for `main`; it blocks force pushes and deletion, including for administrators. Additional approving reviews are set to zero so a solo maintainer can merge their own PRs. Separate tag rules restrict creation of `v*` tags to administrators and block changing/deleting them. External contributors' workflow runs require approval. The script updates its named rulesets on reruns and does not change repository visibility. It requires PowerShell and the `gh` CLI, plus a successful CI run before the required check can be used normally.

The app uses Electron, React, TypeScript, SQLite, and electron-vite. `src/main` owns Git, integrations, and persistence; `src/preload` exposes the desktop bridge; `src/renderer` contains the UI; `src/shared` contains schemas and shared formatting. See [frontend conventions](docs/frontend.md) for UI development and desktop smoke checks. Smoke tools write diagnostics and screenshots under ignored `.ai-docs`; keep personal profiles and credentials out of fixtures and screenshots.

## Feedback and license

Use [GitHub Issues](https://github.com/XII-A/gitorian/issues) for bugs and feature requests. Remove tokens, private repository names, paths, journal content, and personal information from reports and screenshots. Do not attach your application data directory or journal backup.

MIT licensed; see [LICENSE](LICENSE) and [NOTICE](NOTICE) for bundled component attribution.
