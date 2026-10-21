---
name: verify-weekly-j
description: Verify weekly-j Electron features through real desktop journeys. Use after feature changes, for behavioral bug reproduction, or when collecting reproducible UI and persistence evidence.
---

# Verify weekly-j

Read [the feature map](features/README.md), select the affected entry points, and define their observable outcomes before changing code. The primary surface is the Electron desktop app; Git, SQLite, and integration HTTP adapters support it. A renderer-only browser preview cannot prove desktop IPC or persistence.

## Launch

From the repository root, use Node >=22.19, pnpm 10.24.0, and Git on PATH:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm verify doctor
pnpm verify repository-import
```

Require each command to exit zero before continuing. Build once per source revision; repeat after application edits. The verification command starts the compiled app, drives the journey, and exits automatically. It prints a unique evidence directory under `.ai-docs/verification/repository-import-*/`.

The runner creates an empty temporary profile and six real Git repositories, including duplicate project names and a nested folder. The app creates/migrates SQLite itself. The harness establishes one tracked and one stopped repository using real application commands as explicit setup; the subsequent import journey uses UI controls. No credentials or external services are needed. It automates the OS folder picker at the Electron dialog boundary and slows real filesystem/Git operations to observe progress.

Ready means the compiled renderer exposes `Open settings`, real IPC returns empty repository state, both integrations are disconnected, and Electron owns the expected isolated profile. The in-process doctor must pass before fixture setup or UI actions. This recipe has no server port. Separate runs use separate profiles, repositories, and evidence directories; compilation into `out/` is shared, so serialize builds and never rebuild during an active journey. Avoid `pnpm dev` for verification: it uses the personal application profile by default.

## Doctor

`pnpm verify doctor` is read-only: it checks the Electron binary and compiled entry points and reports Git revision, local diff summary, package version, Node version, and build hashes. Missing build output means run `pnpm build` first.

The live doctor in `tools/repository-import-smoke.mjs` checks profile ownership, the compiled renderer file URL, usable IPC state, and disconnected integrations; its result is `doctor.json`. If anything looks wrong, run the read-only doctor and inspect `doctor.json` plus `stderr.log` before retrying. A live failure stops the journey; never attach to an already-running personal instance.

## Drive

`pnpm verify repository-import` wraps the existing Electron harness in `tools/repository-import-smoke.mjs`. Its native `webContents.executeJavaScript` actions use real selectors such as `[aria-label="Open settings"]`, `.repository-import-row [role="checkbox"]`, the `Add repositories from folder` button, and `Import 4 repositories`. Reuse its bounded `wait`, `click`, `assert`, and `shot` helpers when extending this path. Use `webContents.insertText` or real keyboard input for writing; avoid editor setters as feature proof.

Drive all entry points listed by the affected feature map. The artifact-backed runner currently covers repository import. The other feature files identify existing desktop harnesses and their coverage gaps; their diagnostic success is not a substitute for missing evidence or entry points. Extend the relevant harness when necessary and report unmet preconditions as failures/skips with reasons.

## Evidence

For the import journey require all of these in the printed directory:

- `run.json`: reproduction command, revision, build hashes, process ID, exit status, final result, cleanup result, and evidence-survival check. `source.patch` captures tracked application/harness changes against that revision; `verify-runner.mjs` captures the runner itself. Reproduce in a separate checkout of the recorded commit by applying the patch and copying that runner into `tools/verify.mjs`, then install, build, and run the same command. Include any additional untracked application files yourself before claiming a dirty source tree reproducible.
- `doctor.json`: real instance identity and empty initial state.
- `actions.jsonl`: timestamped executed actions/waits and screenshot-associated visible text, including cancellation, selection changes, errors, and recovery.
- Numbered PNGs: the action sequence and resulting screens; `failure.png` on caught failures.
- `imported-state.json`: the real IPC result after import.
- `persisted-repositories.json`: an independent read-only SQLite query after Electron exits, proving the selected repositories were stored, stopped tracking resumed, and excluded repositories stayed excluded.
- `journey.json`, `stdout.log`, and `stderr.log`: journey outcome and diagnostics. A crash can leave partial evidence; require `run.json.passed === true`, zero exit, and `cleanup.removed === true` for success.

Exercise the real user path and verify side effects alongside visible results. Setup commands are fixtures, not proof of the UI action. Mock only at existing production boundaries; label sample-mode publishing and fake integration responses as simulations. Local verification does not authorize publishing, OAuth browser authorization, or messages. For changes to external integrations, inspect the recorded HTTP method/body and resulting local state using existing isolated transport fixtures; live external claims require an explicitly authorized test destination.

## Cleanup

The runner waits for its Electron process to close, independently reads SQLite, then removes only the temporary directory it created. On its 90-second timeout it terminates its own process tree on Windows by PID. It restores neither personal state nor unrelated processes because it never uses them. Never kill by process name.

Inspect the printed `run.json` after every run, including failures. Require `cleanup.removed` to be true, then confirm the numbered PNGs, `actions.jsonl`, and `run.json` still exist. If the host interrupts the runner, use its recorded PID and absolute scratch path to confirm ownership and terminate that process tree before removing that exact scratch directory. Preserve the evidence directory. Standalone legacy smoke scripts may leave locked temporary profiles; check their cleanup before claiming completion.

## Helpers

- `pnpm verify doctor` runs the read-only build check in `tools/verify.mjs`.
- `pnpm verify repository-import` runs launch, live doctor, drive, evidence, persistence check, and cleanup in one command.
- `pnpm verify connections` drives the [connections journey](features/connections.md) using a journal-only disposable profile and simulated GitHub HTTP/browser boundaries.
- Other existing harness commands and concrete entry points are indexed in [features/README.md](features/README.md).

Maintain the map with the app: update changed selectors, entry points, preconditions, and outcomes; rerun affected journeys and retain their evidence. A feature is verified only when every claimed entry point has an observed result.
