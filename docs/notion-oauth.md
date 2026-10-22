# Notion connection

weekly-j uses a public Notion OAuth connection. After browser approval, users select an accessible page by name or choose **Create a new page** in the same connection control. **Confirm** validates and saves the selection, or creates the named journal page. Only then is Notion connected. Settings shows the selected page name/icon beside a pencil edit action and Disconnect. Local writing never requires Notion.

## Workspaces and modules

The root pnpm workspace is the Electron app. `services/notion-oauth` is the hosted Effect module, with a local Node HTTP adapter and a Netlify adapter over the same request handler. `src/main/notion-connection.ts` owns desktop authorization, loopback listener lifetime, credential rotation and the journal checkpoint. `src/main/notion.ts` owns Notion content and private journal preparation. The renderer sees connection state and a browser URL, never provider tokens.

The hosted HTTP interface has five routes:

- `GET /health`: confirms that the configured handler can load. It does not contact Notion or validate live credentials.
- `GET /authorize`: accepts a loopback port, random desktop nonce and SHA-256 verifier challenge; signs them into state valid for ten minutes and redirects to Notion.
- `GET /callback`: verifies signed state and returns Notion's temporary code or denial to the exact numeric loopback address and nonce path.
- `POST /token`: verifies the desktop verifier and exchanges the temporary code using the server-held client secret.
- `POST /refresh`: exchanges a user-owned refresh credential using that same registration and rotates both tokens.

The desktop binds only `127.0.0.1` on an ephemeral port. Cancel, a replacement attempt, expiry and shutdown close its listener. Late exchanges and refreshes cannot overwrite a disconnected account. Responses disable caching and referrer propagation; credentials never travel in redirects. Notion's single-use authorization code provides exchange replay protection. The helper never stores customer credentials and never receives journal text or images. Refresh credentials necessarily pass through it during refresh. Hosting providers may retain HTTP request metadata, so do not enable query-string or body logging for these routes.

Authorization and page discovery remain in memory until confirmation. Cancel or closing Settings discards unconfirmed credentials without creating a page. Page discovery follows all search cursors, builds a named page tree from parent relationships, and searches page names with their ancestor context. Clicking a chevron expands a parent; clicking its name selects it. IDs remain internal and no Refresh control is shown. The old destination ID and standalone test controls are removed.

Explicit confirmation owns its operation even if Settings closes. Before creating a page, the desktop persists encrypted setup intent outside journal backups. The parent page contains a setup marker; a lost creation response is resolved only by a unique exact marker match. If no match can be confirmed, setup stops instead of creating another page. Retry keeps the choice; Back allows a different existing page. A later authorization to the same workspace resumes an uncertain confirmed creation. Published entry pages still contain only the user's writing. Existing page selections are validated without ever falling back to page creation. Changing a destination updates the saved page name/icon; the OAuth app profile is not displayed.

Ordinary content requests retain the existing `2025-09-03` Notion version; private page preparation explicitly uses `2026-03-11`. Authentication rejection can refresh credentials and retry once; uncertain writes are not automatically replayed.

## Local development

1. Create a separate public **development** Notion connection. Register `http://localhost:8788/callback` as a redirect; Notion rejects IP addresses in registered redirect URIs. The desktop's separate temporary return listener still uses `127.0.0.1` internally. Request Read content, Insert content and Update content. Use a disposable workspace for development writes. If Notion's registration policy requires HTTPS for your registration, expose the local adapter through your own HTTPS tunnel, set `NOTION_OAUTH_ORIGIN` in the shell before `pnpm dev`, and register that matching origin/redirect; do not use production secrets locally.
2. Copy `services/notion-oauth/.env.example` to `services/notion-oauth/.env.local`. Fill in `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET` and a randomly generated `NOTION_STATE_SECRET` of at least 32 characters. The example includes a local generation command. These files are ignored; never paste secrets into issues, logs or screenshots.
3. Run `pnpm install --frozen-lockfile`, then `pnpm dev`. The root command starts the OAuth adapter and Electron with backend/preload watching, waits for local startup, and closes its own process trees when either child exits. Restart the command after changing local credentials. The default development profile is `.ai-docs/development-profile`, separate from installed journal data; set `WEEKLY_J_DEV_PROFILE` to choose another.
4. Open Settings → Connections → Notion → Connect. Approve the development connection, return to weekly-j, select a page or create a named journal, and click Confirm. Check the selected page name and icon in Settings. Use a disposable draft if testing publishing.

