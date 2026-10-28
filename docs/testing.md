# Testing

For scenario selection, coverage, isolation, and handoff requirements, follow [coding standards](../CODING_STANDARDS.md).

## Run and debug

Use the Node/pnpm versions in `package.json`, install with `pnpm install --frozen-lockfile`, then:

```sh
pnpm verify:release                       # Final check, compile, all desktop journeys, one result
pnpm test tests/settings-rendering.test.ts   # Focused Vitest scenario
pnpm build                                 # Compile before desktop tests
pnpm test:e2e                               # All migrated desktop journeys
pnpm test:e2e repository-import             # One journey
pnpm test:e2e --last-failed                  # Rerun the previous failures
pnpm test:e2e repository-import --debug     # Playwright Inspector
pnpm test:e2e:report                        # Latest HTML report
pnpm check                                 # Required static checks and Vitest suite
```

`pnpm verify repository-import` and `pnpm smoke:repository-import` select the same Playwright scenario. Other `pnpm verify` modes retain their existing harnesses; consult the [feature map](../.agents/skills/verify-gitorian/features/README.md) for native-window, integration, writing, installer and performance coverage. Those specialized tools still serve a purpose.

Windows CI runs only for pull requests targeting `main`, `release`, or a branch under `release/`. PRs targeting feature branches and direct pushes do not trigger this workflow. Opening, updating commits, reopening or editing an eligible PR triggers CI; edits include retargeting a previously skipped PR to an eligible branch. Static checks and Vitest run alongside two desktop shards on separate Windows runners. Each shard compiles once, runs its share of the full migrated desktop suite with one worker, and uploads independently named desktop evidence even on failure. Matrix fail-fast is disabled so a failed shard does not cancel its sibling's evidence. The required `CI checks` gate succeeds only when checks and every desktop shard succeed; failed, cancelled or skipped lanes fail the gate.

`pnpm build` retains typechecking for local and packaging callers. `pnpm build:compile` owns compilation without typechecking; CI uses it because `pnpm check` already owns the independently required typecheck. Do not use compilation success as proof of type safety. Electron is already installed by the project: a separate Playwright browser download is unnecessary for this suite. Electron automation is experimental; verify dependency upgrades against the real journey.

To reproduce a shard, run `pnpm build`, then `pnpm test:e2e --shard=1/2` or `pnpm test:e2e --shard=2/2`. Run these sequentially on a shared desktop: disposable profiles do not isolate the native clipboard or window focus. CI parallelism relies on separate machines, not extra Playwright workers. Keep focused journeys during iteration; use `pnpm verify:release` for the final handoff.

## Final-revision verification

`pnpm verify:release` owns a sequential check, compile, then desktop run. It sets `CI=1` for child commands so focused `.only` declarations fail, stops at the first failure and records source identity, commands, stage start/end times and exit status in `.ai-docs/verification/release/<run>/run.json`. Source identity includes HEAD and all tracked/nonignored untracked file contents; edits between stages fail verification even without a commit change. Stage new files before desktop evidence capture so the source patch is reproducible. A focused rerun is diagnostic; a final handoff requires a complete green run on the final source. Source edits after a green run require verification again.

The canonical `pnpm build`, `pnpm build:compile`, `pnpm test:e2e`, migrated `pnpm verify` journeys and `pnpm verify:release` share one checkout lock. Concurrent commands fail promptly before starting work. The lock reports owner PID/command; after interruption, verify that the owner and its children exited before removing the exact `.ai-docs/verification/checkout.lock` directory. Hard process-tree termination deliberately leaves ownership for inspection. No automatic stale-lock stealing or retries.

This lock covers the canonical compiled build/automated desktop path. `pnpm dev`, direct tool/compiler/Playwright invocation, packaging beyond its build, and specialized legacy/native/profiling tools are exclusive manual work: stop them before release verification. CI shards use separate checkouts/machines, so their locks are independent. Do not bypass a busy lock with a raw command.

## Coverage ownership

- `tests/e2e/mermaid.spec.ts`: PR descriptions across hub/workspace/reference Details, exact source, syntax recovery and inert untrusted diagrams. Seed synthetic activity through `seedJournal` before launch; it owns the backup-format detail.
- Other desktop journeys own durable writing, recovery conflicts, clipboard, selection/editing, code blocks, checklist editing, history, actionable command/save errors and repository import. Keep these behavioral contracts even when their UI is visually reviewed.
- `tests/git.test.ts` owns native full-page Git parsing/resumption. `tests/week-loading.test.ts` uses a small gated index adapter with real stores to prove partial activity and loading completion; `tests/week-history.test.ts` owns acquisition scheduling.
- Native store, HTTP, publishing and provider tests retain distinct failure/recovery coverage. A passing isolated rerun does not establish that a failed scenario is flaky.
- Header sky/render-rate, connector style-call/geometry and departing-month animation assertions were removed as manual appearance checks. Dedicated history/date-range motion smoke tools were removed too; functional history/date navigation retains its owning tests.

