# First-time journal setup

Run `pnpm build`, `pnpm verify doctor`, then `pnpm verify onboarding`. Run the distinct inline-completion case with `WEEKLY_J_VERIFY_ONBOARDING_INLINE=1` and the same verification command. Both use the managed runner's disposable profile, source capture, persistent evidence and cleanup contract.

The scenario owns first-run setup. It reuses the connection harness's simulated provider HTTP, hosted OAuth handler, loopback callback, browser and avatar boundaries. The renderer, preload, IPC, vault, SQLite and localStorage are real. It creates one empty Git repository only for the import step; the native folder picker returns that owned fixture. It performs no live authorization or publishing.

## Entry points and outcomes

1. Fresh hub: two-step Arc checklist replaces the entire overview. Real stats, chart, activity/repository sections and footer are absent until dismissal or completion. A static activity preview below the checklist shows a readable heading/explanation and faded, aria-hidden inert timeline/repository shapes; it contains no fake records, actions, busy state or looping animation. The writing CTA still opens the real workspace, and returning through Hub preserves onboarding.
2. Connect accounts: opens Connections directly. Closing or reloading without authorization leaves progress at zero. One provider remains incomplete; both providers complete the account step.
3. Import repositories: opens Repositories directly. Select and import the discovered fixture through the real Settings review. Merely opening Settings never checks a step.
4. Hide/Show checklist: collapse only the body and leave its heading and progress visible. The hidden body is inert, and stats and the header trigger remain absent. Show restores steps through keyboard activation. A separate 32px Dismiss setup button follows Hide with a divider; its tooltip appears on hover/focus. Dismiss works while collapsed, restores stats and Continue setup, and survives reload. The popover omits Dismiss setup but retains Hide/Show. Escape restores trigger focus, and actions transfer into Settings without stacked overlays.
5. Completion: both steps remove onboarding and its header trigger, restore the entire overview, and survive reload and a later fixture-command disconnect. The inline variant keeps the completed card behind Settings until the dialog closes, then reveals stats and activity; the default completes from the dismissed/popover path.
6. Existing profile: after establishing a populated profile, remove only the onboarding preference as an explicit migration precondition. Reload shows stats and records existing-user status.

Use `tools/onboarding-journey.mjs` for actions and assertions. `tools/connections-smoke.mjs` owns provider fixtures. Keep existing connection/import recipes as owners of their detailed failure and recovery behavior.

## Evidence

Require `run.json` with zero exit, `passed: true`, `cleanup.removed: true`, and `evidenceRetained: true`. Inspect the numbered PNGs, `actions.jsonl`, `doctor.json`, `layout.json`, `contrast.json`, `header-actions.json`, `http-requests.json`, `preferences.json`, `persisted-repositories.json` and `journey.json`. Preferences must report completion before the migration precondition changes them. The runner independently queries SQLite after Electron exits to confirm the imported repository remains tracked.

Layout captures cover real 320, 390, 768, 1024 and 1440px viewports in both themes, reduced motion, 200% zoom, and the narrow popover. Windows scaling may round 390px to 391px; fail if the renderer differs by more than 2px. The preview fits every viewport, omits its decorative sidebar at narrow widths and stays visible when the checklist body collapses. It is absent from the header popover and is removed on dismissal/completion. Wide active steps must place their action to the right of their copy; narrow cards must stack the action below the description. Header measurements must prove a separate 32px dismissal target. Rendered checklist text/background pairs must meet 4.5:1 in both themes.

`header-geometry.json` measures icon button width and height on first launch, after Continue setup appears, and in the 320px resumed popover. The default journey requires square icon controls within 0.5px at each entry point; the taller text trigger must not stretch its siblings. The inline variant checks the initial header only.

For a dirty revision, apply `source.patch`, copy `source-files/` onto the checkout, restore `onboarding-smoke.mjs` to `tools/connections-smoke.mjs`, `onboarding-journey.mjs` to `tools/`, and `verify-runner.mjs` to `tools/verify.mjs`. Then install, build, and repeat the recorded command. Evidence stays under `.ai-docs/verification/onboarding-*` after scratch cleanup.


## Reveal motion

Run the default and inline variants with normal motion. Also set `WEEKLY_J_VERIFY_ONBOARDING_REDUCED=1` for an isolated reduced-motion default journey (provider names remain unchanged). The default journey includes a keyboard-dismissal subcase, then explicitly resets only its profile-local onboarding preference to test native pointer dismissal independently.

Require `dismiss-motion.json` for default journeys and `completion-motion.json` for inline completion. The normal default also retains `keyboard-dismiss-motion.json`. Each trace samples real rendered opacity, transforms, layout coordinates and animation properties every frame. Require intermediate fade frames in pointer/automatic reveals, no layout drift beyond 1px, only transform/opacity animations, an inert outgoing card, no translation in reduced motion, and no entrance or exit animation for keyboard dismissal. The preview shares the outgoing setup panel and its 120ms exit; it has no independent idle animation. The two overview regions reveal after the 120ms card exit, with 240ms entrances and a 35ms stagger in normal motion; reduced motion removes the stagger and translation and keeps 160ms fades. Populated-profile and already-dismissed reloads remain static.

Inspect `reveal-in-flight.png`, `reveal-entering.png`, the initial clean setup screen, and the resumed popover. A final screenshot alone cannot establish motion quality.

## Disclosure text stability

Run `pnpm verify onboarding-disclosure` after building. This focused journey uses an empty journal-only profile, without importing repositories or authorizing providers. It closes and expands a step, then hides and shows the checklist. Require monotonic description travel, stable heading/description spacing and text geometry within 0.25 CSS pixels, and no scroll drift. `disclosure-motion.json` retains per-frame measurements.

The regression also freezes nine fractional checklist heights across one CSS pixel and captures the actual paragraph through Electron's native screenshot API. Require text-ink centroid drift relative to its line box below 0.35 physical pixels. DOM geometry alone missed the original whole-pixel glyph repainting. Inspect `description-0.png` through `description-8.png`, `disclosure.png`, and the raster metrics; require zero exit, `run.json.passed`, cleanup and retained evidence. The runner independently confirms zero stored repositories.

For reproduction, restore `onboarding-disclosure-journey.mjs` beside `onboarding-journey.mjs` along with the source files and runner described above. Keep this scenario as the owner of disclosure raster stability; the full onboarding journey owns responsive layout, reveal, completion and persistence.
