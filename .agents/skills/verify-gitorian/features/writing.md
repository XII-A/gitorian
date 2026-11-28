# Writing

## Typography review

Manually review bundled Geist Sans upright/italic prose and Geist Mono code/paths/identifiers at 12-16px, narrow widths and 200% zoom. Preserve multilingual shaping, fallback and emoji.

## Header atmosphere

Review hub/workspace skies manually for local-time colors, breadcrumb contrast, restrained motion, reduced motion and usable static fallback. Shader draw counts, entry opacity frames and route stress loops are not automated release gates. Review the affected writing and recovery paths below.

Start or resume a weekly entry, edit structured writing, cite work, and recover local writing without a Notion connection.

`JournalPublishing` owns durable intent, confirmation, uncertain-outcome persistence and marker reconciliation using Effect. Preserve the journal/revision/Notion behavior tests, including the gated uncertain-outcome checkpoint: a lost response must not reach the caller before that recovery record is durable, and reconciliation must find the original page without another creation. Run `pnpm verify publishing` for the real Electron publish/update/rejection flow and post-exit SQLite evidence. Simulated HTTP is the provider adapter; this journey authorizes no live publishing.

## Sub-features

- `writing.entry`: hub Write and workspace Start this week reach the same editable weekly draft.
- `writing.save`: typing autosaves and survives renderer reload.
- `writing.template`: a new entry inherits the saved template without mutating it.
- `writing.code`: typed/pasted language fences and slash Code block use the same editable code node. Search/change Code language, Copy code, and Wrap lines/Unwrap lines retain raw text and saved language.
- `writing.citation`: selected activity is inserted without losing surrounding writing; undo removes the insertion.
- `writing.clipboard`: workspace right-click and Shift+F10 expose Arc Cut, Copy and Paste for the title, body and selected read-only text.
- `writing.checklist`: formatter and task shortcut insertion, editable checkbox text, Enter continuation and exit, Backspace and undo.
- `writing.slash`: literal slashes, lasting dismissal, Close menu, multiword commands and saved text.
- `writing.update`: background update download preserves input, focus and autosave; explicit installation checkpoints the final revision. Owned by the [app updates journey](app-updates.md).

## How to get to it (user POV)

From the hub use `Write this week’s entry` or `Open journal` to create or resume the current week's draft. An empty week reached inside the workspace offers `Start this week’s entry`. In the workspace, edit Entry title and Journal body; inspect activity and use its citation action.

## Driving it with Electron

### Slash menu journey

Type embedded slashes, dismiss a query with Escape, outside click, Close menu and Space, then continue typing. Verify literal text, focus and a fresh multiword command.

### Checklist journey

Open a new journal-only draft in the disposable desktop profile and clear the template.

The journey clears the template with native selection/typing, chooses Checklist with the pointer, and types immediately. Require text to appear beside the checkbox, not below it. Enter must create an unchecked item whose empty text area accepts a pointer click after focus leaves the editor. Backspace deletes text normally; at an item's start it unwraps while preserving text, and undo restores the task and preceding paragraph. After native Home input, wait until the editor observes the caret at the task's start before sending Backspace; DOM selection and editor state settle through `selectionchange`. Enter on an empty item exits to a paragraph. Keyboard formatter selection and the editor's typed `[ ] ` shortcut reach the same behavior. Autosave, renderer reload and a post-exit read-only SQLite query must preserve the document and checked state.

### Other writing paths

Preconditions: `pnpm build`. `pnpm smoke` runs `tools/desktop-smoke.mjs` against temporary repositories and an isolated profile. It drives real writing before explicitly switching to the sample workspace. Use the existing source as the executable journey and keep its real/sample phases distinct.

