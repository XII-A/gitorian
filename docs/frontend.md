# Frontend conventions

Install Node.js 22.19 or newer and pnpm 10.24.0 (the version pinned in `package.json`), then run `pnpm install --frozen-lockfile`. Use `pnpm check` for validation and `pnpm build` for a production build.

The hub and writing workspace share Arc's semantic tokens and installed components. Import `components/arc/foundation.css` once in `src/renderer/src.tsx`. Keep page styles in the renderer's page stylesheet; use documented component props and layout classes rather than targeting CSS module internals.

Run development through `pnpm dev`, which watches both the desktop backend and preload modules. Shared command-schema changes must rebuild and restart the backend alongside renderer updates; otherwise newly added UI commands can fail with an invalid discriminator from the older running schema. When changing the development launch command, restart an already-running dev session once to pick up the new watcher.

`pnpm smoke:dev-reload` exercises this through an isolated Electron IPC fixture: folder import initially fails against the old command schema, then becomes accepted after the shared schema changes and the development backend automatically restarts. `pnpm smoke` covers folder selection and actual repository discovery.

## Disclosure and feedback

Do not use native `<details>` or `<summary>` elements anywhere in renderer UI. Their browser-default marker and presentation do not follow Arc. Use the installed Arc `Accordion` (or the shared `Disclosure` wrapper) for expandable sections, `Popover` for optional content opened by an icon, and `Tooltip` only for short, nonessential hints. Do not imitate these components with custom disclosure markup.

Keep raw HTTP, Git, and exception diagnostics out of user-facing error states. Show what failed, a useful explanation, and the relevant recovery action. Import results may list affected folder paths and understandable reasons; internal error payloads do not need a disclosure or tooltip.

A diff load failure belongs inside the Diff tab as a centered, borderless Arc `EmptyState`: a plain error icon, title, optional explanation, and recovery actions. Do not add an Alert card above the tabs or wrap the state in another bordered panel. Loading, failure, unavailable evidence, confirmed empty changes, and loaded changes are mutually exclusive. Show an empty-diff message only after a successful response confirms empty changes. Preserve cached changes on refresh failure with a compact notice inside the tab. Details and Related stay usable.

The local Arc `EmptyState.iconVariant="plain"` extension removes the icon frame for pane states; the default remains `"framed"`. Keep layout styles on the pane wrapper rather than overriding component internals.

Background source warnings use a short one-line toast title and a `Review` action. The notification viewport may be wider on desktop but must stay within the viewport on phones. The local toast-stack responsive breakpoint moves actions below the copy at 24rem or narrower, keeping source-warning titles on one line on phones. Never truncate the title or force overflowing text to stay on one line.

## Corner radii

The radius definitions live in `src/renderer/components/arc/foundation.css`. Use these tokens for new UI and keep their values shared across pages.

| Token              | Value  | Use                                                     |
| ------------------ | ------ | ------------------------------------------------------- |
| `--radius-key`     | 4px    | Keyboard hints and tiny code affordances                |
| `--radius-inset`   | 12px   | Small nested list items                                 |
| `--radius-control` | 18px   | Activity rows, buttons, inputs, selects, and tab groups |
| `--radius-panel`   | 26px   | Popovers, menus, and bordered panels                    |
| `--radius-surface` | 34px   | Large contained hub surfaces and dialogs                |
| `--radius-pill`    | 9999px | Small activity filter chips and their project select    |

Do not redefine these tokens for an entire page. A filter chip may locally set `--radius-control: var(--radius-pill)`. Nested controls should follow Arc's concentric inset radii. Full-width pane boundaries stay square and share dividers; they are not floating cards.

## Activity lists

The hub, workspace, and related activity use `ActivityRow`: connected timeline nodes, a title, repository and branch metadata, an Arc status badge, and a short SHA or pull request number. Connect nodes only within each visible group. Rows have a borderless rounded hover/selection background. Preserve native button behavior, workspace selection, and citation dragging. The installed Arc `Badge` has a local `animateChanges={false}` option for static records, keeping long lists free of per-row motion and resize observers; changing status controls retain the default animation.

