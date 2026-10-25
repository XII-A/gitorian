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

Run `pnpm verify activity-counts` after a build to verify hub count updates through real Git refresh and IPC. It imports a disposable one-commit repository, adds nine commits, refreshes, requires 10 rows and counts, and checks that chip and summary labels stay mounted. The summary uses the same inline Arc counter as the chips. Require `summary-counter-motion.json` to show moving digits in both regions, stationary labels and inherited summary typography, plus final summary values 10 commits, 0 PRs/reviews, 1 repository and 1 active day. Repeat with `GITORIAN_VERIFY_MOTION=stress` and require no moving digit frames in either region. The evidence directory retains actions, a screenshot, exit status, and cleanup results.

Fixture dates are relative to the run date. Import is setup, not UI-import proof. This diagnostic does not retain screenshots or independently reopen SQLite today. Timezone/DST cases are protected by existing behavior tests; preserve those until equivalent real journeys exist. An unavailable fixture is an intentional failure, not permission to point at a personal repository.

## Workspace filter toolbar

Run `pnpm verify activity-filters` (also `pnpm smoke:activity-filters`) after a build for workspace toolbar wrapping. This journal-only sample journey checks project/history alignment and bounds at 280px, 320px and either side of the full-row threshold, both idle and after loading `feat/offline-queue` through the history dialog. Clearing must preserve a stable first-row position with no delayed wrap. The active branch keeps its full accessible name and title while its visible label is bounded. The project menu must remain reachable beyond the group and support selection/reset. The artifact-backed runner retains the geometry observations, resulting screenshot, exit status and cleanup. Sample history proves layout and control behavior, not Git acquisition or persistence.