- **Start:** `[aria-label="Open journal"]` creates or resumes the weekly draft. `[aria-label="Journal breadcrumb"]` returns to the hub.
- **Type/save:** focus `[aria-label="Journal body"]`; `webContents.insertText('The draft survives a restart.')` exercises real input. Wait for a real IPC draft result containing that text, reload the workspace, and require the rendered text to survive.
- **Recovery:** the existing harness injects a newer recovery record as explicit fault setup, then reloads and observes recovered text. This is recovery coverage, not user input.
- **Citation:** Run `pnpm verify citations` with a built renderer. Select text mid-draft, inspect an activity and cite it. Check surrounding text, subsequent typing, undo, activation and persisted links in the disposable journal. Drop a row between paragraphs and inside a word, check that the drop guide clears promptly, undo the copy, and check cancellation, unknown activity IDs and ordinary text and image drops. Open the keyboard picker on a selection, search, navigate with both arrows, confirm with Enter and dismiss with Escape. Use Ctrl+Enter (Cmd+Enter on macOS) to inspect the highlighted result from focus mode, from Related on the same activity, and with that activity popped out. Check that Details takes focus and the next citation uses the saved selection. Check undo, empty results and long titles. Wheel the results, drag the overlay thumb, and use End and Home with focus in search. The journey captures the Arc palette open, filtered and empty, the opened Details panel, and a real-time animation of pointer navigation, filtering, clearing and dismissal.
- **Evidence:** capture before typing, after input, save status, post-reload body, the resulting IPC body, and an independent post-exit SQLite read. Extend the diagnostic's current console-only evidence before accepting a changed writing path.
- **Other entries:** explicitly drive workspace `Start this week` and resume an existing draft too; the hub-start result alone does not establish those entry points.

## Code block journey

Type and paste language fences, use keyboard language selection, edit the code and undo. Check exact clipboard contents, wrap and unwrap, and retained text and language after reopening.

The language, copy and wrap actions share one floating tray overlaid at the block's top-right corner, using image action colors with compact shadowless controls. Require a single code line to have equal top/bottom inset, and its toolbar to be at most 32px tall with no box-shadow. The horizontal Arc ScrollArea owns scrolling; wheel left/right and confirm the overlay toolbar stays fixed. Move the pointer across Copy, Wrap and Code language and require the same single highlight to match each control, including keyboard focus on language after Shift+Tab. Check its bounds are inside the code block, confirm Copy changes its icon without a visible status row, and inspect the centered single-line, TypeScript showcase and search-header menu screenshots. Open Code language, search through Search code language, pick by pointer/keyboard, and use one Escape to restore focus. Tab continues to the next toolbar action and an outside click retains focus on its target; one popup must contain the fixed search header and scrolling options. Scroll the language list and require the search field to stay in place. Check empty-result recovery and selected-language retention. Require colored keyword tokens after language changes and editing, with none in Plain text or an unknown language. The picker combines the pinned Highlights lexer catalog with provider language labels and Plain text. Unsupported provider/saved languages remain literal and retain their selected value; do not assert an obsolete fixed choice count. Decorations must not enter saved JSON or HTML. The engine test mounts the real React node view when asserting decoration output.

Copy and wrapping remain available in read-only editors; the language action is disabled. Wrapping is local view state and resets on remount. Unknown fence languages remain visible and stored locally; the Notion adapter exports unsupported languages as plain text. Check Code block creation through the slash menu. Native whole-document copy/paste also exercises a multiword provider language (Visual basic) before returning to TypeScript.

## Gotchas

Run `pnpm verify publishing` after a build for Notion publishing feedback. This journal-only Electron fixture uses the real preload, IPC, publishing adapter, encrypted fixture credential and store with simulated Notion HTTP. Publish must show `Published to Notion` and change the header action to `Update in Notion`. Edit using native text input, update the same page, and require `Updated in Notion`, one page creation, and update requests. Reload preserves the update label. A simulated 403 must show recovery without a success toast. The runner independently checks persisted writing and retains screenshots, HTTP bodies, actions, process exit and cleanup. It makes no live Notion requests.

The diagnostic's reload keeps the main process alive; it is not a full process restart. Its historical assertion names do not strengthen that proof. A full-restart persistence claim requires closing and reopening the same disposable profile. Sample-mode Publish is simulated. Real Notion publishing requires an authorized test destination and is outside this local journey.

## Workspace clipboard journey

Use a journal-only disposable profile to review clipboard behavior.

The journey starts from hub Open journal, types bold body text, copies and cuts through the mouse menu, undoes the cut and pastes the rich text. It cuts/pastes the title, checks Shift+F10, keyboard selection and Escape focus restoration, then copies selected Activity heading text with unavailable Cut/Paste actions omitted. Outside press closes the menu; reduced motion retains keyboard access. Reload and an independent post-exit SQLite read must retain the title and both bold text copies. In the selected-text menu screenshot, verify compact secondary Arc keycaps for Ctrl and X/C/V aligned at the trailing edge, no row icons, and dividers around spelling groups.

