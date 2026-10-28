---
name: verify-gitorian
description: Verify Gitorian Electron features through real desktop journeys. Use after feature changes, for behavioral bug reproduction, or when collecting reproducible UI and persistence evidence.
---

# Verify Gitorian

Read the coverage policy in [testing](../../../docs/testing.md) and [the feature map](features/README.md), select the affected behavioral entry points, and define their observable outcomes before changing code. Visual appearance and animation timing are manual review; keep automated journeys focused on consequential behavior. The primary surface is the Electron desktop app; Git, SQLite, and integration HTTP adapters support it. A renderer-only browser preview cannot prove desktop IPC or persistence.

## Final handoff

Run `pnpm verify:release` after source changes and reviews are complete. Require its complete result to pass; focused reruns are diagnostic. The command owns check, compile and desktop sequencing and writes `.ai-docs/verification/release/<run>/run.json`. Follow [testing](../../../docs/testing.md#final-revision-verification) for checkout ownership and interrupted-run recovery.

## Launch

From the repository root, use Node >=24.16, pnpm 10.24.0, and Git on PATH:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm verify doctor
pnpm verify repository-import
```

Require each command to exit zero before continuing. Build once per application source revision; repeat after application edits. Repository import now runs Playwright Test against real Electron. Its unique evidence directory is under `.ai-docs/verification/desktop/runs/`; open the latest HTML report with `pnpm test:e2e:report`. Read [testing](../../../docs/testing.md) when adding/migrating journeys or debugging failures.

The runner creates an empty temporary profile and six real Git repositories, including duplicate project names and a nested folder. The app creates/migrates SQLite itself. The harness establishes one tracked and one stopped repository using real application commands as explicit setup; the subsequent import journey uses UI controls. No credentials or external services are needed. It automates the OS folder picker at the Electron dialog boundary and holds real filesystem/Git operations only until the journey has captured each progress state.

Ready means the compiled renderer exposes `Open settings`, real IPC returns empty repository state, both integrations are disconnected, and Electron owns the expected isolated profile. The in-process doctor must pass before fixture setup or UI actions. This recipe has no server port. Separate runs use separate profiles, repositories, and evidence directories; compilation into `out/` is shared, so serialize builds and never rebuild during an active journey. Use the artifact-backed runners for feature verification. `pnpm dev` uses a separate persistent development profile by default; `pnpm smoke:dev-launch` owns a disposable profile to verify the OAuth/desktop startup and process cleanup.

## Doctor

`pnpm verify doctor` is read-only: it checks the Electron binary and compiled entry points and reports Git revision, local diff summary, package version, Node version, and build hashes. Missing build output means run `pnpm build` first.

The live doctor in `tests/e2e/support/desktop.ts` checks profile ownership, the compiled renderer file URL, usable IPC state, and disconnected integrations; its result is `doctor.json`. If anything looks wrong, run the read-only doctor and inspect `doctor.json` plus `stderr.log` before retrying. A live failure stops the journey; never attach to an already-running personal instance.

## Drive

`pnpm verify repository-import` selects `tests/e2e/repository-import.spec.ts`; `pnpm test:e2e repository-import` runs it directly. Extend that owning scenario with Playwright locators, real input and retrying assertions. The shared desktop fixture owns isolation, launch, screenshots, trace and cleanup. Native dialog responses are automated, while filesystem discovery, Git, IPC and SQLite stay real. Other feature journeys retain their existing Electron harnesses. Use real keyboard input for writing; avoid editor setters as feature proof.

Drive all entry points listed by the affected feature map. The artifact-backed runner currently covers repository import. The other feature files identify existing desktop harnesses and their coverage gaps; their diagnostic success is not a substitute for missing evidence or entry points. Extend the relevant harness when necessary and report unmet preconditions as failures/skips with reasons.

## Evidence

For the import journey require all of these in the printed directory:

- `run.json`: reproduction command, revision, build hashes, process ID, exit code, final result and cleanup result. `source.patch` captures tracked/staged changes against that revision. Reproduce in a separate checkout of the recorded commit by applying the patch, then install, build and run the command. Stage new implementation files before capture or include them separately before claiming a dirty source tree reproducible.
- `doctor.json`: real instance identity and empty initial state.
- `actions.jsonl`: timestamped Playwright steps, locator actions, assertions, errors and recovery. `trace.zip` provides DOM snapshots and interaction diagnostics.
- Numbered PNGs: the action sequence and resulting screens; `failure.png` on caught failures.
- `imported-state.json`: the real IPC result after import.
- `persisted-repositories.json`: an independent read-only SQLite query after Electron exits, proving the selected repositories were stored, stopped tracking resumed, and excluded repositories stayed excluded.
- `stdout.log` and `stderr.log`: process diagnostics. A crash can leave partial evidence; require the Playwright test to pass, `run.json.passed === true`, zero exit, and `cleanup.removed === true` for success. Other legacy verification modes still produce `journey.json`.

Exercise the real user path and verify side effects alongside visible results. Setup commands are fixtures, not proof of the UI action. Mock only at existing production boundaries; label sample-mode publishing and fake integration responses as simulations. Local verification does not authorize publishing, OAuth browser authorization, or messages. For changes to external integrations, inspect the recorded HTTP method/body and resulting local state using existing isolated transport fixtures; live external claims require an explicitly authorized test destination.

## Cleanup

The desktop fixture closes Electron, permits the scenario's independent SQLite query, then removes only its owned temporary directory. Playwright bounds the journey and the fixture bounds shutdown, terminating only its own process tree by PID if needed. Legacy runners retain their 90-second timeout (150 seconds for combined connections). Never kill by process name.

Inspect the printed `run.json` after every run, including failures. Require `cleanup.removed` to be true, then confirm the numbered PNGs, `actions.jsonl`, and `run.json` still exist. If the host interrupts the runner, use its recorded PID and absolute scratch path to confirm ownership and terminate that process tree before removing that exact scratch directory. Preserve the evidence directory. Standalone legacy smoke scripts may leave locked temporary profiles; check their cleanup before claiming completion.

## Helpers

- `pnpm verify onboarding` drives the [onboarding journey](features/onboarding.md), sharing simulated provider boundaries with the connection fixture and importing one real disposable Git repository.
- `pnpm verify onboarding-disclosure` checks [disclosure text stability](features/onboarding.md#disclosure-text-stability) in an empty journal-only profile.

- `pnpm verify doctor` runs the read-only build check in `tools/verify.mjs`.
- `pnpm verify repository-import` runs launch, live doctor, drive, evidence, persistence check, and cleanup in one command.
- `pnpm verify connections` drives the [connections journey](features/connections.md) using the provider-account Electron journey followed by the Notion journey, with disposable profiles and simulated provider HTTP/browser boundaries.
- Other existing harness commands and concrete entry points are indexed in [features/README.md](features/README.md).

Maintain the map with the app: update changed selectors, entry points, preconditions, and outcomes; rerun affected journeys and retain their evidence. A feature is verified only when every claimed entry point has an observed result.
