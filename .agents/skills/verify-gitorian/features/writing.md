# Writing

## Header atmosphere

Review hub/workspace skies manually for local-time colors, breadcrumb contrast, restrained motion, reduced motion and usable static fallback. Shader draw counts, entry opacity frames and route stress loops are not automated release gates. Writing, input, recovery and persistence remain covered by the journeys below.

Start or resume a weekly entry, edit structured writing, cite work, and recover local writing without a Notion connection.

`JournalPublishing` owns durable intent, confirmation, uncertain-outcome persistence and marker reconciliation using Effect. Preserve the journal/revision/Notion behavior tests, including the gated uncertain-outcome checkpoint: a lost response must not reach the caller before that recovery record is durable, and reconciliation must find the original page without another creation. Run `pnpm verify publishing` for the real Electron publish/update/rejection flow and post-exit SQLite evidence. Simulated HTTP is the provider adapter; this journey authorizes no live publishing.

## Sub-features

- `writing.entry`: hub Write and workspace Start this week reach the same editable weekly draft.
- `writing.save`: typing autosaves and survives renderer reload.
- `writing.template`: a new entry inherits the saved template without mutating it.
- `writing.code`: typed/pasted language fences and slash Code block use the same editable code node. Search/change Code language, Copy code, and Wrap lines/Unwrap lines retain raw text and saved language.
- `writing.citation`: selected activity is inserted without losing surrounding writing; undo removes the insertion.
- `writing.clipboard`: workspace right-click and Shift+F10 expose Arc Cut, Copy and Paste for the title, body and selected read-only text.
- `writing.checklist`: formatter and task shortcut insertion, editable text beside checkboxes, Enter continuation/exit, Backspace/undo and saved checked state. Run `pnpm verify writing-checklist`.
- `writing.update`: background update download preserves input, focus and autosave; explicit installation checkpoints the final revision. Owned by the [app updates journey](app-updates.md).

## How to get to it (user POV)

From the hub use `Write this week’s entry` or `Open journal` to create or resume the current week's draft. An empty week reached inside the workspace offers `Start this week’s entry`. In the workspace, edit Entry title and Journal body; inspect activity and use its citation action.

## Driving it with Electron

### Checklist journey

After `pnpm build`, run `pnpm verify writing-checklist` (`tests/e2e/writing-checklist.spec.ts`). The shared desktop fixture owns a journal-only disposable profile with disconnected providers and no repositories. Open journal from the hub creates the current week's draft; resume opens the existing draft.

The journey clears the template with native selection/typing, chooses Checklist with the pointer, and types immediately. Require text to appear beside the checkbox, not below it. Enter must create an unchecked item whose empty text area accepts a pointer click after focus leaves the editor. Backspace deletes text normally; at an item's start it unwraps while preserving text, and undo restores the task and preceding paragraph. After native Home input, wait until the editor observes the caret at the task's start before sending Backspace; DOM selection and editor state settle through `selectionchange`. Enter on an empty item exits to a paragraph. Keyboard formatter selection and the editor's typed `[ ] ` shortcut reach the same behavior. Autosave, renderer reload and a post-exit read-only SQLite query must preserve the document and checked state.

Inspect `run.json` for `passed: true`, `exit: 0` and `cleanup.removed: true`. Retain numbered screenshots, actions, trace, `inserted-dom.json`, `saved-body.json` and `persisted-drafts.json` in the printed evidence directory. This proves renderer reload and durable storage, not a full process restart or external publishing.

### Other writing paths

Preconditions: `pnpm build`. `pnpm smoke` runs `tools/desktop-smoke.mjs` against temporary repositories and an isolated profile. It drives real writing before explicitly switching to the sample workspace. Use the existing source as the executable journey and keep its real/sample phases distinct.

- **Start:** `[aria-label="Open journal"]` creates or resumes the weekly draft. `[aria-label="Journal breadcrumb"]` returns to the hub. The legacy smoke's no-draft-created expectation predates the hub's automatic writing start; the checklist journey observes the current behavior.
- **Type/save:** focus `[aria-label="Journal body"]`; `webContents.insertText('The draft survives a restart.')` exercises real input. Wait for a real IPC draft result containing that text, reload the workspace, and require the rendered text to survive.
- **Recovery:** the existing harness injects a newer recovery record as explicit fault setup, then reloads and observes recovered text. This is recovery coverage, not user input.
- **Citation:** the sample phase inserts an activity citation and tests detached reference behavior. Repeat citation in real fixture mode and verify the saved body for a real-persistence claim.
- **Evidence:** capture before typing, after input, save status, post-reload body, the resulting IPC body, and an independent post-exit SQLite read. Extend the diagnostic's current console-only evidence before accepting a changed writing path.
- **Other entries:** explicitly drive workspace `Start this week` and resume an existing draft too; the hub-start result alone does not establish those entry points.

