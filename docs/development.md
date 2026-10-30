# Developing Gitorian

[Back to the Gitorian overview](../README.md)

## Run locally

Requirements: Node.js **24.16 or newer**, **pnpm 10.24.0** (pinned in `package.json`), and Git.

```sh
git clone https://github.com/XII-A/gitorian.git
cd gitorian
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` watches the main process, preload, and renderer. Development uses the application data directory too; back up existing data before experimenting with storage changes.

```sh
pnpm verify:release # Pre-PR check, compile and desktop verification
pnpm check        # TypeScript, lint, formatting, and unit/integration tests
pnpm build        # Production compilation
pnpm test:e2e     # Real Electron journeys (after build)
pnpm start        # Preview the compiled desktop app
pnpm package:dir  # Build an unpacked desktop app
pnpm package      # Build an installer for the current platform into release/
```

Build on the target operating system for the most predictable installer results. Packaging alone does not publish a GitHub Release. Review build output, signing, and installer behavior before uploading release assets.

See [testing](testing.md) for focused commands, Playwright debugging, retained evidence, and guidance for adding or migrating tests.

The app icon's editable source is `resources/icon.svg`, exported from [Paper](https://app.paper.design/file/01M5S7QJ9BJRNKDCTRHEA0E1CF). After replacing it, run `pnpm icons` and commit the generated PNG, Windows ICO, and macOS ICNS files. The runtime window icon and Linux package use the PNG; Windows and macOS packages use their native formats. Windows resource editing stays enabled to embed the icon while signing remains disabled.

## Releasing and repository protection

PRs targeting `main`, `release`, or `release/**` run **CI checks** (typecheck, lint, formatting and tests) on Windows. Agents run production compilation and Electron journeys locally through `pnpm verify:release` before creating a PR; see [testing](testing.md). The release workflow runs the checks again for a `vMAJOR.MINOR.PATCH` tag that matches `package.json` and points to a commit on `main`. It builds an unsigned Windows x64 installer, the update feed (`latest.yml`) and installer blockmap, computes SHA-256 checksums for all three, and uploads them to a **draft** GitHub Release. It never publishes automatically or overwrites an existing release.

After the release changes are merged into `main`, a maintainer creates a release candidate with:

```sh
git switch main
git pull --ff-only
git tag v0.1.6
git push origin v0.1.6
```

When creating or updating a release description, use the [release description template](release-notes.md) and save the finished copy in `.github/release-notes.md`.

Download the installer and `SHA256SUMS` from the draft and follow the [maintainer verification checklist](release-notes.md#maintainer-verification) on a test account or machine. Confirm the hash with `Get-FileHash -Algorithm SHA256`, install, and test repository import, writing persistence, backup restore, and any integrations being claimed as tested. Record results under `.ai-docs/verification/`, then publish that same draft manually. Draft downloads require repository write access. Do not grant write access just to share an installer. A failed candidate should be fixed with a new version/tag rather than replacing a tested asset or moving a tag.

If an infrastructure or billing problem prevented the workflow from running, fix it and use **Actions → Draft Windows release → Run workflow** on `main`, supplying the existing tag. This retries the original tagged source without moving the tag. Existing releases are still protected from replacement. Private-repository Actions are subject to your account's included minutes, billing status, and spending limits; workflow files cannot override an account billing block.

The only release-write token is GitHub's short-lived workflow token in the upload job. PR/build jobs have read-only repository permissions, checkout credentials are not persisted, and third-party actions are pinned to commit SHAs. Temporary installer artifacts expire after one day; Release attachments remain until removed. Code signing certificates are not configured. Add Windows signing before wider distribution; macOS support should include Developer ID signing and notarization.

Public visibility permits reading/forking and submitting PRs, not merging. Keep collaborator write access limited to trusted maintainers. On GitHub Free, branch/tag rules cannot be enforced while this repository is private. After making it public, run the checked-in protection setup from PowerShell using an authenticated owner account:

```powershell
./.github/configure-protection.ps1          # Preview
./.github/configure-protection.ps1 -Apply   # Activate and verify
```

The setup requires PRs, successful **CI checks** from GitHub Actions, an up-to-date branch, and resolved review threads for `main`; it blocks force pushes and deletion, including for administrators. Additional approving reviews are set to zero so a solo maintainer can merge their own PRs. Separate tag rules restrict creation of `v*` tags to administrators and block changing/deleting them. External contributors' workflow runs require approval. The script updates its named rulesets on reruns and does not change repository visibility. It requires PowerShell and the `gh` CLI, plus a successful CI run before the required check can be used normally.

The app uses Electron, React, TypeScript, SQLite, and electron-vite. `src/main` owns Git, integrations, and persistence; `src/preload` exposes the desktop bridge; `src/renderer` contains the UI; `src/shared` contains schemas and shared formatting. See [frontend conventions](frontend.md) for UI development and desktop smoke checks. Smoke tools write diagnostics and screenshots under ignored `.ai-docs`; keep personal profiles and credentials out of fixtures and screenshots.
