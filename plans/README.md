# Animation plans

| Plan                                                                        | Severity | Status | Dependencies     |
| --------------------------------------------------------------------------- | -------- | ------ | ---------------- |
| [001 - Coordinate previous entry surfaces](001-coordinate-entry-history.md) | HIGH     | DONE   | Baseline b921add |

Execute 001 first. It combines three confirmed findings sharing one transform/timing ownership problem. The user authorized implementation and subsequent independent review; no separate selection is needed. Keep row switching immediate. Other application animations are outside this focused audit.

Independent review approved implementation `cce6396` after paired-drag feedback was resolved. See the plan execution record for validation and the resize-smoke synchronization correction. The feature and motion are committed on `feat/entry-history-motion`.
