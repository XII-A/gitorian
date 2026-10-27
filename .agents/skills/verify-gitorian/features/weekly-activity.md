# Weekly activity

Review the selected week's work, load older history, and recover failed sources without hiding healthy repositories.

## Acquisition ownership

`ActivityAcquisition` owns Effect coalescing, source serialization and FIFO batch admission. Preserve the existing acquisition and week-history behavior tests: five projects must each receive a first batch before a large project continues; an explicit retry queues behind active acquisition and duplicate retries share work. Run `pnpm verify github-import` and `pnpm verify repository-import` for desktop source failure/retry, import-triggered refresh and durable state. User pause remains a persisted checkpoint decision; it does not discard completed batches or imply that an already running external request was aborted.

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

Run `pnpm verify activity-counts` after a build to verify hub count updates through real Git refresh and IPC. It imports a disposable one-commit repository, adds nine commits, refreshes, requires five preview rows with a Show 5 more node and weekly counts of 10, and checks that chip and summary labels stay mounted. The summary uses the same inline Arc counter as the chips. Require `summary-counter-motion.json` to show moving digits in both regions, stationary labels and inherited summary typography, plus final summary values 10 commits, 0 PRs/reviews, 1 repository and 1 active day. Repeat with `GITORIAN_VERIFY_MOTION=stress` and require no moving digit frames in either region. The evidence directory retains actions, a screenshot, exit status, and cleanup results.

Fixture dates are relative to the run date. Import is setup, not UI-import proof. This diagnostic does not retain screenshots or independently reopen SQLite today. Timezone/DST cases are protected by existing behavior tests; preserve those until equivalent real journeys exist. An unavailable fixture is an intentional failure, not permission to point at a personal repository.

## Workspace filter toolbar

Run `pnpm verify activity-filters` (also `pnpm smoke:activity-filters`) after a build. The journal-only sample journey requires one row and constant toolbar height at 280px, 320px, 480px and 760px, both idle and after loading `feat/offline-queue`. At the start, only the right arrow exists; in the middle, both exist; at the end, only the left exists. Both arrows must share the chip row center, live outside the scrollbar track, and remain pointer-reachable with the scrollbar hidden in both the Hub and workspace. A removed focused arrow hands focus to the scroll region. Record viewport left/width and normalized chip origin through start, middle and end states; arrow visibility must change none of them by more than one CSS pixel. The scrollbar must remain hidden at rest and after unhovered scrolling. A real mouse hover reveals it; leaving hides it again. Edge scrims keep chip text clear of the overlaid arrows, and the wider fade reaches beyond chip padding. The wide row must fit without overflow controls. The right arrow scrolls, focus reveals the history chip, long branch labels truncate to one line while retaining the full accessible name and title, clearing history retains row height, and vertical wheel input is not captured. Project search/select/reset must escape the scroll clip, remain pointer-reachable, and return focus. Native keyboard checks cover opening Day, Escape, Tab to Projects, project search, selection and reset. Retain geometry observations, resulting screenshot, exit status and cleanup. Sample history proves UI behavior, not Git acquisition or durable journal writes. `activity-days` also checks narrow-row layout and a clickable portaled Day menu in both the real Hub and workspace entry points.

## Day navigation and timeline disclosure

Run `pnpm verify activity-days` after a build. The disposable real Git fixture contains 120 Monday commits, five Tuesday commits and seven Sunday commits in the previous week. Both the hub and workspace are owning entry points for this journey.

- All days initially shows five records per day, weekday/date headings without daily totals, and an ellipsis timeline node only where more records exist. Show more reveals the remaining records in place; Show fewer closes only that day.
- The Activity day picker offers All days and all seven dated weekdays. Sunday shows all seven records without disclosure. Returning to All days preserves expanded days. Thursday is empty and Show all days restores the overview. Week changes reset day selection and expansion.
- Day precedes Projects in both toolbars. Hub filters share one compact gap, with no automatic spacer before Projects.
- Hover between preview rows during the first expansion and collapse of the seven-record day. Require `hub-disclosure-hover.json` and `workspace-disclosure-hover.json` to show at least three intermediate highlight positions in each direction; list resize notifications must not snap a running row-hover spring to its destination.
- Pointer disclosure reverses from its current height. The recorded intermediate heights must demonstrate movement. Close a 120-row day from its visible trailing button using real pointer input. Require `hub-collapse-motion.json` and `workspace-collapse-motion.json` to keep panel height and returning scroll synchronized within two CSS pixels, including the first and last frames; this catches both competing scroll springs and transient auto-height measurement collapse. Keyboard activation retains visible focus; closed content is inert. Reduced motion removes height travel.
- Weekly summary counts remain unchanged by day selection. Existing repository, history, type, inspector and citation behavior remains available. The configured journal timezone owns day boundaries.
- Retain `actions.jsonl`, hub/workspace preview screenshots, `activity-days.png`, `journey.json` and `run.json` with successful exit and cleanup. This fixture proves real Git acquisition and desktop interaction; no external integration is used.