Pull references display only the trailing number from real `repository-id:pr:number` IDs or sample `sample/pr/number` IDs. Bound the trailing column so the title and metadata retain priority. Each row draws its own incoming connector; hover and selection use the stronger border token so row backgrounds cannot hide the timeline.

`ActivityHover` moves one shared background between rows using Arc's morph spring, including across day groups. Pointer movement updates motion values without rerendering the activity records. Leaving the list or scrolling clears the highlight; resizing and filtering update its bounds. Keep the highlight noninteractive, preserve selected-row backgrounds, and snap motion when reduced motion is requested.

Timeline hover contrast travels with the background. A noninteractive SVG mirrors the connector and node borders in two paths (neutral and merged), clipped by the background's shared motion values. Only the portion covered by the moving background brightens, with no delayed per-row hover state. Measure paths on layout changes, not animation frames; preserve gaps between day groups and merged status colors.

Closed ghost `MorphSelect` controls use the same hover surface and foreground as Arc ghost buttons, with no pointer-hover border. Expanded menus retain their border.

The shared diff viewer uses `ChangedFilePicker`: an Arc `MorphSelect` search surface containing Arc `TreeView`, with compact single-folder chains, filename wrapping, full-path titles and a visible selected path. Search matches the whole path and expands matching folders. Selecting a folder only expands it; selecting a file changes the diff and folds the picker. Deleted files use their original paths, and renamed files use their new paths.

Local Arc extensions: `MorphSelect.renderTree` receives `{ id, query, selected, select, close }` and changes its popup semantics to a tree; search navigation transfers focus into the tree, Escape restores trigger focus, and Tab can move between the search and tree. `title` and `maxTriggerWidth` support bounded toolbar labels. `TreeView` adds `id`, controlled `selectedId`, `TreeNode.title`, a `plain` variant, `wrapLabels`, `animateExpansion`, and `onEscape`. The embedded picker disables row size animations so the morph surface alone animates expansion, and uses semantic colors. Keep the tree's native keyboard navigation and the Arc scroll area. Bound the open surface to the diff pane's available width and height in the workspace and pop-out. Global app shortcuts treat focused trees like other composite controls.

## Writing workspace

The workspace has one layout: activity, writing, and inspector. It fills the viewport below its main header. The header uses Arc `Breadcrumb`; its Journal crumb returns to the hub. Equal outer grid columns center the date picker independently of the side controls. Desktop header padding is 8px vertically; at narrower widths the date moves into its own centered row. Below 1100px the inspector moves beneath the writing pane, and phones stack the panes with useful minimum heights. Preserve a readable writing measure inside the full-width pane.

Publishing is rendered into the last main-header slot by `WorkspaceDraft`, so autosave, publishing, and their pending state share one owner. Opening the workspace resumes its latest unfinished draft for that week, or offers to start a new entry if there is none. Published entries are not opened for editing. Creating another entry never overwrites a published entry.

Notion connection guidance belongs in the writing footer, keeping the editor clear. Offer the settings action when the connection or publishing destination is missing, while leaving local writing available. Citations update the entry without a main-header success banner.

Keep word count, save status, and the Notion action in one footer row, with the status centered between equal outer columns when space allows. Only writing panes 460px or narrower stack the count and status beside the settings action. Use a pane container query, since the writing pane can be narrow within a wide window.

Keep sample state separate from real commands. The workspace header has no sample-data switch. Retain `workspace-sample.ts` and the explicit `?workspace=true&data=sample&week=2026-10-05` preview URL for design iteration and smoke tests; normal workspace navigation uses real data. Sample publishing is simulated. Detached reference windows remain read-only and send citations to the editable main workspace through the existing channel. They have no note form; citation results appear in the inspector footer.

Use Arc `ScrollArea` for constrained activity, writing, diff, details, related-item, and popup lists. Name each viewport for keyboard users. Native text controls and the whole document retain native scrolling.

Search uses Arc `ExpandingSearch` to navigate weekly activity, including across the active list filters. Selecting a result opens its Details tab. Its local `expandedWidth="container"` option fills the header's available width and follows pane resizing.

