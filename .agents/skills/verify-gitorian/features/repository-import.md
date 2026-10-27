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

The owning scenario is `tests/e2e/repository-import.spec.ts`, using the shared Playwright desktop fixture. Run it directly with `pnpm test:e2e repository-import`; add `--debug` for Inspector. Evidence survives reruns under `.ai-docs/verification/desktop/runs/`, and `pnpm test:e2e:report` opens the latest report. Consult [testing](../../../../docs/testing.md) for fixture authoring, traces and cleanup.

- **Open:** `[aria-label="Open settings"]`, then `Add repositories from folder`; capture chooser waiting, scanning, success, and review.
- **Branding:** the live doctor requires the document title and visible window title to read `Gitorian`; the runner independently reads `gitorian.sqlite` after exit.
- **Appearance:** launch with Electron's platform theme set to light, then switch dark and back to light. Require the app theme and computed color scheme to remain dark; retain `00-dark-theme-light-platform.png`. This is process-local platform emulation and does not change the user's OS settings.
- **Select:** `.repository-import-row [role="checkbox"]`; require five eligible checks and one disabled tracked row. Deselect all -> disabled `Import 0 repositories`; Select all -> deselect `playground`.
- **Search/cancel:** type `website` into `.repository-import-tools input`; require two rows and four total selections. Cancel -> two original stored repositories, no imports.
- **Clear search:** compare the clear SVG and button centers at rest and under native mouse hover, with a 0.5px tolerance. Retain `search-clear-alignment.json` and `05b-search-clear-hover.png`. Clicking clear must restore all six review rows, preserve four selected repositories, and return focus to the input before Cancel.
- **Confirm:** reopen, deselect `playground`, click `Import 4 repositories`; wait for completion. Require five stored repositories total, `archived-tools` active, and no `playground`. Verify the independent post-exit SQLite result in `persisted-repositories.json`.
- **Other picker entries:** choose the single `playground` folder -> `Import 1 repository`; Escape -> Settings. Choose a missing folder -> error -> `Back to Settings`.
- **Motion/layout:** no horizontal overflow at 390/768/1024/1440px. Reduced-motion recovery must suppress the loading loop; cancel after scan success must remain in Settings beyond the delayed results transition.
- **Proof:** require zero exit and `run.json.passed`, `cleanup.removed`, numbered screenshots, action transcript, and retained database query results.

## Gotchas

The native picker is automated; filesystem discovery, Git inspection, IPC, renderer, and SQLite are real. The harness intentionally delays I/O to capture progress, so its runtime is not an import-performance benchmark. Two repositories are established through application commands before the user journey; count assertions account for these fixtures. A successful final screenshot alone does not prove cancellation or persistence.

## Automatic GitHub activity

Run `pnpm verify github-import` after a build. With periodic refresh disabled, import a real disposable repository before GitHub sign-in, require its GitHub remote to be selected with zero disconnected API reads, then authorize through the real device-flow UI against a simulated provider. PRs and reviews must load without opening repository configuration. Import a second repository while connected; its fork's named upstream must be selected automatically. A simulated GitHub 500 leaves the first source healthy; Activity sources > Retry recovers the second source. Require both repositories' local commits, PRs and reviews in the hub and after reload. An explicit Local only preference is applied through repository IPC to verify that later refresh does not fetch that source; this step does not claim Settings form interaction coverage. The runner independently queries persisted sources and activity after exit. Retain actions, HTTP paths, screenshots, SQLite evidence, exit status and cleanup. No live GitHub account or external write is used.
