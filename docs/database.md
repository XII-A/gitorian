# Local journal database

`journal.sqlite` is the release database. It starts from one reviewed Drizzle baseline; the development-only `gitorian.sqlite` file and previous backup formats are not read. Old files are left untouched. Use a disposable profile for development verification.

## Ownership and interface

`JournalDatabase` is the domain interface. Its private `DatabaseWorker` sends named commands to one owning Node worker. Only `JournalEngine` imports SQLite/Drizzle. `DatabaseSync` executes off the Electron main thread. Accepted work drains before shutdown; a failed worker rejects pending work and reopens on the next command. It never blindly replays a mutation whose commit may have succeeded.

Writes use immediate transactions, WAL, foreign keys and synchronous FULL. Every commit advances a display sequence. Restore changes a journal generation; commands carrying the previous generation fail. Drafts additionally use their own expected version, so refresh work does not cause writing conflicts. An identical retry after a lost acknowledgment returns the committed draft. Different stale writing produces a conflict and keeps the renderer recovery copy.

## What is stored

| Tables                                                                | Purpose                                                                                                          |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `journal`                                                             | Singleton generation, sequence, bounded preferences/template and refresh/import status                           |
| `repositories`, `repository_emails`, `repository_branches`            | Tracked sources, author identities and discovered branches                                                       |
| `activities`, `activity_dates`, `activity_branches`, `activity_files` | Queryable activity metadata, PR lifecycle/commit dates, branch state and file statistics                         |
| `activity_revisions`, `patches`                                       | Revision identity and content-addressed patch bodies, loaded separately from lists                               |
| `drafts`, `draft_selections`                                          | One versioned writing document per week and selected evidence                                                    |
| `entries`, `entry_coverage`                                           | Published documents and precisely which activity/revision they cover                                             |
| `publication_attempts`, `publication_selections`                      | Frozen intent before remote dispatch, progress and uncertain-outcome recovery                                    |
| `acquisition_checkpoints`, `acquisition_versions`, `transport_pauses` | Durable source cursor, version identities and provider retry windows                                             |
| `git_history`, `git_history_items`                                    | Reusable author-history index referencing shared activity rows; cached-only activities stay out of journal lists |
| `images`, `document_images`                                           | Validated image bytes and ownership by documents/publication snapshots                                           |
| `__drizzle_migrations`                                                | Applied migration names/hashes                                                                                   |

Rich writing documents, templates, immutable publication destinations, bounded configuration and provider cursors remain JSON because they are naturally nested. IDs, dates, statuses, relationships, selection/coverage and query fields are columns/rows. Images are BLOBs; patch text is stored once per hash. STRICT tables, CHECKs, unique indexes and composite foreign keys enforce storage invariants, including revision ownership and one unresolved publication per draft.

Workspace reads fetch the requested local-date range in pages (500 by default, maximum 2,000), with explicit inspector/reference pins and selected evidence. Draft saves update only the draft row/document references. Journal history has one 50-row cursor/search query merging meaningful local writing with cached publications. Linked local writing replaces its published snapshot before search and pagination. Source-qualified identities distinguish local and Notion records. Deterministic worker-local SQLite functions extract document text and fold locale casing without maintaining a second search projection for drafts; only summaries cross to the renderer. Opening an entry loads its body explicitly through a focused preload read, without rebuilding or reconciling a workspace snapshot. The read is owned by ApplicationWork, checks the calling window/main frame and fences the journal generation before and after storage access. Local body reads omit editing selections. Empty generated date placeholders are omitted, while image-only documents and cleared linked writing remain visible. Full exports are explicit operations, never the autosave path. Acquisition summaries omit the history/version archive from renderer replies.

## Migrations

Edit `src/main/database/schema.ts`, then run `pnpm db:generate --name=<intent>`. The wrapper generates SQL/snapshot files, makes new tables STRICT and defers the two cyclic activity/revision foreign keys until commit. Review the generated SQL: SQLite table rebuilds must preserve these guarantees and foreign keys. Commit both files under `resources/migrations/`; never edit an applied migration. Opening a newer/unknown migration or a modified ledger hash fails before applying journal changes. Packaged builds include migration resources.