The hub and workspace share `ProjectFilter` and `ActivityChart`. The project chip follows the activity-kind chips and uses Arc `MorphSelect` with search always enabled, an “All Projects” option, and the selected project name. The installed component has local `variant="ghost"` and `size="sm"` options for toolbar chips, and an Arc `ScrollArea` inside the expanding list. Keep the activity pane overflow visible so the list can expand over its neighboring pane. Daily counts are computed once for each activity list rather than formatting every activity date on each pointer movement.

Hub activity details own their selection and request state in `HubActivityDialog`. Load details into that dialog directly so opening it does not rebuild the whole hub activity list. Keep its height stable, header and footer fixed, and content in a named Arc `ScrollArea`. Arc `DialogContent` supports `backdrop="dim"` for large data views to avoid repainting a full-page backdrop blur; other dialogs keep the default blur.

The daily activity preview uses Arc `BarChart` with three local, typed extensions: `compact`, `onActiveChange`, and `onDatumSelect`. Its small Arc popover follows the pointer, or the selected bar when using the keyboard. Show counts for commits, PR activity (including opened and merged events), and reviews; do not list individual activities here. The read-only summary must not intercept pointer events or extend its visibility when hovered outside the chart. Enter, Space, and tap also reveal counts. Keep the reduced-motion behavior and stable date keys.

Arc `Select` supports a local `variant="ghost"` for filter chips and `contentMinWidth` for wider menus, constrained to the viewport. Options can include a numeric `count`, displayed separately from the label with `--space-2` (8px). Filter chips share medium weight and `--leading-body`, so selects align with buttons. Omit the visible label for an icon or inline chip only when it has an accessible name.

The project chip follows PRs & reviews, shows the available project count at rest, and shows the selected project name when filtered. The Filters chip is icon-only and opens deliberate branch/history loading. Feature collection, definition, grouping, and filtering are outside the app scope. The shared model, backend commands, details controls, and sample data no longer contain feature groups.

Arc `TabsList` supports a local `edgeToEdge` option: the strip spans its pane with square outer corners while individual tabs retain their shared control radius. Related items reuse the activity row styles. Both writing and inspector footers use `--workspace-footer-height` (64px).

## Settings

Keep settings layout in `src/renderer/settings.css`. Preserve the compact 850px by 720px desktop dialog, its control radius, header padding, muted save footer, and vertical Arc tabs. Both navigation and content use Arc `ScrollArea`; the content viewport fills the available height. Avoid adding settings overrides to the legacy desktop stylesheet. Fields use a two-column grid that becomes one column on phones; connection actions share a wrapping row. Keep descriptions to the information needed to make a decision.

Repository setup chooses a parent folder through the native picker and discovers Git working trees recursively. Skip links, dependency folders, and repository internals. Existing repositories are deduplicated by canonical path; resuming tracking preserves their identity and history. Comparison bases come from local and remote refs. Tracking uses an Arc switch and applies with the other repository settings on Save. The locate-folder button has a secondary background. Branch-specific overrides are not exposed in settings; retain existing backend values when saving a repository.

Repositories use independently expandable Arc `ExpandableCard` components, keyed by repository id. Show the repository name and its full folder path in the card summary, with long names and path segments wrapping inside the card. Keep every card initially closed and preserve native disclosure keyboard behavior. Arc `SearchField` filters repository names and paths without changing the settings being edited. Its local `hideLabel` option keeps the search name accessible without displaying a heading above the input.

Pass repository fields as an `ExpandableCard` render function to defer mounting until the first expansion. Details stay mounted after that so closing preserves input state and reversing an animation remains smooth. Settings uses the dim dialog backdrop to avoid repainting the hub through a blur. The expanded repository layout starts with tracking and locate-folder controls, followed by history/comparison fields, fetch activity, remote, and author emails. Author emails use Arc `MultiSelect` with the local `wrapValues` option and a separate add-email popover. Its options are portaled into an Arc popover with a named scroll area to avoid card clipping.

