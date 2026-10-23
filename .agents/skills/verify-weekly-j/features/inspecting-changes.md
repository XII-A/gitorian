# Inspecting changes

Open activity details, review changed files and diffs, and move a read-only reference window back into the writing workspace.

## Sub-features

- `inspect.hub`: activity opens details; cached reopening avoids a loading flash.
- `inspect.files`: file filtering retains correct results and usable scroll position.
- `inspect.reference`: pop-out and dock preserve the selected activity and citation destination.
- `inspect.reference-tabs`: Details is first and opens by default in the workspace and native reference window. Details, Diff, and Related retain the underline selection when focused. Selecting another activity defaults to Details; selecting Diff explicitly still loads its changes.

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

After `pnpm build`, run `pnpm verify inspector-tabs` for the focused tab regression journey. It uses a disposable journal-only sample profile, real Electron mouse/arrow-key input, and visible native windows so Motion can settle. It checks the 2px indicator geometry and transparent trigger background for all three tabs in the docked dark workspace and detached dark/light reference, then docks back. An opaque focus background hides the indicator because it paints behind the trigger. Screenshots, input observations, build/source details, logs, exit status, and cleanup results survive under `.ai-docs/verification/inspector-tabs-*/`; require `run.json.passed`, `cleanup.removed`, and `evidenceRetained` to be true. Sample data proves tab rendering and docking, not real activity loading or publishing.

Hidden Electron windows can pause animation; the existing diagnostic measures the vertical escape rather than claiming smooth horizontal motion. Reference windows are read-only. Preserve existing failure/loading/cached/confirmed-empty behavior tests until those distinct states are covered by real desktop journeys. The diagnostic currently emits console results without the import runner's complete retained proof contract.