There is no released legacy schema to support. The initial baseline may be replaced during this pre-release change; after release, add migrations and verify upgrades against a database produced by the preceding release. Drizzle ORM/Kit are pinned together. The current native Node SQLite adapter requires the Node 24 version in `.nvmrc`; Electron supplies its own runtime.

## Recovery, retention and privacy

Publication intent is committed before HTTP writes. Interrupted pending attempts become unknown on reopen, and block another publication until reconciliation. Confirmation commits entry, coverage and draft linkage together. Notion setup recovery and credentials remain in their existing separate recovery/vault files, never in the journal tables.

Backup format 4 includes provider account/assignment metadata (disconnected on restore), original project identity, documents, relational evidence, captured patches, image bytes and uncertain publication progress. Format 3 is converted only at the import seam. It omits credentials, local repository paths and machine-specific acquisition checkpoints; acquisition restarts after restore and repository reattachment. Restore validates JSON, images and relationships before committing a replacement; invalid input leaves the journal unchanged. Treat backups as private source/writing data. For a full SQLite recovery copy use SQLite's backup facility; copying a live main file alone can omit WAL commits.

Cache collection runs in bounded batches. Selected, covered and publication-linked revision patches remain protected. Unpinned patches expire after 30 days without access. The latest confirmed publication per draft and every unresolved attempt remain; older failed/confirmed attempts expire after 30 days. Imported images are durable user content, including assets owned only by an unsaved recovery copy. Automatic cache collection never deletes them; an explicit restore replaces the image set. Renderer-only recovery caches are not a database backup.

## Verification

Read the [database verification recipe](../.agents/skills/verify-gitorian/features/database.md) and [testing conventions](testing.md). Storage tests exercise real workers and native SQLite, including before/after-commit worker death, stale versions, rollback, migration rejection, restore fencing, image retries and protected evidence. Desktop journeys verify the actual preload and renderer, then independently query the closed database.

## Provider migrations

Provider metadata and preparation records live in `provider_accounts` and `provider_preparations`. Repository account/project fields and activity provenance/canonical keys are stored alongside the existing relational evidence. Applied migrations remain immutable; upgrades preserve activity IDs, draft selections and cached revisions. Legacy PR names are converted at the migration/import seams, and legacy local qualification is retained when supported by local history.

Drizzle executes its migration statements inside a transaction, where SQLite ignores foreign-key toggles. The database owner disables enforcement before entering that transaction to prevent table-rebuild cascade deletion, then restores enforcement. The provider migration set includes an in-transaction `pragma_foreign_key_check` assertion so invalid relationships roll back before commit. Normal application transactions always enforce foreign keys.

Account activation is prepared before a vault write and committed with a captured prior generation/key. Recovery markers retain staged and predecessor keys until cleanup finishes. Disconnect leaves durable cleanup intent before erasing secrets. Restore clears prior provider credentials after validated journal replacement; backups omit vault keys and all secrets.

## Incremental acquisition persistence

`applyAcquisitionBatch` accepts `historyDelta`, not a replacement history snapshot. Evidence delta, current source configuration/generation and continuation checkpoint commit atomically. Membership insertions are idempotent and chunked; immutable Git facts are not rewritten for every later page. Existing full-history reads remain diagnostic queries; acquisition requests metadata only. Branch deletion reconciliation uses an indexed repository subquery only when refs change. Unchanged source metadata avoids activity/date/file/branch rewrites. Prior decisions, revisions and journal associations retain their existing merge rules.

Traversal and pending provider-page state use the existing validated checkpoint JSON, so no table migration or alternate persistence pipeline is introduced. Legacy partial Git offsets restart safely from captured/native tips and stable activity identities. Pending provider pages are bounded and version-specific; incomplete records never establish complete coverage. Closed-database/reopen checks own durable evidence verification.

History range expansion uses keyset pages over `(repositoryId, activityId)` rather than hydrating retained history. Each page reads at most 2,000 metadata rows; the source commits eligible IDs and its next projection cursor together. A failed or unacknowledged Git transaction reloads committed checkpoint state before recording its error, so retry cannot skip rolled-back evidence.
