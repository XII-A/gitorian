# Backend modules

Electron assembles `desktopLayer` and owns the single `ManagedRuntime`. IPC commands compose Effects and execute through `ApplicationWork`; fixtures construct the same journal Layers with disposable native adapters. Creating an operation does not execute it.

Follow a command from `index.ts` to `service.ts`, then to its owner:

| Module                    | Owned behavior                                                                                                 | Caller operations                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `application-work.ts`     | Admission, detached work, periodic producers, draining and retryable shutdown                                  | `accept`, `fork`, `repeat`, `drain`, `shutdown`                           |
| `activity-acquisition.ts` | Source admission, fair batches, pause generations, incremental acquisition and checkpoints                     | `refresh`, `startRefresh`, `backfill`, scoped `suspend`                   |
| `activity-records.ts`     | Revision capture, details, caching and local/remote fallback                                                   | `capture`, `details`                                                      |
| `journal-publishing.ts`   | Durable intent, private Notion writes, image progress, uncertain recovery and confirmation                     | `publish(draftId)`, `reconcile(saveId)`                                   |
| `notion-connection.ts`    | Callback attempts, token rotation, staged credentials and durable destination activation                       | Authorization, credential access, `completeJournal`, `refreshDestination` |
| `provider-accounts.ts`    | Provider identity, device authorization, account-scoped rotation, durable activation and repository assignment | `begin`, `complete`, `cancel`, `disconnect`, `resolve`, authorized reads  |
| `remote-contributions.ts` | Repository/account context, provider dispatch and canonical contribution identity                              | Activity acquisition, files, revision capture and commit reads            |
| `github.ts`, `gitlab.ts`  | Provider-specific contribution normalization and revision consistency                                          | Injected authorized read adapter                                          |
| `http.ts`                 | Credential lanes, priority, read retries, sharing, conditional caching and body cleanup                        | `request`                                                                 |

`JournalModulesLive` constructs the acyclic domain graph. `desktopLayer` supplies JournalDatabase, vault, HTTP and connection adapters. `notion-request.ts` shares authenticated provider access with reads, setup and publishing; write recovery belongs exclusively to publishing. Formatting, merge rules, date arithmetic and synchronous SQLite internals remain ordinary TypeScript.

Use `startRefresh` when the desktop needs an immediate acknowledgement: it returns after source admission is visible and application work owns the remaining execution. `refresh` waits for completion. A scoped suspension releases only its own suspension ownership. Restore suspends production and drains accepted work before replacing the database; generation fences reject late work.

Public operations have Effect trace names and named failure unions. HTTP rejection retains `HttpError.status` and `retryAt`; native transport failure retains `TransportError.cause`. Connection, journal validation and local durability failures remain distinguishable. Interruption remains in the Effect cause rather than being converted into a rejection. Native callback adapters may accept broader errors; their owning module normalizes expected failures at its interface while preserving known failure classes and causes.

Provider credential rotation has a shorter critical lifetime: it survives reader cancellation, is coordinated per account, and settles before module disposal. Ordinary broker and provider operations are interrupted when the module closes. Disconnect still fences a late rotation from reinstalling old credentials.

A remote write may commit before its response or checkpoint arrives. Publishing persists intent before dispatch, checkpoints page IDs and replacement/upload progress before resumed mutations, and exposes uncertain outcomes for verification. A failed confirmation checkpoint rolls back provisional local confirmation. Writes must not gain blanket retries.

`shared-requests.ts` owns each shared execution and each reader's interest. Preparation acquires scoped resources under registration; module disposal waits for accepted preparation before closing those resources. One reader's interruption does not cancel remaining readers. Keep admission cleanup in preparation ownership, including the path where execution never begins.

Verification uses the same interfaces as callers. `tests/fixtures.ts` uses `journalLayer`; provider variation belongs in fetch, image and other native adapters. Preserve gated failure/recovery scenarios and the real Electron journeys in `.agents/skills/verify-gitorian`. Do not add a second runtime or a domain Effect-to-Promise-to-Effect bridge to make a fixture convenient.

Storage belongs to [JournalDatabase](journal-database.ts): domain commands, bounded workspace reads, assets, backup and restore. Its private worker owns Drizzle, SQLite, migrations and transactions. Callers never mutate a shared State or flush snapshots. Read [database design](../../docs/database.md) before changing persistence.

## Provider account invariants

GitHub.com and GitLab.com have separate accounts keyed by provider, host and numeric user ID. Usernames are display data. The vault holds token pairs; SQLite holds activation/predecessor keys and account metadata. Prepare before staging, activate with a generation/credential-pointer check, then clean superseded keys. Cleanup failure retains the recovery marker; activation durability failure retains the staged pair. Session-only connections never persist plaintext tokens.

Repository assignment uses verified emails, personal namespace identity and bounded access checks. Explicit overrides survive new connections; Automatic matching explicitly recomputes the choice. Unknown access is not denial. One repository uses one contribution identity. Remote scheduling uses `remote:<repositoryId>` for both providers; Notion publishing remains separate.

Repository settings and native folder updates preserve account/project authority inside the worker transaction. Only assignment and account activation commands change it; changing the remote clears it. Optional assignment fields are written as SQL NULL when cleared, rather than omitted from an upsert.

An activity retains its originating project and stable local ID. Numeric provider project identity takes precedence over path aliases. Current acquisition membership is separate from retained evidence and local Git qualification. Account/remote changes archive former remote-only membership; selections and cached revisions remain reachable. Details use a fresh immutable session lease while preserving original provenance. Both acquisition and details validate the lease/configuration in their database transaction.

GitLab review activity means an authored non-system comment on another author's merge request. It does not imply approval. Bounded all-state reconciliation revisits old MRs and checkpoints within a page; incomplete reconciliation must not claim complete coverage. Diffs unavailable or truncated by GitLab fail capture without fabricating empty evidence.
