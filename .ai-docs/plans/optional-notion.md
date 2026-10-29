# Local entries and optional Notion

## Intended end state

Autosaved local writing is a journal entry, searchable and editable across weeks without Notion. Notion is an optional explicit publishing destination; onboarding still requires one GitHub or GitLab account and a tracked repository.

## Product decisions

- No finish/save ceremony. Include meaningful local writing; omit generated date titles with empty text and no images; nonempty templates count as writing. Title-only edits and image-only writing count.
- History merges local writing and cached Notion entries. A local draft linked by publishedEntryId wins over its remote snapshot, including search. Distinct unlinked remote documents remain separate.
- Order by journal date/week, then stable identity, with 50-row cursor pagination. Search title, date and body text, with summaries only; load bodies on selection.
- Older local writing opens its exact stored week for editing, retaining autosave/conflict protection. Remote-only entries remain readable; do not fabricate an editable local copy.
- Hide workspace publishing for never-connected/disconnected profiles, including sample publishing. Remove footer connection prompts. A connected profile without a destination retains an actionable publishing control. Preserve unresolved publication verification and recovery after disconnect.
- Keep Notion in Settings and existing remote links usable after disconnect. No live external publishing during verification.
- Onboarding derives account completion from connections.remote, independent of Notion; existing dismissed/completed preferences remain respected.

## Module design

JournalDatabase owns the history seam: a bounded merged search plus detail read hide local/remote identity and deduplication from renderer callers. Keep publication snapshots and coverage semantics intact. Give history its own document read model rather than weakening the publication Entry model or fabricating URLs. Reuse existing history commands after checking all callers. No compatibility wrappers or parallel history implementation.

## Implementation sequence

1. Review this plan independently and resolve missing decisions.
2. Extend the existing database history query/detail read model, indexed search representation where needed, and restore handling; retain bounded payloads and stable cursors. Cover persistence, search, linked deduplication, empty/title/image documents and pagination at this interface.
3. Wire history preview/edit navigation and local-first copy. Update onboarding completion/copy and workspace publication eligibility; delete obsolete footer styles and props only after searching callers.
4. Update existing owning Electron journeys for disconnected local writing/search/reopen/edit/reload, onboarding with one provider, and publication recovery controls. Update affected feature recipes and README/database docs.
5. Use verify-gitorian and Arc conventions. Run focused checks, then complete pnpm verify:release on final source; retain evidence. Review diff for dead paths and accidental complexity.
6. Commit and push feature branch; create and link a draft PR targeting release/0.1.8, with validation and material limits.

## Verification outcomes

- Never-connected users can write, reload, search old local content, open its exact week and edit with persistence; no publish/footer prompts.
- Empty placeholders are excluded; title-only/image-only entries retained; linked remote snapshots do not duplicate or match stale text.
- Search and cursor pagination cover mixed remote/local data beyond one page without duplicate/missing identities; summaries omit bodies.
- One GitHub or GitLab account completes account setup without Notion; repository step remains required.
- Existing publication and uncertain-result recovery remain usable, without automatic remote writes; cached remote history survives disconnect.

## Review

Independent review completed by a separate agent. Incorporated: namespace local/Notion history identities; deduplicate before search/cursors; keep linked local documents even when cleared; pass exact stored weeks when editing after calendar preference changes; show reader loading/errors; make connected/missing-destination setup clickable; update onboarding journey to prove one account without Notion.

Use deterministic worker-local SQLite text extraction and locale folding with one merged SQL query, avoiding a migration and redundant search projection bookkeeping. Existing substring search also scans; retain bounded summaries and measure mixed-history cost before adding persistence complexity.
