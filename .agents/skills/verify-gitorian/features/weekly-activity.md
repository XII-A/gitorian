# Weekly activity

Review the selected week's work, load older history, and recover failed sources without hiding healthy repositories.

## Sub-features

- `activity.week`: selecting an earlier week loads its real Git commits.
- `activity.empty`: a completed empty manual refresh explains that no activity was found.
- `activity.recovery`: only failed sources appear; Retry clears recovered warnings.

## How to get to it (user POV)

The Journal hub opens at the current week. Use its Week picker and presets to navigate; Refresh activity updates the selection. The writing workspace also has a date picker and Refresh activity. Activity sources opens when a source fails.

## Driving it with Electron

Preconditions: `pnpm build`; for the existing diagnostic journey use `pnpm smoke:week-history` with Electron's desktop environment enabled. `tools/week-history-smoke.mjs` creates five disposable real Git repositories with commits authored two weeks ago, then imports them through application commands.

- **Current hub:** click `[aria-label="Refresh activity"]`; require the notification viewport to show `No activity found` and no healthy `Activity sources` control.
- **Earlier week:** click `[aria-label^="Week:"]`, choose `2 weeks ago` within `[aria-label="Presets"]`, then `Apply`; require five `.hub-activity` rows.
- **Failure/recovery:** the harness renames one fixture folder, refreshes, opens `[aria-label="Activity sources"]`, requires exactly that failed project, restores the folder, and clicks `Retry`. Require the dialog and warning control to disappear.
- **Evidence:** retain the command, transcript, measured history-load time, screenshots before/after navigation and recovery, and a read-only stored-state check. Add the capture calls to this existing harness before claiming artifact-backed proof.
- **Workspace entry:** repeat date navigation from the writing workspace and verify its visible activity matches the selected week. The existing week-history diagnostic drives only the hub; report the workspace path as uncovered until exercised.

## Gotchas

Fixture dates are relative to the run date. Import is setup, not UI-import proof. This diagnostic does not retain screenshots or independently reopen SQLite today. Timezone/DST cases are protected by existing behavior tests; preserve those until equivalent real journeys exist. An unavailable fixture is an intentional failure, not permission to point at a personal repository.
