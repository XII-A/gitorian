# Window chrome

Run `pnpm build`, `pnpm verify doctor`, then `pnpm verify window-chrome` on Windows. The runner owns a disposable journal-only profile, removes it after Electron exits, and retains evidence under `.ai-docs/verification/window-chrome-*`.

## Entry points and observable outcomes

- Hub at rest: a 6px frame surrounds the application on every edge, with no visible caption controls or extra page scrolling.
- Top frame: hover at y=5 across the left, middle, and right. The top frame extends 32px with the caption reveal, preserving both rounded content corners below the controls. Verify corner hit testing and capture both light and dark themes; moving through its native drag area keeps it open. Leaving hides it after a grace period; returning cancels dismissal.
- Caption buttons: pointer maximize updates the restore action, moving away does not pin the bar, restore returns to the original state, and minimize affects the owning window.
- Keyboard: focus Minimize window after Tab. Controls appear immediately; leaving focus hides them. Native hit testing reports caption only while the drag area is revealed.
- Reduced motion: the frame clipping edge changes instantly; caption movement is removed, opacity reveals and hides the controls. Retain a screenshot with the bar shown.
- Reference window: opening a detached activity keeps the native menu hidden; closing through its own bridge leaves the main window open. The unavailable activity is intentional fixture data.
- Workspace: test 1560px and 1000px widths at 1x and 1.25x zoom using the explicit sample workspace. Approaching the Journal breadcrumb from above keeps navigation clear; the right edge still reveals controls. Resizing with chrome open must not leave native drag bounds over the breadcrumb, and clicking it returns to the hub.

The harness supplies cursor samples at Electron's screen boundary to avoid moving the user's real pointer. Pointer buttons use Chromium input; native Windows hit tests prove drag-region removal. Sample workspace navigation does not claim writing or publishing persistence. Inspect `run.json`, `journey.json`, `actions.jsonl`, stdout/stderr, and the hidden, revealed, and reduced-motion PNGs. Require zero exit, `passed: true`, and `cleanup.removed: true`.
