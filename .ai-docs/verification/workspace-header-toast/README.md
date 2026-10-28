# Workspace header toast verification

Command: `pnpm test:e2e workspace-errors` after `pnpm build` and `pnpm verify doctor`.

Passed in 11 seconds. Disposable real Git repository imported through application IPC setup; real renderer, preload, SQLite and Git. Fixture rejects the selected command at Electron handler registration. User clicks Refresh activity, sees the concise toast without a header banner, retries a repeated rejection, removes the injected failure, then retries successfully. Inspector diff rejection remains inline. A view rejection uses Retry action and recovers without invoking refresh. No credentials or publishing.

Retained run: `.ai-docs/verification/desktop/runs/1793193988772-203e5b16/workspace-errors-workspace-5b6ff-ejection-and-toast-recovery/`. Includes source.patch, fixture.json, doctor.json, actions.jsonl, trace.zip, screenshots and run.json. `passed: true`, `exit: 0`, `cleanup.removed: true`.

Build, typecheck, lint and format check pass. Initial `pnpm check`: 444/446 tests passed, two acquisition timing failures under concurrent machine load. `pnpm test --maxWorkers=2`: 445/446 passed, remaining week-loading timing failure. `pnpm test tests/week-loading.test.ts --maxWorkers=1`: all 3 passed. Full suite was not entirely green in a single run.

Arc review: existing ToastStack with documented action/update API; no CSS changes. Calm sentence-case copy, verb-first recovery, no diagnostics. Inline-error guidance overridden by the explicit toast request. No actionable writing findings after source review. Approve.