Folder import reports selection, discovery, and completed/total processing through the preload's `onRepositoryImportProgress` subscription. Unsubscribe when settings unmounts. Animate and announce the button's real progress labels through the Arc button. Do not duplicate progress in the settings footer. Use `aria-busy` rather than the button's `loading` prop here: its loading presentation hides the text behind a spinner. Cancelled selection restores the idle action without an error.

`ImportProgressLabel` keeps progress copy stable and animates each changing number with tabular numerals. The import button uses the Arc stacked content slot so long labels wrap in narrow settings columns. Announce the current numbers once; hide outgoing animated numbers from assistive technology.

Connected GitHub settings show the avatar and username followed by Arc `ConfirmMorph` with `confirmMode="hold"` and `tone="danger"`. Return the real disconnect promise so failure and retry stay in the control. On narrow layouts the question stays available to assistive technology while the visible confirm/cancel controls fit in the settings column.

`GitHubSignIn` expands the sign-in pill into one surface containing the selectable device code, Arc `CopyButton`, and browser/cancel actions. Keep OAuth setup guidance beside the client ID. Measure content at its final width and animate the enclosing surface with Arc's smooth spring so text never stretches; reduced motion snaps directly to the new state. Clipboard failure leaves the code available for manual selection. Expiration and request errors offer an inline retry, and cancellation ignores late responses. Move focus to copying, retry, or the restored sign-in action as the flow changes. After authorization, briefly confirm the account in place before refreshing and focusing the connected account controls. Device codes, polling intervals, and authorization results come from the existing GitHub commands.

Use the Arc searchable `Combobox` for timezones. Its option list lives in a portaled Arc popover with its own named Arc scroll viewport, so opening or selecting a timezone cannot enlarge or scroll the settings pane. Keyboard navigation scrolls the options viewport. The date picker opens beside its trigger in short desktop windows to keep the whole calendar visible. Retain its normal below-trigger behavior on tall windows and phones.

Center side-placed date pickers vertically beside their trigger at desktop heights up to 820px. The calendar and footer share a named Arc `ScrollArea` bounded to Radix's available popup height, retaining access in very short windows without a native scrollbar.

The Combobox uses Motion for its popup animation. Disable the inherited Arc Popover CSS transition and animation on that menu, as on the date picker, so transforms have one animation owner. Use Arc `NumberField` for refresh intervals, bounded to 0–1440 minutes; 0 disables background refresh. Its width follows its grid column through the documented `--number-field-width` token.

The template, writing workspace, and entry history use the same structured Tiptap editor and shared journal typography. Enter creates a paragraph block; Shift+Enter inserts a hard break. The slash menu includes headings 1 through 4, toggles, lists, checklists, quotes, and code blocks; inline backticks format code. Notion receives toggles, heading 4, and inline code natively. Its single editor card has an undo/redo header and word count, without an HTML/Markdown output panel. New drafts clone the saved template, so editing a draft cannot change the template or existing entries. Keep saved document nodes intact, including checklists and underlines. The slash-menu "Use entry template" command inserts the saved template at the caret as one undoable edit, preserving surrounding writing. Formatting options use compact icon-and-label rows; keyboard selection scrolls only the option viewport. Toggle chevrons rotate inside a fixed button box using shared motion tokens, with reduced motion respected. Backspace at a toggle summary or first body paragraph unwraps its content without discarding writing; empty toggles also support Delete. Autosave waits one second after typing, checkpoints at least every five seconds during continuous typing, and flushes recovery storage and the local save on navigation. Publishing problems belong in actionable Arc toasts, outside the document. New Notion pages contain only the user's writing; recovery uses a checkpointed page ID or a unique complete match after a lost creation response.

Keep unchanged record references when reconciling IPC snapshots, retain snapshot-version and restore guards, and schedule incoming snapshots as transitions. The workspace activity list and rows are memoized against their actual inputs. Activity hover geometry responds to list DOM/layout changes and scrolling; restrict computed connector styles to visible rows. A draft save or a background progress update must not trigger a synchronous full-list geometry pass. Use `tools/workspace-writing-preview.ts` to exercise sustained typing across save checkpoints and background polling with an isolated 600-activity, 200-paragraph fixture.
