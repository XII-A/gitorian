# Frontend conventions

Use the tool versions and scripts in `package.json`. Follow [coding standards](../CODING_STANDARDS.md) for enforcement and [testing](testing.md) for verification.

## UI conventions

The hub and writing workspace share Arc's semantic tokens and installed components. Import `components/arc/foundation.css` once in `src/renderer/src.tsx`. Keep page styles in the renderer's page stylesheet; use documented component props and layout classes rather than targeting CSS module internals.

Import shared motion values directly from `components/arc/motion-tokens.ts` (or `../motion-tokens` inside an Arc module). Breadcrumb links render native anchors; callback-only navigation renders buttons. There is no app-wide link or image adapter configuration.

The app currently stays in dark mode regardless of the OS appearance. `index.html` sets the startup theme; keep light theme tokens and selectors available for future support. The repository-import journey checks light-platform startup and platform theme changes while retaining dark colors.

Do not use native `<details>` or `<summary>` elements anywhere in renderer UI. Their browser-default marker and presentation do not follow Arc. Use the installed Arc `Accordion` for expandable sections, `Popover` for optional content opened by an icon, and `Tooltip` only for short, nonessential hints. Do not imitate these components with custom disclosure markup.

Keep raw HTTP, Git, and exception diagnostics out of user-facing error states. Show what failed, a useful explanation, and the relevant recovery action. Import results may list affected folder paths and understandable reasons; internal error payloads do not need a disclosure or tooltip.

Use Arc `ScrollArea` for constrained activity, writing, diff, details, related-item, and popup lists. Name each viewport for keyboard users. The hub uses a named full-height Arc ScrollArea. Native text controls and document scrolling outside constrained views retain native scrolling.

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

## State and lifetime ownership

Compute derived values during rendering; use memoization when it avoids meaningful work. Put user-triggered work in event handlers. Effects synchronize with external systems such as browser events, editor subscriptions and preload notifications: declare their dependencies and release subscriptions, timers and resources during cleanup. Keep reactive dependencies visible rather than hiding them in a generic mount-only hook.

Keep persistence, cancellation and stale-result handling with the existing owner. Follow WorkspaceDraft for writing acknowledgments and recovery, and the backend owner map for durable work. A refactor should reduce what callers must know; extracting callbacks into many hooks is not itself an improvement.

## Read before changing a feature

Read the matching sections of [feature contracts](frontend-contracts.md), then select the owning scenario from the [verification feature map](../.agents/skills/verify-gitorian/features/README.md).

| Change                                                                 | Contract                                                                     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Onboarding, app updates, notifications, diff error states              | [Disclosure and feedback](frontend-contracts.md#disclosure-and-feedback)     |
| Timeline, filters, selection, diff picker                              | [Activity lists](frontend-contracts.md#activity-lists)                       |
| Autosave, recovery, clipboard, editor, history, inspector              | [Writing workspace](frontend-contracts.md#writing-workspace)                 |
| Preferences, templates, connection transitions                         | [Settings](frontend-contracts.md#settings)                                   |
| Provider accounts, repository assignment, Hub chart and virtualization | [Provider account UI](frontend-contracts.md#provider-account-ui)             |
| Image imports, captions, lightbox                                      | [Journal images](frontend-contracts.md#journal-images)                       |
| Native file dialog cursor workaround                                   | [Windows cursor visibility](frontend-contracts.md#windows-cursor-visibility) |
| Emoji picker and atlas                                                 | [Emoji rendering](frontend-contracts.md#emoji-rendering)                     |
| Direction, rich clipboard, Notion round trips                          | [Multilingual writing](frontend-contracts.md#multilingual-writing)           |

Notion destination selection is documented under Writing workspace; read it alongside Settings when changing that flow.

## Development

Run development through `pnpm dev`, which starts the local Notion OAuth adapter and watches both the desktop backend and preload modules. It uses `.ai-docs/development-profile` by default, separate from the installed app; `GITORIAN_DEV_PROFILE` can choose another development profile. See [OAuth development setup](notion-oauth.md). Shared command-schema changes must rebuild and restart the backend alongside renderer updates; otherwise newly added UI commands can fail with an invalid discriminator from the older running schema. When changing the development launch command, restart an already-running dev session once to pick up the new watcher.
