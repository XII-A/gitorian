# Crash recovery

Use `pnpm build`, then `pnpm test:e2e crash-recovery startup-recovery`. The shared fixture owns disposable profiles, native process cleanup, screenshots, traces and source identity. No personal journal or provider credentials are used.

## User entry points

- After an unexpected exit, open the app: Recovery mode pauses automatic acquisition, provider maintenance and updates. Local cached work and writing remain available. Continue normally explicitly restores normal admission; closing recovery without continuing keeps the paused disposition on next launch.
- Copy diagnostic report or Save report from the recovery notice, startup failure surface, or Settings > Backup > Diagnostics. Require native clipboard/export success and privacy-safe content. Copy/export share the same versioned report; raw technical error text has no separate share path.
- On Windows, an independent native dialog offers Wait, Copy diagnostic report, Save report and Restart in recovery during sustained main/renderer/storage failure and after unexpected desktop exit. The test automates only native dialog responses. Watchdog liveness, process creation, report transport and native clipboard stay real.
- Restart in recovery warns about unsaved changes, attempts the current writing checkpoint/cooperative quit, then verifies/terminates only the owned Windows process tree when necessary. The replacement must regain the original profile lease, stay in recovery and retain acknowledged writing plus any durable renderer recovery copy.

## Owning scenarios

`tests/e2e/crash-recovery.spec.ts` owns report copy/export, narrow recovery notice, explicit normal admission, independent controls while the main event loop is blocked, and product restart/persistence. Its native helper fixture uses a bounded forty-second loop solely for guaranteed cleanup. The restart scenario explicitly prepares a trace and declares the expected process termination; ordinary journeys still require zero exit. The replacement fixture records its own persisted state and exits cleanly before profile removal.

`tests/e2e/startup-recovery.spec.ts` owns failure/retry, keyboard/focus and safe diagnostic sharing for Hub/workspace. `tests/e2e/draft-recovery.spec.ts` retains the existing recovery-copy/conflict interaction. `tests/recovery-termination.test.ts` owns actual Windows process identity, descendant cleanup and watchdog-branch survival. `tests/incident-reports.test.ts` owns report projection/caps/retention and unresolved recovery disposition. Existing acquisition/history, records, ApplicationWork and database-worker scenarios own their module contracts; storage timeout must not silently reopen or replay.

Require passed run records, preserved commands/source patches/screenshots/traces, and removed owned profiles. Live recovery is Windows-specific until Linux/macOS native lifetime and packaging journeys have been verified. Native memory dumps and automatic hang profiling are deliberately not collected by this update.
