# Writing

Start or resume a weekly entry, edit structured writing, cite work, and recover local writing without a Notion connection.

## Sub-features

- `writing.entry`: hub Write and workspace Start this week reach the same editable weekly draft.
- `writing.save`: typing autosaves and survives renderer reload.
- `writing.template`: a new entry inherits the saved template without mutating it.
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

## Gotchas

The diagnostic's reload keeps the main process alive; it is not a full process restart. Its historical assertion names do not strengthen that proof. A full-restart persistence claim requires closing and reopening the same disposable profile. Sample-mode Publish is simulated. Real Notion publishing requires an authorized test destination and is outside this local journey. Keep the existing autosave/race/editor behavior tests while these gaps remain.
