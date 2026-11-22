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

Build and run Electron with a disposable profile and fixture Git repositories.

Use a parent directory with multiple projects, including duplicate project names, one tracked repository and one stopped repository.

- **Open:** select Open settings, Repositories and Add repositories from folder.
- **Select:** check that tracked repositories are disabled and that deselecting all disables import.
- **Search/cancel:** narrow the list, change the selection and cancel. Reopen Settings and verify that tracking was unchanged.
- **Clear search:** verify that clearing the query restores the list, selection and input focus.
- **Confirm:** import only the selected repositories, then reopen the profile. Confirm that stopped tracking resumes and excluded repositories remain absent.
- **Other picker entries:** choose a single repository, then cancel with Escape. Check recovery from an unavailable folder.
- **Layout:** check narrow layouts and reduced motion when changing the review or progress UI.

## Provider accounts and automatic activity

See [connections](connections.md) for provider account assignment and contribution acquisition.

## Acquisition performance and stop

After import/acquisition changes, review the desktop import path above and run `tests/acquisition.test.ts`, `tests/git.test.ts`, `tests/http.test.ts` and `tests/week-history.test.ts`. `tests/week-history.test.ts` also owns startup recovery when an unfinished cursor already covers the requested week: acquisition must settle without repeatedly scheduling skipped batches, while retaining the cursor for future work. Stop prevents new native Git admission and aborts owned Git processes; successfully committed work remains. Discovery returns explicit partial results after its directory/result/time budget and requests a narrower folder. Provider activity is tested through isolated transport adapters, not live account quota.

Run `pnpm smoke:import-stress` for the Git import benchmark. It uses disposable Git and SQLite fixtures and saves timings under `.ai-docs/verification/import-stress/runs/`. To include the separate provider request-budget tests, set `GITORIAN_IMPORT_STRESS=1` and run `pnpm test tests/import-stress.test.ts`.
