# Writing

Start or resume a weekly entry, edit structured writing, cite work, and recover local writing without a Notion connection.

`JournalPublishing` owns durable intent, confirmation, uncertain-outcome persistence and marker reconciliation using Effect. Preserve the journal/revision/Notion behavior tests, including the gated uncertain-outcome checkpoint: a lost response must not reach the caller before that recovery record is durable, and reconciliation must find the original page without another creation. Run `pnpm verify publishing` for the real Electron publish/update/rejection flow and post-exit SQLite evidence. Simulated HTTP is the provider adapter; this journey authorizes no live publishing.

## Sub-features

- `writing.entry`: hub Write and workspace Start this week reach the same editable weekly draft.
- `writing.save`: typing autosaves and survives renderer reload.
- `writing.template`: a new entry inherits the saved template without mutating it.
- `writing.code`: typed/pasted language fences and slash Code block use the same editable code node. Search/change Code language, Copy code, and Wrap lines/Unwrap lines retain raw text and saved language.
- `writing.citation`: selected activity is inserted without losing surrounding writing; undo removes the insertion.
- `writing.update`: background update download preserves input, focus and autosave; explicit installation checkpoints the final revision. Owned by the [app updates journey](app-updates.md).

## How to get to it (user POV)

From the hub use `Write`, or `Open journal` then `Start this week`. Reopen the same week to resume unfinished writing. In the workspace, edit Entry title and Journal body; inspect activity and use its citation action.

## Driving it with Electron

Preconditions: `pnpm build`. `pnpm smoke` runs `tools/desktop-smoke.mjs` against temporary repositories and an isolated profile. It drives real writing before explicitly switching to the sample workspace. Use the existing source as the executable journey and keep its real/sample phases distinct.

- **Start:** `[aria-label="Open journal"]` opens the workspace without creating a draft. `[aria-label="Journal breadcrumb"]` returns to the hub; the `Write` action starts writing from the saved template.
- **Type/save:** focus `[aria-label="Journal body"]`; `webContents.insertText('The draft survives a restart.')` exercises real input. Wait for a real IPC draft result containing that text, reload the workspace, and require the rendered text to survive.
- **Recovery:** the existing harness injects a newer recovery record as explicit fault setup, then reloads and observes recovered text. This is recovery coverage, not user input.
- **Citation:** the sample phase inserts an activity citation and tests detached reference behavior. Repeat citation in real fixture mode and verify the saved body for a real-persistence claim.
- **Evidence:** capture before typing, after input, save status, post-reload body, the resulting IPC body, and an independent post-exit SQLite read. Extend the diagnostic's current console-only evidence before accepting a changed writing path.
- **Other entries:** explicitly drive workspace `Start this week` and resume an existing draft too; the hub-start result alone does not establish those entry points.

## Code block journey

Run `pnpm build`, `pnpm verify doctor`, then `pnpm test:e2e code-block`. This journal-only Playwright journey uses pointer/keyboard input, native Electron clipboard, the real preload and autosave, and an independent post-exit SQLite query. It covers a typed JavaScript fence, plain-text selection and searchable keyboard language change to TypeScript, Escape focus, editing, exact code copy (including LF on Windows), measured horizontal overflow before/after keyboard wrap and pointer unwrap, an unknown pasted fence, literal Markdown paste inside code, autosave and renderer reload. Keep the numbered screenshots and code-block close-up, persisted-drafts.json, trace, actions.jsonl and run.json; require clean exit and cleanup.removed. HTML/Markdown language round trips, provider alias normalization and unknown-language fallback are covered by the focused editor/format tests. No live Notion requests are made.

The language, copy and wrap actions share one floating tray overlaid at the block's top-right corner, using image action colors with compact shadowless controls. Require a single code line to have equal top/bottom inset, and its toolbar to be at most 32px tall with no box-shadow. The horizontal Arc ScrollArea owns scrolling; wheel left/right and confirm the overlay toolbar stays fixed. Check its bounds are inside the code block, confirm Copy changes its icon without a visible status row, and inspect the centered single-line, TypeScript showcase and search-header menu screenshots. Open Code language, search through Search code language, pick by pointer/keyboard, and use one Escape to restore focus. Tab continues to the next toolbar action and an outside click retains focus on its target; one popup must contain the fixed search header and scrolling options. Scroll the language list and require the search field to stay in place. Check empty-result recovery and selected-language retention. Require colored keyword tokens after language changes and editing, with none in Plain text or an unknown language. The picker offers 194 highlighted language choices plus Plain text. Decorations must not enter saved JSON or HTML. The engine test mounts the real React node view when asserting decoration output.

Copy and wrapping remain available in read-only editors; the language action is disabled. Wrapping is local view state and resets on remount. Unknown fence languages remain visible and stored locally; the Notion adapter exports unsupported languages as plain text. The existing slash menu still owns Code block creation; its formatter-menu tests cover that entry point. Native whole-document copy/paste also exercises a multiword provider language (Visual basic) before returning to TypeScript.

## Gotchas

Run `pnpm verify publishing` after a build for Notion publishing feedback. This journal-only Electron fixture uses the real preload, IPC, publishing adapter, encrypted fixture credential and store with simulated Notion HTTP. Publish must show `Published to Notion` and change the header action to `Update in Notion`. Edit using native text input, update the same page, and require `Updated in Notion`, one page creation, and update requests. Reload preserves the update label. A simulated 403 must show recovery without a success toast. The runner independently checks persisted writing and retains screenshots, HTTP bodies, actions, process exit and cleanup. It makes no live Notion requests.

The diagnostic's reload keeps the main process alive; it is not a full process restart. Its historical assertion names do not strengthen that proof. A full-restart persistence claim requires closing and reopening the same disposable profile. Sample-mode Publish is simulated. Real Notion publishing requires an authorized test destination and is outside this local journey. Keep the existing autosave/race/editor behavior tests while these gaps remain.
