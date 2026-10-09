# Frontend conventions

The hub and writing workspace share Arc's semantic tokens and installed components. Import `components/arc/foundation.css` once in `src/renderer/src.tsx`. Keep page styles in the renderer's page stylesheet; use documented component props and layout classes rather than targeting CSS module internals.

## Corner radii

The radius definitions live in `src/renderer/components/arc/foundation.css`. Use these tokens for new UI and keep their values shared across pages.

| Token              | Value  | Use                                                      |
| ------------------ | ------ | -------------------------------------------------------- |
| `--radius-key`     | 4px    | Keyboard hints and tiny code affordances                 |
| `--radius-inset`   | 12px   | Activity rows and small nested list items                |
| `--radius-control` | 18px   | Buttons, inputs, selects, tab groups, and other controls |
| `--radius-panel`   | 26px   | Popovers, menus, and bordered panels                     |
| `--radius-surface` | 34px   | Large contained hub surfaces and dialogs                 |
| `--radius-pill`    | 9999px | Small activity filter chips and their project select     |

Do not redefine these tokens for an entire page. A filter chip may locally set `--radius-control: var(--radius-pill)`. Nested controls should follow Arc's concentric inset radii. Full-width pane boundaries stay square and share dividers; they are not floating cards.

## Writing workspace

The workspace has one layout: activity, writing, and inspector. It fills the viewport below its main header. Below 1100px the inspector moves beneath the writing pane, and phones stack the panes with useful minimum heights. Preserve a readable writing measure inside the full-width pane.

Publishing is rendered into the last main-header slot by `WorkspaceDraft`, so autosave, publishing, and their pending state share one owner. Opening the workspace resumes its latest unfinished draft for that week, or offers to start a new entry if there is none. Published entries are not opened for editing. Creating another entry never overwrites a published entry.

Keep sample state separate from real commands. The sample switch supports design iteration; sample publishing is simulated. Detached reference windows remain read-only and send citations or notes to the editable main workspace through the existing channel.

Use Arc `ScrollArea` for constrained activity, writing, diff, details, related-item, and popup lists. Name each viewport for keyboard users. Native text controls and the whole document retain native scrolling.

Search uses Arc `ExpandingSearch` to navigate weekly activity, including across the active list filters. Selecting a result opens its Details tab. The daily activity preview uses Arc `BarChart` with three local, typed extensions: `compact`, `onActiveChange`, and `onDatumSelect`. Its Arc popover opens on hover or keyboard scrubbing; Enter, Space, or tap makes the preview interactive. Keep the reduced-motion behavior and stable date keys.