## Code block journey

Run `pnpm build`, `pnpm verify doctor`, then `pnpm test:e2e code-block`. This journal-only Playwright journey uses pointer/keyboard input, native Electron clipboard, the real preload and autosave, and an independent post-exit SQLite query. It covers a typed JavaScript fence, plain-text selection and searchable keyboard language change to TypeScript, Escape focus, editing, exact code copy (including LF on Windows), measured horizontal overflow before/after keyboard wrap and pointer unwrap, an unknown pasted fence, literal Markdown paste inside code, autosave and renderer reload. Keep the numbered screenshots and code-block close-up, persisted-drafts.json, trace, actions.jsonl and run.json; require clean exit and cleanup.removed. HTML/Markdown language round trips, provider alias normalization and unknown-language fallback are covered by the focused editor/format tests. No live Notion requests are made.

The language, copy and wrap actions share one floating tray overlaid at the block's top-right corner, using image action colors with compact shadowless controls. Require a single code line to have equal top/bottom inset, and its toolbar to be at most 32px tall with no box-shadow. The horizontal Arc ScrollArea owns scrolling; wheel left/right and confirm the overlay toolbar stays fixed. Move the pointer across Copy, Wrap and Code language and require the same single highlight to match each control, including keyboard focus on language after Shift+Tab. Check its bounds are inside the code block, confirm Copy changes its icon without a visible status row, and inspect the centered single-line, TypeScript showcase and search-header menu screenshots. Open Code language, search through Search code language, pick by pointer/keyboard, and use one Escape to restore focus. Tab continues to the next toolbar action and an outside click retains focus on its target; one popup must contain the fixed search header and scrolling options. Scroll the language list and require the search field to stay in place. Check empty-result recovery and selected-language retention. Require colored keyword tokens after language changes and editing, with none in Plain text or an unknown language. The picker offers 194 highlighted language choices plus Plain text. Decorations must not enter saved JSON or HTML. The engine test mounts the real React node view when asserting decoration output.

Copy and wrapping remain available in read-only editors; the language action is disabled. Wrapping is local view state and resets on remount. Unknown fence languages remain visible and stored locally; the Notion adapter exports unsupported languages as plain text. The existing slash menu still owns Code block creation; its formatter-menu tests cover that entry point. Native whole-document copy/paste also exercises a multiword provider language (Visual basic) before returning to TypeScript.

## Gotchas

Run `pnpm verify publishing` after a build for Notion publishing feedback. This journal-only Electron fixture uses the real preload, IPC, publishing adapter, encrypted fixture credential and store with simulated Notion HTTP. Publish must show `Published to Notion` and change the header action to `Update in Notion`. Edit using native text input, update the same page, and require `Updated in Notion`, one page creation, and update requests. Reload preserves the update label. A simulated 403 must show recovery without a success toast. The runner independently checks persisted writing and retains screenshots, HTTP bodies, actions, process exit and cleanup. It makes no live Notion requests.

The diagnostic's reload keeps the main process alive; it is not a full process restart. Its historical assertion names do not strengthen that proof. A full-restart persistence claim requires closing and reopening the same disposable profile. Sample-mode Publish is simulated. Real Notion publishing requires an authorized test destination and is outside this local journey. Keep the existing autosave/race/editor behavior tests while these gaps remain.

## Workspace clipboard journey

Run `pnpm build`, `pnpm verify doctor`, then `pnpm test:e2e workspace-clipboard`. The journal-only Playwright scenario owns clipboard behavior; it creates no repositories and uses no integrations.

The journey starts from hub Open journal, types bold body text, copies and cuts through the mouse menu, undoes the cut and pastes the rich text. It cuts/pastes the title, checks Shift+F10, keyboard selection and Escape focus restoration, then copies selected Activity heading text with Cut/Paste disabled. Outside press closes the menu; reduced motion retains keyboard access. Reload and an independent post-exit SQLite read must retain the title and both bold text copies. In the selected-text menu screenshot, verify separate Arc keycaps for Ctrl and X/C/V aligned at the trailing edge. Keep the named screenshots, persisted-drafts.json, trace, actions and successful run.json with cleanup evidence.

Database evidence uses `journal.sqlite`, with relational `drafts` (`body` JSON, `version` integer), `draft_selections`, `publication_attempts` and `entry_coverage`. Recovery copies carry their saved draft version. Both reopening a conflicting recovery copy and a live stale autosave open the Arc **Choose which writing to keep** dialog. Select **Saved writing** or **Recovery copy**, then submit **Keep saved writing** or **Use recovery copy**. Selection alone never resolves the conflict. Escape and outside presses cannot dismiss it; there is no close button. Both copies remain available until the chosen action succeeds. A newer saved version requires a fresh choice; a failed save leaves retry guidance inside the dialog.

