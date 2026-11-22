# Connections

Read the parent skill and `docs/testing.md` first. Compile the final application revision before desktop verification. Use disposable profiles; simulated provider responses do not establish live authorization or organization-policy compatibility.

## GitHub and GitLab accounts

Review account setup and repository matching in Settings with disposable fixtures and simulated provider responses.

Observe personal and work GitHub accounts plus a GitLab account connected simultaneously. Device authorization must automatically copy its exact code, retain the manual Copy code control, display its code, handle expected pending errors, and keep attempt cancellation/retry scoped to the correct account. A wrong-account reconnect must explain the mismatch and preserve all identities. Disconnect confirmation identifies the account with `Disconnect @username?`; cached work and drafts survive.

Import owned Git fixtures with distinct local author emails. Unambiguous repositories match automatically without widening author filters. A public repository readable by both GitHub accounts remains unassigned until chosen. Explicit override persists; resetting to Automatic recomputes evidence. Saving an unrelated form preserves the numeric project ID.

The GitLab fixture includes an authored MR, a remote commit and a review-only contribution on an older MR. Verify the original review timestamp, typed parent association, provider labels/links, changed-file metadata, full diff, journal citation, evidence pinning and process-restart persistence. Unavailable diffs must never appear as confirmed empty changes. Held requests across account/remote changes must not commit stale metadata or patches.

Record account assignments, redacted HTTP paths and observed persistence. Review desktop and narrow layouts.

`tests/connections.test.ts` owns the production account module's protocol/lifecycle outcomes: interval/slow-down/expiry, verified identity, renewal after restart, early 401 including text diffs, temporary renewal failure, late disconnect, reader cancellation, isolation between accounts and disposal. It uses real SQLite and injected native transport/vault adapters. The retired singleton GitHub authenticator is not a second test path.

## Notion destination

Run `pnpm verify notion` for the existing journal-only Notion journey. It owns hosted OAuth/loopback callbacks, page discovery/search/expansion, destination selection and explicit creation, cancellation, destination retry, reconnect without duplicate creation, profile/icon persistence, and deliberate disconnect. Git provider setup is not a prerequisite.

Provider HTTP/browser behavior is simulated; the hosted handler, loopback, renderer, IPC, vault and store are real. Preserve recorded request shapes and resulting local settings, page-tree screenshots, actions, exit status and cleanup. Review motion, narrow layout, avatar/destination handoff and keyboard focus manually under the coding standards. External publishing and live browser authorization require separately authorized destinations.

`tests/notion.test.ts` owns setup-marker cleanup: remove only the exact current setup marker after the page-ID recovery checkpoint; failed cleanup must resume against that saved page without creating a duplicate. The transport is simulated; no live Notion page is modified.

## Provider panels

Connections renders persisted provider accounts only. There are no demo fixtures, preview controls or account URL overrides. Use simulated external HTTP/browser behavior to exercise connection states through IPC.

Review dark provider headings, gray account bodies and the secondary Add account background. Empty panels have equal vertical insets without an empty list allocation. Names and metadata truncate on one line with full-value titles while the original inline disconnect morph expands; its prompt ends after the username and question mark. Further narrow disconnect layout changes are deferred. Healthy accounts expose only Disconnect; Reconnect appears only for reauthorization-required identities, with the email retained beneath the username. Explicit disconnect removes the row, including after reload; adding that identity again restores the same account ID and repository assignment while cached activity and drafts remain intact. To review reauthorization, simulate a rejected token and check wrong-account recovery. Add account owns the device-code, retry and confirmation morph in its provider heading. New account rows appear after confirmation.

Avatar initials trim surrounding whitespace and preserve whole grapheme clusters, including emoji sequences, with a person icon for blank names. Failed image URLs retain that fallback.
