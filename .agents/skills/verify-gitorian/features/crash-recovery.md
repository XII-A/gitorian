# Crash recovery

Build and review the affected recovery path in an isolated Electron profile.

## User entry points

- After an unexpected exit, open the app: automatic acquisition, provider maintenance and updates remain paused while cached work and writing stay available. An Arc toast announces the incident once, with Copy diagnostic report below its explanation. Dismissing, copying, reloading or cleanly reopening must not announce that incident again. A new crash gets a fresh notice. The existing refresh control becomes Resume automatic refresh, which explicitly restores admission before refreshing. Reading state, copying or dismissing the toast never resumes work; closing without resuming preserves the paused disposition next launch.
- Copy diagnostic report from that toast or inside Technical details on the startup failure surface. Require native clipboard confirmation, failure/retry feedback and privacy-safe content. Startup recovery keeps Retry as its sole top-level action and has no Save control. Settings has no Diagnostics section. The independent Windows dialog retains native Copy/Save using the same report representation; raw technical error text has no separate share path.
- A storage stall changes the existing refresh control to Reopen journal. It must reopen through the diagnostic action without clearing quarantine or dispatching an ordinary refresh.
- On Windows, an independent native dialog offers Wait, Copy diagnostic report, Save report and Restart in recovery during sustained main/renderer/storage failure and after unexpected desktop exit. The test automates only native dialog responses. Watchdog liveness, process creation, report transport and native clipboard stay real.
- Restart in recovery warns about unsaved changes, attempts the current writing checkpoint/cooperative quit, then verifies/terminates only the owned Windows process tree when necessary. The replacement must regain the original profile lease, stay in recovery and retain acknowledged writing plus any durable renderer recovery copy.

## Owning scenarios

Review contextual report copy, retry after clipboard failure, narrow toast layout, keyboard refresh resumption and dismissal across reopening. Use a disposable profile for process-restart checks.

Review startup retry and keyboard focus on both Hub and workspace. Diagnostic sharing starts inside Technical details. `pnpm smoke:recovery-termination` covers actual Windows process identity, descendant cleanup and watchdog-branch survival. `tests/incident-reports.test.ts` covers report projection, caps, retention and unresolved recovery disposition.

Require passed run records, preserved commands/source patches/screenshots/traces, and removed owned profiles. Live recovery is Windows-specific until Linux/macOS native lifetime and packaging journeys have been verified. Native memory dumps and automatic hang profiling are deliberately not collected by this update.