When changing persistence or a fixture interface, run the existing owning fixture/journey through its shared module. Keep schema/format knowledge with the production or existing seeding module rather than duplicating literal backup payloads across journeys.

## Author a desktop journey

Import `test` and `expect` from `tests/e2e/support/desktop`. Request its `desktop` fixture, then use standard Playwright locators and assertions on `desktop.page`. Group meaningful phases with `test.step`; use accessible names for interactions and CSS selectors only when a consequential outcome has no accessible interface.

The fixture owns a disposable profile and scratch directory, the Electron process, clean launch environment, startup identity checks, logs, trace, failure screenshot and cleanup. Its interface provides `page`, `app`, `scratch`, `profile`, `chooseFolder(path, delay?)`, `shot(name)` and `close()`. The default entry is the compiled application. Prelaunch seeded fixtures declare exact `desktopRepositoryIds`; the doctor verifies those IDs (empty by default) alongside profile ownership and disconnected providers. Use the `desktopEntry` test option only for process-local setup that must precede main-module loading; repository import holds real I/O until progress assertions and screenshots finish, then releases it. Keep feature fixtures and expected outcomes beside the scenario, rather than adding feature switches to the shared fixture.

Override external dependencies at existing seams. `chooseFolder` replaces Electron's native picker response; discovery, Git, IPC and SQLite stay real. Setup through application commands is fixture preparation, not UI proof. Type/click through Playwright for user actions. Use `desktop.close()` before independent read-only SQLite checks; the profile remains available until fixture teardown. Close all query handles before cleanup. Use journal-only fixtures unless repository behavior is under test. External publishing still needs explicit authorization.

Every run has a unique directory under `.ai-docs/verification/desktop/runs/`; reruns preserve prior evidence. The HTML report is replaced with the latest run. Failure selection is stored separately in `.ai-docs/verification/desktop/.last-run.json`, so `--last-failed` works across runs; `PLAYWRIGHT_LAST_RUN_OUTPUT_FILE` can override that location. Each scenario retains:

- `run.json`: reproduction command, title, build identity/hashes, Git revision, owned paths/PID, exit code, final result and cleanup status.
- `source.patch`: tracked/staged changes against that revision. Stage new implementation files before recording a dirty-tree reproduction; otherwise include them separately.
- `doctor.json`, stdout/stderr logs, named screenshots, `trace.zip` and `actions.jsonl` (Playwright steps, locator actions, assertions and errors).
- Feature evidence such as `fixture.json`, `imported-state.json`, icon alignment measurements and the independent `persisted-repositories.json` query.

Success requires a passed test, clean Electron exit, `run.json.passed === true` and `cleanup.removed === true`. On failure, inspect `failure.png`, the HTML report and trace (`pnpm exec playwright show-trace <path-to-trace.zip>`). Launch or trace-export failure may leave no page/trace, so inspect `run.json` and the runner error. The shutdown deadline covers both trace export and Electron close; either failure terminates a surviving owned process before profile cleanup. If interrupted, inspect the recorded PID and scratch path, stop only that owned process tree, remove only that exact scratch directory, and retain evidence.

## React and domain tests

Keep Vitest for existing logic, Git, HTTP and storage tests. For DOM interaction scenarios, use a happy-dom environment with React Testing Library's `render`, `screen`, explicit `afterEach(cleanup)`, and `userEvent.setup()`. Import `@testing-library/jest-dom/vitest` for readable DOM assertions. See `tests/settings-rendering.test.ts` for an example. Explicit cleanup matters because Vitest globals are disabled.

Assert visible behavior and retained edits rather than DOM object identity. Retain focused editor-engine tests where direct Tiptap commands are the intended interface. Simulated DOM tests cannot prove native input, layout, paint, motion timing, preload IPC or desktop persistence; keep those outcomes in their owning desktop journey.

## Migrate remaining tools

Move one behavior-owning journey at a time into `tests/e2e/*.spec.ts`, preserve its distinct outcomes, update its feature recipe and remove the replaced harness in the same change. Retain old command names only as thin routing to that single owner. Keep launch/development/icon utilities in `tools/`; native OS, installed-update and profiling tools remain until a replacement proves their specialized outcomes. Avoid adding a generic interaction wrapper around Playwright or duplicating the journey in Vitest.
