# Writing

Start or resume a weekly entry, edit structured writing, cite work, and recover local writing without a Notion connection.

`JournalPublishing` owns durable intent, confirmation, uncertain-outcome persistence and marker reconciliation using Effect. Preserve the journal/revision/Notion behavior tests, including the gated uncertain-outcome checkpoint: a lost response must not reach the caller before that recovery record is durable, and reconciliation must find the original page without another creation. Run `pnpm verify publishing` for the real Electron publish/update/rejection flow and post-exit SQLite evidence. Simulated HTTP is the provider adapter; this journey authorizes no live publishing.

## Sub-features

- `writing.entry`: hub Write and workspace Start this week reach the same editable weekly draft.
- `writing.save`: typing autosaves and survives renderer reload.
- `writing.template`: a new entry inherits the saved template without mutating it.
- `writing.citation`: selected activity is inserted without losing surrounding writing; undo removes the insertion.
- `writing.clipboard`: workspace right-click and Shift+F10 expose Arc Cut, Copy and Paste for the title, body and selected read-only text.
- `writing.checklist`: formatter and task shortcut insertion, editable text beside checkboxes, Enter continuation/exit, Backspace/undo and saved checked state. Run `pnpm verify writing-checklist`.
- `writing.update`: background update download preserves input, focus and autosave; explicit installation checkpoints the final revision. Owned by the [app updates journey](app-updates.md).

## How to get to it (user POV)

From the hub use `Write this week’s entry` or `Open journal` to create or resume the current week's draft. An empty week reached inside the workspace offers `Start this week’s entry`. In the workspace, edit Entry title and Journal body; inspect activity and use its citation action.

## Driving it with Electron

### Checklist journey

After `pnpm build`, run `pnpm verify writing-checklist` (`tests/e2e/writing-checklist.spec.ts`). The shared desktop fixture owns a journal-only disposable profile with disconnected providers and no repositories. Open journal from the hub creates the current week's draft; resume opens the existing draft.

The journey clears the template with native selection/typing, chooses Checklist with the pointer, and types immediately. Require text to appear beside the checkbox, not below it. Enter must create an unchecked item whose empty text area accepts a pointer click after focus leaves the editor. Backspace deletes text normally; at an item's start it unwraps while preserving text, and undo restores the task. Enter on an empty item exits to a paragraph. Keyboard formatter selection and the editor's typed `[ ] ` shortcut reach the same behavior. Autosave, renderer reload and a post-exit read-only SQLite query must preserve the document and checked state.

Inspect `run.json` for `passed: true`, `exit: 0` and `cleanup.removed: true`. Retain numbered screenshots, actions, trace, `inserted-dom.json`, `saved-body.json` and `persisted-drafts.json` in the printed evidence directory. This proves renderer reload and durable storage, not a full process restart or external publishing.

### Other writing paths

Preconditions: `pnpm build`. `pnpm smoke` runs `tools/desktop-smoke.mjs` against temporary repositories and an isolated profile. It drives real writing before explicitly switching to the sample workspace. Use the existing source as the executable journey and keep its real/sample phases distinct.

- **Start:** `[aria-label="Open journal"]` creates or resumes the weekly draft. `[aria-label="Journal breadcrumb"]` returns to the hub. The legacy smoke's no-draft-created expectation predates the hub's automatic writing start; the checklist journey observes the current behavior.
- **Type/save:** focus `[aria-label="Journal body"]`; `webContents.insertText('The draft survives a restart.')` exercises real input. Wait for a real IPC draft result containing that text, reload the workspace, and require the rendered text to survive.
- **Recovery:** the existing harness injects a newer recovery record as explicit fault setup, then reloads and observes recovered text. This is recovery coverage, not user input.
- **Citation:** the sample phase inserts an activity citation and tests detached reference behavior. Repeat citation in real fixture mode and verify the saved body for a real-persistence claim.
- **Evidence:** capture before typing, after input, save status, post-reload body, the resulting IPC body, and an independent post-exit SQLite read. Extend the diagnostic's current console-only evidence before accepting a changed writing path.
- **Other entries:** explicitly drive workspace `Start this week` and resume an existing draft too; the hub-start result alone does not establish those entry points.

## Gotchas

Run `pnpm verify publishing` after a build for Notion publishing feedback. This journal-only Electron fixture uses the real preload, IPC, publishing adapter, encrypted fixture credential and store with simulated Notion HTTP. Publish must show `Published to Notion` and change the header action to `Update in Notion`. Edit using native text input, update the same page, and require `Updated in Notion`, one page creation, and update requests. Reload preserves the update label. A simulated 403 must show recovery without a success toast. The runner independently checks persisted writing and retains screenshots, HTTP bodies, actions, process exit and cleanup. It makes no live Notion requests.

The diagnostic's reload keeps the main process alive; it is not a full process restart. Its historical assertion names do not strengthen that proof. A full-restart persistence claim requires closing and reopening the same disposable profile. Sample-mode Publish is simulated. Real Notion publishing requires an authorized test destination and is outside this local journey. Keep the existing autosave/race/editor behavior tests while these gaps remain.

## Workspace clipboard journey

Run `pnpm build`, `pnpm verify doctor`, then `pnpm test:e2e workspace-clipboard`. The journal-only Playwright scenario owns clipboard behavior; it creates no repositories and uses no integrations.

The journey starts from hub Open journal, types bold body text, copies and cuts through the mouse menu, undoes the cut and pastes the rich text. It cuts/pastes the title, checks Shift+F10, keyboard selection and Escape focus restoration, then copies selected Activity heading text with Cut/Paste disabled. Outside press closes the menu; reduced motion retains keyboard access. Reload and an independent post-exit SQLite read must retain the title and both bold text copies. In the selected-text menu screenshot, verify separate Arc keycaps for Ctrl and X/C/V aligned at the trailing edge. Keep the named screenshots, persisted-drafts.json, trace, actions and successful run.json with cleanup evidence.
