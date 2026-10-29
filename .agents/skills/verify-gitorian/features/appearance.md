# Appearance

Run `pnpm build`, then `pnpm test:e2e appearance` with a disposable disconnected profile. `tests/e2e/appearance.spec.ts` owns the 16 coordinated workspace palettes, semantic text/primary-button/control contrast and all three border roles against four surfaces relative to the restored release Original, explicit/platform appearance, reload persistence and screenshots. `tests/appearance.test.ts` owns malformed/missing preferences, ordered durable writes, write failure retention and recovery.

Review transitions manually in real Electron with reduced motion both enabled and disabled. Switch quickly while a dialog is open; check focus, editor content/undo, scroll position and unrelated staged Settings edits. Review hub/workspace decoration, diff/code, Mermaid, portaled controls, charts and lightbox. Screenshot polish and timing are manual findings, not automated timing gates. Preserve evidence under `.ai-docs/verification/` and require the final `pnpm verify:release` run.

The palette journey independently compares Original canvas, panels, text, borders, primary buttons and selection controls with the release OKLCH contract (one sRGB channel of rounding tolerance). Only light muted text is minimally darkened for 4.5:1; status colors retain readability corrections. Original Dark preserves the original sky phase colors and header fade. Original Light retains the phase hues at a brighter exposure for readable header chrome; manually review nighttime reduced motion.

Appearance is immediately saved in `appearance.json` in the disposable profile and is excluded from journal backup/restore. Missing or invalid records default to Dark + Neutral. Never use a personal profile to test failure recovery.


The populated-screen scenario in the same appearance journey owns distinct canvas colors across all eight identities, visible static sky, writer-content preservation through palette changes and initial/live palette synchronization in a real detached reference window. Arc RadioCards previews use shared/themes.ts palette roles for both color-scheme and theme selection; theme cards show circular palette samples for the currently resolved scheme. The local animateChanges extension disables selection movement for keyboard changes. The scheme radio group owns keyboard arrow selection and focus. HeaderAtmosphere updates its current shader through setPalette without restarting its lifecycle.

Review the populated gallery capture under .ai-docs/screenshots/themes/revision for the live shader. Contrast must be checked against tinted surfaces, not neutral assumptions. Status colors remain semantic, and the header fades vertically into the selected canvas instead of being hidden by an opaque overlay.
