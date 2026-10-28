# Inspecting changes

Open activity details, review changed files and diffs, and move a read-only reference window back into the writing workspace.

## Sub-features

- `inspect.hub`: activity opens details; cached reopening avoids a loading flash.
- `inspect.mermaid`: explicitly tagged Mermaid fences render in hub, workspace and detached reference Details. Diagram/Source uses Arc keyboard selection; source copies exactly through preload. The icon-only Diagram actions toolbar provides size and copy actions, tooltips, arrow-key focus and in-place copy confirmation. Invalid, empty and oversized input keeps source accessible. Theme changes regenerate inert SVG images; actual size scrolls inside the block. Run `pnpm test:e2e mermaid` after a build. The owning journal-only journey imports synthetic PR metadata through the real backup boundary, checks surrounding Markdown, dark/light and neutral/blue accents, reduced motion, 390/768/1024/1440 widths, pop-out/dock and unchanged Markdown in SQLite after reload. Retain its fixture, screenshots, actions, persisted activity and `run.json`; require passed, zero exit and cleanup removed. This proves local rendering, not live GitHub acquisition.
- `inspect.files`: file filtering retains correct results and usable scroll position.
- `inspect.reference`: pop-out and dock preserve the selected activity and citation destination.
- `inspect.reference-tabs`: Details is first and opens by default in the workspace and native reference window. Details, Diff, and Related retain the underline selection when focused. Selecting another activity defaults to Details; selecting Diff explicitly still loads its changes.
- `inspect.line-statistics`: hub/workspace file details share total added/deleted lines, a category breakdown, and per-file counts; the Diff tab counts only inserted/deleted lines for its selected file.
- `inspect.hierarchy`: one persistent semantic activity heading names the inspector; PR/review status stays in the header. Details starts with metadata. The line-statistics journey checks foreground section headings and regular-weight branch/author values against the repository, secondary dates, preserved source commit messages, and a PR status badge. Retain `hierarchy-*.json` and the hub/workspace hierarchy screenshots.
- Selected binary files use the centered, plain-icon diff empty state with the Binary file title. Pure renames and metadata-only changes use the same layout with No text changes. Keep the file picker and selected path/count header available; the line-statistics journey measures binary-state centering and then switches to the rename fixture.

## How to get to it (user POV)

Click a hub activity to open its detail dialog. Open journal and select activity for the workspace inspector. From the inspector use Pop out diff; Dock back to workspace returns the reference.

## Driving it with Electron

Preconditions: `pnpm build`; `pnpm smoke` runs `tools/desktop-smoke.mjs`. Its first real fixture repository contains 20 modified files plus one added file; later reference checks use the explicitly isolated sample workspace.

- **Hub details:** select the activity containing `File filter animation fixture`; close with `.hub-detail-dialog [aria-label="Close dialog"]`, reopen, and require cached details without a loading flash.
- **File filtering:** `.hub-detail-file-filters [data-value="modified"]` shows 20 modified rows. Scroll `.hub-detail-viewport`, select `[data-value="added"]`, and require one remaining file with clamped scroll and an indicator remaining in its track.
- **Reference:** `[aria-label="Pop out diff"]` opens a reference. Cite to the editable workspace, then `[aria-label="Dock back to workspace"]`; require the reference to close and the main inspector to regain its pop-out action.
- **Evidence:** record selected activity, actions, resulting file counts/paths, screenshots of hub/inspector/reference, and the resulting citation body when claimed. Add these captures to the diagnostic harness before reporting a feature change verified.
- **Other entry:** select the same real activity in the workspace and compare the displayed file paths/diff with hub details. The sample reference result does not prove real activity loading on this entry point.

## Gotchas

Run `pnpm verify hub-dialog` after a build for the Windows side-frame regression. The disposable repository journey opens real hub details, compares the native frame's left/right pixels before and after dimming, and requires stable root bounds and overflow through open/close. Portaled Arc dialog backdrops are clipped to the rounded content inset when native window chrome is present. Evidence retains before/after screenshots, geometry, actions, exit and cleanup results. This covers backdrop spill into the frame; it does not establish reproduction of every intermittent GPU rendering artifact.

The line-statistics journey measures header text baselines in both hub and workspace; require title/addition/deletion offsets within 0.5 CSS pixels in unfocused, hover, and popover-open states. Inspect `alignment-*.json` and the six state PNGs. `alignment-states.html` composes those real UI captures into one comparison.

For line statistics, run `pnpm build` then `pnpm verify line-statistics`. The runner seeds an old metadata-only commit in a disposable profile and creates a real repository containing runtime, test, eval, docs, config, renamed, binary, root, and empty-commit changes. The app hydrates the old record through real IPC/Git. An isolated GitHub transport supplies PR metadata, fails once, and recovers through Retry details; it makes no external requests. Require hub/workspace totals of +647/−45, matching category sums, selected runtime +55/−7, selected test +77/−1, a binary label, rename zero, root +46/−0, and empty-commit zero. It also exercises pop-out/dock, keyboard disclosure and focus return, dark/light contrast, 320px reflow, 200% zoom, and reopening persisted PR counts without refetching. Preserve `run.json`, screenshots, `actions.jsonl`, `fixture.json`, `http-requests.json`, `contrast-*.json`, and `persisted-activities.json` under the printed evidence directory. Success requires `passed`, `cleanup.removed`, and `evidenceRetained` in `run.json`. This proves the offline GitHub adapter flow, not live GitHub access.

After `pnpm build`, run `pnpm verify inspector-tabs` for the focused tab regression journey. It uses a disposable journal-only sample profile, real Electron mouse/arrow-key input, and visible native windows so Motion can settle. It checks the 2px indicator geometry and transparent trigger background for all three tabs in the docked dark workspace and detached dark/light reference, then docks back. An opaque focus background hides the indicator because it paints behind the trigger. Screenshots, input observations, build/source details, logs, exit status, and cleanup results survive under `.ai-docs/verification/inspector-tabs-*/`; require `run.json.passed`, `cleanup.removed`, and `evidenceRetained` to be true. Sample data proves tab rendering and docking, not real activity loading or publishing.

Hidden Electron windows can pause animation; the existing diagnostic measures the vertical escape rather than claiming smooth horizontal motion. Reference windows are read-only. Preserve existing failure/loading/cached/confirmed-empty behavior tests until those distinct states are covered by real desktop journeys. The diagnostic currently emits console results without the import runner's complete retained proof contract.

Light-theme captures use an explicit renderer theme fixture because the app stays dark when OS appearance changes. The repository-import journey owns the production startup and OS-change assertions.

The acquisition diagnostic dismisses setup before opening real hub activity, opens workspace Details, then uses native mouse input on the Diff tab. It independently checks that metadata-only hub loading created no patch rows in `journal.sqlite`. Patch IDs are content hashes, so count all patches rather than a historical ID prefix.
