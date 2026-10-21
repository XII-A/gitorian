# Repository import

Choose a project folder, review discovered Git repositories, and import only selected projects without losing existing tracking choices.

## Sub-features

- `import.review`: discovery is read-only until confirmation; tracked repositories are disabled.
- `import.selection`: search preserves hidden selections, deselecting all disables import, duplicate project names remain distinct.
- `import.cancel`: Cancel and Escape return without importing.
- `import.persist`: selected repositories are added once; stopped tracking resumes; excluded projects remain absent.
- `import.error`: missing folders show an actionable error and return to Settings; reduced motion remains usable.

## How to get to it (user POV)

Open settings -> Repositories -> Add repositories from folder. The native picker accepts a parent containing several projects or a single repository. Both paths must show review before import.

## Driving it with Electron

Preconditions: compiled app, installed Electron, Git on PATH, and no integration credentials. `pnpm verify repository-import` provisions all fixture state itself.

- **Open:** `[aria-label="Open settings"]`, then `Add repositories from folder`; capture chooser waiting, scanning, success, and review.
- **Select:** `.repository-import-row [role="checkbox"]`; require five eligible checks and one disabled tracked row. Deselect all -> disabled `Import 0 repositories`; Select all -> deselect `playground`.
- **Search/cancel:** type `website` into `.repository-import-tools input`; require two rows and four total selections. Cancel -> two original stored repositories, no imports.
- **Confirm:** reopen, deselect `playground`, click `Import 4 repositories`; wait for completion. Require five stored repositories total, `archived-tools` active, and no `playground`. Verify the independent post-exit SQLite result in `persisted-repositories.json`.
- **Other picker entries:** choose the single `playground` folder -> `Import 1 repository`; Escape -> Settings. Choose a missing folder -> error -> `Back to Settings`.
- **Proof:** require zero exit and `run.json.passed`, `cleanup.removed`, numbered screenshots, action transcript, and retained database query results.

## Gotchas

The native picker is automated; filesystem discovery, Git inspection, IPC, renderer, and SQLite are real. The harness intentionally delays I/O to capture progress, so its runtime is not an import-performance benchmark. Two repositories are established through application commands before the user journey; count assertions account for these fixtures. A successful final screenshot alone does not prove cancellation or persistence.