Database evidence uses `journal.sqlite`, with relational `drafts` (`body` JSON, `version` integer), `draft_selections`, `publication_attempts` and `entry_coverage`. Recovery copies carry their saved draft version. Both reopening a conflicting recovery copy and a live stale autosave open the Arc **Choose which writing to keep** dialog. Select **Saved writing** or **Recovery copy**, then submit **Keep saved writing** or **Use recovery copy**. Selection alone never resolves the conflict. Escape and outside presses cannot dismiss it; there is no close button. Both copies remain available until the chosen action succeeds. A newer saved version requires a fresh choice; a failed save leaves retry guidance inside the dialog.

For draft conflict changes, review both confirmed choices, focus return, failure/retry and persistence after reopening.

For release typing latency, run `pnpm smoke:writing:release`. It shares the development replay but loads the built renderer, retains the CPU profiles and JSON timing report, checks the persisted body against the editor, and requires p95 dispatch-to-ack under 33 ms, no application long tasks and no main-thread SQLite transactions. Development React profiling overhead remains visible in `pnpm smoke:writing`; do not relabel a failed development run as passing.

## Block-first selection

Use Select All in a paragraph, code block and list. Check block-first selection, repeated escalation, caret reset, replacement and undo.

## Autosave failure feedback

After a simulated failure, check that autosave offers one retry toast and preserves the latest edited text.

## Emoji

Type `:rocket` and select with Enter. Open `/emoji`, search, use the category tabs and check Recent after reopening. Check Escape, footer scrolling and saved text.

The grid retains its rows and uses browser-native `content-visibility: auto` with fixed row geometry. A bundled lossless glyph atlas avoids cold color-font shaping and painting when scrolling. Insertion still writes Unicode text. Regenerate the atlas on Windows with `node tools/generate-emoji-atlas.mjs` after updating gemoji. The generator owns and removes a disposable Electron profile.

Review cold opening and scroll performance using the real picker.

Review rapid native scrolling and direction reversals at narrow widths, zoomed and in RTL.

Flags are not offered: the catalog excludes the Flags category before building search and history lookups. Search and Recent omit those entries.

## Local history and optional publishing

Exercise local and remote pagination, body search, pending reads, focus return, exact-week editing and autosave after reopening. Database tests cover linked-empty deduplication, locale search and image references.

## Multilingual direction

Review multilingual writing and clipboard behavior with an isolated journal profile.

- Type Arabic and Turkish text, add checklists and check direction after reopening.
- Copy complete blocks and inline text. Check that complete blocks preserve their direction policy and inline text inherits its destination.
- Import an image and write a multiline caption. Check direction, focus return and retained content.
- `tests/journal-database.test.ts` owns unchanged remote projection preserving exact local policy, genuine remote body replacement and stale-refresh rejection. Existing journal publishing scenarios exercise lost-response confirmation and durable local direction. Run `pnpm verify publishing` for simulated HTTP publishing feedback and independent storage evidence.

Manually inspect Arabic shaping, quote/toggle placement, marker sides, long mixed paragraphs, title alignment and captions at narrow widths. Writing is automatic with no document, block or caption direction controls. Imported and saved direction policies must still round-trip. Automatic means first strong character. Notion's interface currently cannot preserve forced direction remotely, so do not claim a remote override round trip. Interface translation, language-specific search and spellcheck are outside this feature.

Review toggle continuation, body entry, Backspace, indentation, undo and persistence when changing the editor.

Within toggle bodies, repeated Enter retains blank paragraphs; Backspace on the final empty direct body block outdents through the same transaction as Shift+Tab.

Backspace on an empty body block with following siblings deletes only the blank block and keeps the later content inside the toggle. The native writing-direction scenario and editor boundary cases cover this distinction.

Deleting internal blank toggle blocks moves the caret backward to the preceding block end. Check that following text stays intact.

For a toggle containing only its single empty placeholder, Backspace returns to the summary end without changing the document; a trailing empty block after other content still outdents. Covered with empty/nonempty titles and native RTL editing.

## Spelling context menu

Use a disposable English profile to review the spelling menu, correcting and learning a word, Shift+F10, focus return and the spellcheck setting.
