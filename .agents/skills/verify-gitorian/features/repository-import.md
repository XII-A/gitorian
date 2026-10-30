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
- **Branding:** the live doctor requires the document title and visible window title to read `Gitorian`; the runner independently reads `journal.sqlite` after exit.
- **Appearance:** launch with Electron's platform theme set to light, then switch dark and back to light. Require the app theme and computed color scheme to remain dark; retain `00-dark-theme-light-platform.png`. This is process-local platform emulation and does not change the user's OS settings.
- **Select:** `.repository-import-row [role="checkbox"]`; require five eligible checks and one disabled tracked row. Deselect all -> disabled `Import 0 repositories`; Select all -> deselect `playground`.
- **Search/cancel:** type `website` into `.repository-import-tools input`; require two rows and four total selections. Cancel -> two original stored repositories, no imports.
- **Clear search:** compare the clear SVG and button centers at rest and under native mouse hover, with a 0.5px tolerance. Retain `search-clear-alignment.json` and `05b-search-clear-hover.png`. Clicking clear must restore all six review rows, preserve four selected repositories, and return focus to the input before Cancel.
- **Confirm:** reopen, deselect `playground`, click `Import 4 repositories`; wait for completion. Require five stored repositories total, `archived-tools` active, and no `playground`. Verify the independent post-exit SQLite result in `persisted-repositories.json`.
- **Other picker entries:** choose the single `playground` folder -> `Import 1 repository`; Escape -> Settings. Choose a missing folder -> error -> `Back to Settings`.
- **Motion/layout:** no horizontal overflow at 390/768/1024/1440px. Reduced-motion recovery must suppress the loading loop; cancel after scan success must remain in Settings beyond the delayed results transition.
- **Proof:** require zero exit and `run.json.passed`, `cleanup.removed`, numbered screenshots, action transcript, and retained database query results.

## Gotchas

The native picker is automated; filesystem discovery, Git inspection, IPC, renderer, and SQLite are real. The process-local entry `tests/e2e/support/import-main.mjs` holds directory reads or Git execution only while the journey captures progress. Arm with `app.emit('gitorian-e2e-hold-io', 'discovery' | 'inspection')` through Electron evaluation before the relevant action; release with `app.emit('gitorian-e2e-release-io')` after the loading assertion/screenshot. Quit also releases pending I/O. No blanket per-command delay or large empty-directory fixture is needed. Runtime includes these controlled holds and is not an import-performance benchmark. Two repositories are established through application commands before the user journey; count assertions account for these fixtures. The stopped repository is selected by its canonical path using `fs.promises.realpath`, matching real Git inspection. On Windows its lookup input deliberately uses uppercase `ARCHIVED-TOOLS` to cover aliases; ordinary `realpathSync` preserves that casing and is insufficient. A successful final screenshot alone does not prove cancellation or persistence.

## Provider accounts and automatic activity

Run `pnpm test:e2e provider-accounts` after a build, or use the retained `pnpm verify github-import` alias. The provider journey owns account matching, ambiguous public access, multiple identities, GitLab contribution acquisition, original-provider details, citations and account persistence. Read [connections](connections.md) for entry points, fixture boundaries and required evidence. Repository discovery/import mechanics stay with `repository-import.spec.ts`; provider protocol and scheduling behavior stay with their module-interface scenarios. Do not duplicate these journeys in the retired GitHub-only harness.

## Acquisition performance and stop

After import/acquisition changes, run the owning desktop journey above plus `tests/acquisition.test.ts`, `tests/git.test.ts`, `tests/http.test.ts` and `tests/week-history.test.ts`. Stop prevents new native Git admission and aborts owned Git processes; successfully committed work remains. Discovery returns explicit partial results after its directory/result/time budget and requests a narrower folder. Provider activity is tested through isolated transport adapters, not live account quota.

For performance measurements, opt in with `$env:GITORIAN_IMPORT_STRESS='1'; pnpm test tests/import-stress.test.ts` in PowerShell, then remove that environment variable. This uses real disposable Git/SQLite and synthetic provider responses. Each run saves evidence under `.ai-docs/verification/import-stress/runs/`. Compare registration, extraction, persistence and unchanged refresh separately; assert all 10,000 activities retain all 50 branch memberships before accepting timings. The provider numbers are per-turn ceilings, not total cold-discovery request savings.
