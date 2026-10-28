# Testing

Choose the smallest existing scenario that proves the behavior. Prefer real Electron journeys for desktop features; Vitest covers domain/storage behavior and DOM interactions that do not require a desktop. Define observable outcomes before implementation and give overlapping behavior one owning scenario.

## Run and debug

Use the Node/pnpm versions in `package.json`, install with `pnpm install --frozen-lockfile`, then:

```sh
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

To reproduce a shard, run `pnpm build`, then `pnpm test:e2e --shard=1/2` or `pnpm test:e2e --shard=2/2`. Run these sequentially on a shared desktop: disposable profiles do not isolate the native clipboard or window focus. CI parallelism relies on separate machines, not extra Playwright workers. Keep focused journeys during iteration and the required `pnpm check` before handoff.

## Author a desktop journey

Import `test` and `expect` from `tests/e2e/support/desktop`. Request its `desktop` fixture, then use standard Playwright locators and assertions on `desktop.page`. Group meaningful phases with `test.step`; use accessible names for interactions and CSS selectors only where the assertion concerns layout or motion.

The fixture owns a disposable profile and scratch directory, the Electron process, clean launch environment, startup identity checks, logs, trace, failure screenshot and cleanup. Its interface provides `page`, `app`, `scratch`, `profile`, `chooseFolder(path, delay?)`, `shot(name)` and `close()`. The default entry is the compiled application. Use the `desktopEntry` test option only for process-local setup that must precede main-module loading; repository import holds real I/O until progress assertions and screenshots finish, then releases it. Keep feature fixtures and expected outcomes beside the scenario, rather than adding feature switches to the shared fixture.

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
