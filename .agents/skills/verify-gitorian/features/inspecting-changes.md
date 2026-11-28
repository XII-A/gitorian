# Inspecting changes

Open activity details, review changed files and diffs, and move a read-only reference window back into the writing workspace.

## Sub-features

- `inspect.hub`: activity opens details; cached reopening avoids a loading flash.
- `inspect.mermaid`: open a PR description in hub, workspace and detached Details. Switch Diagram/Source, copy the exact source and try invalid input. Review embedded font appearance and resizing.
- `inspect.files`: file filtering retains correct results and usable scroll position.
- `inspect.reference`: pop-out and dock preserve the selected activity and citation destination.
- `inspect.reference-tabs`: Details is first and opens by default in the workspace. Pop-out preserves the selected Details, Diff or Related tab. All three tabs retain the underline selection when focused. Selecting another activity defaults to Details; selecting Diff explicitly still loads its changes.
- `inspect.line-statistics`: hub/workspace file details share total added/deleted lines, a category breakdown, and per-file counts. The Diff tab shows aggregate text changes, each file header's inserted/deleted lines, and file/folder totals in the detached tree.
- `inspect.hierarchy`: one persistent semantic activity heading names the inspector; PR/review status stays in the header. Details starts with metadata. The line-statistics journey checks foreground section headings and regular-weight branch/author values against the repository, secondary dates, preserved source commit messages, and a PR status badge. Retain `hierarchy-*.json` and the hub/workspace hierarchy screenshots.
- Binary files remain in the continuous stream with a Binary file header state. Pure renames and metadata-only changes retain a No text changes state and zero line counts. Navigation scrolls to these entries without replacing the surrounding changes; the line-statistics journey owns their counts and visible inline states.
- `inspect.diff-workspace`: Atlas is the single diff workspace. Compact mode reads all changed files continuously, with collapsible status-icon headers, Expand all/Collapse all, and one display popover for layout, wrapping, indentation and line counts. There is no file selector, current-file breadcrumb, bottom directory strip or comparison control. The wide detached workspace adds a dense explorer with a search icon that morphs into a field, status/binary filters, independent test/documentation exclusions, folder disclosure, tree/list views and path/change ordering. Search filters navigation in place without a results menu. File filters, exclusions and ordering affect the reader; exclusions use the line-statistics path categories. Selecting a file opens its diff. The detached citation footer is removed; citations remain in the docked workspace. The option palettes and functional diff behaviors are covered by the journeys below; header-motion checks still need the separate manual pass described there.

## How to get to it (user POV)

Click a hub activity to open its detail dialog. Use the hub writing CTA and select activity for the workspace inspector. From the inspector use Pop out diff; Dock back to workspace returns the reference.

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

Review the captured content corners across Details, Diff and Related: detached panels have two upper inset-radius corners; docked panels have one rounded upper-right corner and a square shared left edge. Both omit the full-width tab divider and retain the active-tab underline. The muted header surface fills the cutouts, and scrolling content and scrollbar thumbs stay inside the panel clip. Use Dock back to workspace as the detached readiness control; that window has no citation footer.

Hidden Electron windows can pause animation; the existing diagnostic measures the vertical escape rather than claiming smooth horizontal motion. Reference windows are read-only. Preserve existing failure/loading/cached/confirmed-empty behavior tests until those distinct states are covered by real desktop journeys. The diagnostic currently emits console results without the import runner's complete retained proof contract.

Light-theme captures use an explicit renderer theme fixture because the app stays dark when OS appearance changes. The repository-import journey owns the production startup and OS-change assertions.

The acquisition diagnostic dismisses setup before opening real hub activity, opens workspace Details, then uses native mouse input on the Diff tab. It independently checks that metadata-only hub loading created no patch rows in `journal.sqlite`. Patch IDs are content hashes, so count all patches rather than a historical ID prefix.

- **Provider emoji:** check a PR title and description on each Details surface. Shortcodes render in prose while code and link targets remain literal.

- **Description images:** open a seeded PR with HTML and Markdown images on each Details surface. Check image decoding, literal code and rejection of unsafe links.

## Diff rendering and syntax highlighting

The diff-viewer journey also owns opening latency and progressive source arrival. Its latency scenario records click-to-readable source across animation frames, including skeleton-frame counts, for the existing large fixture and repeated activity switches. Retain `diff-timings.json`; prepared reopens require no skeleton frames and a first viewport within 250 ms. Compare the same fixture, runner and machine before and after changes. These measurements cover local retained patches through the normal Hub/Details/workspace path, not uncached provider latency or an uninitialized highlighting runtime. The progressive-arrival scenario holds worker messages after the first file, navigates and scrolls in the detached reader, then releases remaining batches and requires the visible source position to survive. Existing scenarios own exact copy, virtualization, filtering, presentation persistence and highlighting-failure fallback.

Pointer dwell and keyboard focus prepare only cached evidence, without acquiring provider data or pinning the window to a hovered activity. Hub Details has the same cache-only policy. Workspace and reference Details may acquire the selected activity's diff after a short delay; foreground Diff remains independently retryable. `tests/diff-preparation.test.ts`, `tests/diff-loading.test.ts` and the cached-only checks in `tests/git.test.ts` own cancellation, revision validity, bounded speculative parsing, incremental results and worker-failure recovery.

Change display, sort and list preferences, then switch activities and restart the disposable desktop profile. Verify retained preferences, independent detached layout and the combined reset. `tests/journal-database.test.ts` covers older-journal defaults and simultaneous updates.

Review split/unified, reading tools, tree/list, sorting and exclusions using the actual controls. Check that exclusions alone leave the change-type filter inactive.

For viewer changes, also exercise native selection and copy, keyboard navigation, file disclosure and the raw fallback.

When verification resumes, use a change set with at least 18 files in both docked and detached views. Collapse all, scroll to a file near the bottom, and expand it. Record frame-by-frame header offsets through source measurement; the clicked header should retain its viewport position without an intermediate jump to the top. Review an unchanged-lines strip directly beneath a file header: its muted secondary fill should distinguish it without another top or bottom border. Also pop out from Details and Related and require that same tab on first paint. Motion and strip appearance need manual review in addition to the automated journey.

`code-highlighting.ts` owns language aliases, the CSS-variable palette, bounded tokenization and engine readiness. Prose snippets remain React-rendered escaped source; explicit Mermaid diagrams/source are unchanged. The existing line-statistics journey remains the owner for binary/rename selected states and acquisition counts; inspector-tabs owns tab navigation. Do not duplicate those acquisition fixtures in the diff-rendering journey.

The diff-viewer clipboard scenario also owns diff state retention across Details and Related in both the docked inspector and detached window. It starts with a mix of open and closed files, scrolls within the open diff, switches away and back, and requires the same scroll offset and file disclosure states. The diff remains mounted after its first visit, with an inactive panel that is hidden and inert while retaining its viewport dimensions; selecting another activity starts a separate diff state. The compact option-palette refinement was checked with this scenario; retain its native-copy and tab-retention assertions when changing the controls.

That scenario also copies a native selection across an empty Pierre row and gutter ranges in both directions across unequal old/new coordinates, in unified and split layouts. Mixed-side ranges copy selected display rows without patch markers, left before right in split layout and context once. Same-side ranges retain source-side copy, including virtualized rows.
