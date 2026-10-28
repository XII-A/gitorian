# Hub command toast verification

Reproduce: `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm verify doctor`, `pnpm test:e2e workspace-errors`.

Before: release revision 451cb2d, rejected refresh through the existing Electron IPC seam renders the full-width Hub Alert. The new Hub scenario fails its toast assertion. Retained run: `../desktop/runs/1793198919655-6c39c900/workspace-errors-hub-refresh-rejection-and-toast-recovery/` (expected failure, exit 0, cleanup removed).

After: `../desktop/runs/1793199141774-f30ee877/` contains both passed Hub and workspace journeys (Electron exit 0, cleanup removed). Named PNGs above capture failure, pending retry, recovery and original-command retry. Traces, fixture, source patch, doctor, actions and run records remain in that local directory. Fixtures import one disposable real Git repository with a commit; renderer, preload, Git and SQLite are real. Only IPC rejection and a 700ms command delay are injected. Hub setup is dismissed through its control. State polling is rejected across its production interval and stays silent. View retry retains its original command; inspector errors remain inline in the workspace.

Save and conflict ownership: `pnpm test:e2e workspace-errors workspace-save-errors draft-recovery` passed both save and conflict scenarios under `../desktop/runs/1793199014772-8f401bd3/` and `../desktop/runs/1793199117635-6bd075fd/`. The initial command cases exposed a test race (outgoing error text matched before delayed retry completion); the final run above waits for pending feedback to exit and passes both cases. Earlier launcher attempt preceded completed build and failed the doctor; all retained run cleanup records report removed.

Scope: no startup/load presentation changes, live credentials or external publishing. Source-warning ownership is unchanged; no new provider-warning simulation. No schema/storage changes.

Arc review: existing ToastStack API and action/update behavior; semantic styling unchanged, sentence-case recovery copy, stable shared IDs and persistent failure feedback. No component or CSS additions.
`pnpm build`, `pnpm verify doctor`, and required `pnpm check` passed (54 files, 446 tests). Full check output remains locally at `.ai-docs/hub-command-check.log`.
