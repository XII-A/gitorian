# Window chrome

Run `pnpm build`, `pnpm verify doctor`, then `pnpm verify window-chrome` on Windows. The runner owns a disposable journal-only profile, removes it after Electron exits, and retains evidence under `.ai-docs/verification/window-chrome-*`.

## Entry points and observable outcomes

- Application icon: the native Windows window icon matches `resources/icon.png` within the documented resampling tolerance. The journey saves `native-app-icon.png` and records the measured difference in `actions.jsonl`. After changing the Paper SVG, run `pnpm icons` before building; verify the packaged executable icon as well as the live window.
- Hub at rest: a 6px frame surrounds the application on every edge, with no visible caption controls or extra page scrolling.
- Top frame: hover at y=5 across the left, middle, and right. The top frame extends 32px with the caption reveal, preserving both rounded content corners below the controls. Verify the mask joins both content corners and capture both light and dark themes; moving through its native drag area keeps it open. Leaving hides it after a grace period; returning cancels dismissal.
- Page zoom: change zoom on the same live window to 1.25x and 0.8x. Hover the last visible caption-button row longer than the hide grace; controls must stay open. Leave and approach the scaled 6px frame near its bottom edge; it must reveal again. Native hover heights use current page zoom, not display scale.
- Caption buttons: the hover/click target fills the complete 38px top frame, ending exactly at the content edge. Pointer maximize updates the restore action, moving away does not pin the bar, restore returns to the original state, and minimize affects the owning window.
- Keyboard: focus Minimize window after Tab. Controls appear immediately; leaving focus hides them. Native hit testing reports caption only while the drag area is revealed.
- Reduced motion: the small frame mask changes position instantly; caption movement is removed, opacity reveals and hides the controls. Retain a screenshot with the bar shown.
- Reference window: opening a detached sample activity keeps the native menu hidden. Its outer frame uses the surface token while the inspector header keeps its normal muted surface. Body, root, and moving mask must share that frame color in light and dark themes; retain `04-reference-frame-*.png`. Closing through its own bridge leaves the main window open.
- Workspace: test 1560px and 1000px widths at 1x and 1.25x zoom using the explicit sample workspace. Approaching the Journal breadcrumb from above keeps navigation clear; the right edge still reveals controls. Resizing with chrome open must not leave native drag bounds over the breadcrumb, and clicking it returns to the hub.

The harness supplies cursor samples at Electron's screen boundary to avoid moving the user's real pointer. Pointer buttons use Chromium input; native Windows hit tests prove drag-region removal. Sample workspace navigation does not claim writing or publishing persistence. Inspect `run.json`, `journey.json`, `actions.jsonl`, stdout/stderr, and the hidden, revealed, and reduced-motion PNGs. Require zero exit, `passed: true`, and `cleanup.removed: true`.

Set `GITORIAN_CHROME_TRACE=1` before the verification command to retain `reveal-trace.json` for three reveal/hide cycles. Compare Paint, RasterTask, and compositor frame events against a baseline on the same machine. Full-page clipping must stay static; only the small frame mask and caption transform/opacity animate. Trace timing is diagnostic and does not prove every device is stutter-free.