`pnpm smoke:dev-launch` verifies the real root development launcher, local handler health/redirect, isolated SQLite creation and shutdown of both children when the OAuth child exits. It retains a run record and logs under `.ai-docs/verification/dev-launch-*`. `pnpm dev:oauth` runs only the local module. The default port is 8788; `NOTION_OAUTH_PORT` changes it and requires updating the registered redirect. An unconfigured adapter stays available with a 503 setup response, so developers can still run the editor and GitHub features. This never simulates a successful Notion connection.

The public production origin is embedded into the main process with `MAIN_VITE_NOTION_OAUTH_ORIGIN` at build time. The development launcher supplies `WEEKLY_J_NOTION_OAUTH_ORIGIN` only for unpackaged runs. A normal production build without a configured origin leaves sign-in unavailable; release packaging validates the origin and fails rather than distributing a nonfunctional connection.

## Production setup and release deployment

Create one Netlify project for this repository. Disable automatic Git production deploys so GitHub releases own production changes. Keep the default provider hostname initially; a custom domain is optional.

Configure these **Netlify Functions runtime environment variables**:

| Variable               | Value                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| `NOTION_OAUTH_ORIGIN`  | Exact production HTTPS origin, without a trailing slash            |
| `NOTION_CLIENT_ID`     | Public production connection client ID                             |
| `NOTION_CLIENT_SECRET` | Production connection client secret                                |
| `NOTION_STATE_SECRET`  | Random secret of at least 32 characters, stable across deployments |

Register `<NOTION_OAUTH_ORIGIN>/callback` in the production Notion connection. Choose **Any workspace** installation scope for the distributed application. Configure the connection's product, privacy and support information; Marketplace listing is optional. Secret rotation invalidates in-progress signed states, so users may need to start sign-in again.

Configure the GitHub repository:

- Repository variable `NOTION_OAUTH_ORIGIN`: the same production origin used by Netlify and the desktop installer build.
- Environment `notion-oauth-production`: allow deployments from release tags. Avoid required human reviewers if releases must deploy automatically.
- Environment secrets `NETLIFY_SITE_ID` and `NETLIFY_AUTH_TOKEN`: the deployment target and an appropriately scoped deployment credential. OAuth client/state secrets belong only in Netlify, not GitHub or the desktop build.

The existing tag workflow still builds and uploads a draft installer. Its build embeds and validates the public origin. Publishing a stable release triggers `.github/workflows/deploy-notion-oauth.yml`, checks out that exact tag, validates the version and main ancestry, runs repository checks, builds the hosted module, deploys its prebuilt Netlify function, and checks `/health`. Drafts and prereleases do not deploy production. Run the first deployment before asking users to connect. The workflow does not provision accounts, set secrets or prove live Notion authorization. Publishing a release automatically changes the shared OAuth module for existing installations too; retain its protocol when evolving it.

## Verification

`pnpm test` includes verifier/state tampering, expiry, denied authorization, refresh, loopback lifecycle, delayed-response cancellation, persisted credentials and uncertain page creation. Tests call the same hosted interface used in production.

After `pnpm build`, run `pnpm verify doctor` and `pnpm verify notion`. The Notion-only Electron journey uses real renderer/preload/IPC/vault/store, a real loopback callback, and the actual hosted handler; it skips GitHub connection actions. Provider HTTP and browser launch are simulated. It checks the flush picker, nested pages, chevron expansion versus parent selection, keyboard selection, name-only labels, search/ancestor restoration, edit/cancel, browser errors, explicit creation, reload and repeated Notion disconnect/reconnect. The narrow/reduced-motion variant is selected with `WEEKLY_J_VERIFY_MOTION=stress`. Evidence is under `.ai-docs/verification/`. Live authorization and publishing require configured credentials and an explicitly authorized disposable destination; simulated evidence does not claim a live Notion test.