Run `pnpm build`, `pnpm verify doctor`, then `pnpm test:e2e draft-recovery`. This owning journey uses a journal-only disposable profile and real IPC/SQLite. Older recovery data and a second writer are explicit fixture setup; a temporary SQLite trigger simulates write failure. Require blocked dismissal, keyboard focus containment and return, selection without submission, both confirmed choices, failure/retry in the dialog, unresolved reload, another writer during resolution, and durable post-exit writing. Check dialog bounds at desktop, 1000px, 768px and 390px window widths. Retain `conflict-dialog.png`, numbered screenshots, fixture details, persisted-drafts.json, trace, actions and successful run.json with clean exit and cleanup. Reload keeps the main process running; it is not a full process restart. `tests/workspace-writing.test.ts` retains focused in-flight save/acknowledgment behavior.

For release typing latency, run `pnpm smoke:writing:release`. It shares the development replay but loads the built renderer, retains the CPU profiles and JSON timing report, checks the persisted body against the editor, and requires p95 dispatch-to-ack under 33 ms, no application long tasks and no main-thread SQLite transactions. Development React profiling overhead remains visible in `pnpm smoke:writing`; do not relabel a failed development run as passing.

## Block-first selection

Run pnpm test:e2e select-all for paragraph, multiline code and list text selection, repeated escalation, caret reset, empty-block document selection and replacement/undo through native keyboard input. The shared journal extension also supplies template editing. Code-block whole-document clipboard round trips explicitly press Select All twice.

## Autosave failure feedback

Run `pnpm build`, `pnpm verify doctor`, then `pnpm test:e2e workspace-save-errors draft-recovery`.
`workspace-save-errors` owns journal-only autosave rejection: its Electron IPC registration fixture rejects only the selected draft command, retaining real renderer, preload and SQLite. From hub Open journal, type "Writing that could not be saved". Require one persistent **Could not save writing** toast with **Retry saving**, no footer error, recovery storage containing later edits, and a retry that still fails without losing input. Remove the injected rejection and retry; require the toast to disappear, normal saved status, reload retention and independent post-exit SQLite evidence. Keep numbered PNGs, source.patch, actions, trace, persisted-drafts.json and successful run.json with cleanup.removed. The conflict dialog remains owned by draft-recovery; inspector diff errors remain inline.

## Emoji

Run `pnpm test:e2e emoji` in a disposable journal profile. Type `:rocket`, choose with Enter, then open `/emoji` from the formatter: it becomes a literal `:` with editing focus retained. Type to search, use the Arc category tabs, and check Recent ordering after repeated picks and renderer reload. Verify insertion replaces the trigger, unmatched queries show recovery copy, Escape retains text, and both inserted emoji survive autosave and reopening after reload. The journey retains browse, filtered, and inserted screenshots. Emoji are ordinary Unicode text, so existing save/export paths apply.

The grid retains its rows and uses browser-native `content-visibility: auto` with fixed row geometry. A bundled lossless glyph atlas avoids cold color-font shaping and painting when scrolling. Insertion still writes Unicode text. Regenerate the atlas on Windows with `node tools/generate-emoji-atlas.mjs` after updating gemoji. The generator owns and removes a disposable Electron profile.

Cold-open verification retains `emoji-open-timing.json`, requires less than 200ms, and bounds the number of browser-rendered options below 400 (offscreen DOM rows remain available). The ScrollArea height has an explicit fallback before Radix publishes its placement variables. Category tests require an evenly filled strip and transparent hovered/focused tabs. Emoji option hover and keyboard selection share a brighter semantic foreground/surface mix.

The same owning journey exercises seven native wheel jumps from 800 to 2400px and direction reversals under 4x CPU slowdown. `emoji-scroll-frames.json` retains animation-frame timestamps, scroll offsets and intersecting emoji rows. Require no empty sampled viewports and no frame gap over 150ms. Split traces into `before-scroll-trace.zip`, `scroll-trace.zip`, and `trace.zip`: screenshot/DOM snapshot collection is disabled only during the timed portion because profiling showed snapshot traversal distorting frame timing. Input stays native through CDP wheel events. Retain the scrolled and hover screenshots after normal tracing resumes. Category controls stay above content with a 16px group gap; check bounds at 390, 768, 1024 and 1440px, 200% zoom and the RTL mirror.

Flags are not offered: the catalog excludes the Flags category before building search and history lookups. The emoji journey seeds a formerly picked Syria flag, verifies no Flags tab or flag in All/Recent, and verifies `:syria` shows no matches. Stored journal text and the cached atlas stay unchanged.

