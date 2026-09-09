# Infinite Canvas BFF

The Canvas BFF is the account-scoped HTTP boundary for Infinite Canvas. It exchanges a one-use Sub2API launch code through a server-to-server shared secret, verifies the returned dashboard assertion through user-facing Sub2API APIs, issues an opaque Canvas session, owns account-scoped provider/project/asset/generation records and exposes signed media URLs. The dashboard assertion is retained only in process memory for up to ten minutes so catalog/key selection can be resolved server-side; it is never written to the database, response JSON or logs. The Canvas session itself can remain valid longer, but a fresh SSO handoff is required after the upstream assertion expires.

## Local setup

```text
CANVAS_ORIGIN=https://canvas.example.test
SUB2API_BASE_URL=https://sub2api.example.test
SUB2API_CANVAS_BFF_SECRET=replace-with-the-shared-secret
PORT=17372
```

Run `npm install`, then `npm test`, `npm run build` or `npm start` from this directory. The service never accepts a wildcard origin and does not log request credentials.

For a local browser SSO gate, run `npm run dev:browser-sso-fixture` in one terminal and start the Canvas dev server with `VITE_CANVAS_BFF_URL=http://localhost:17374`; the fixture exercises launch-code consumption, session-cookie bootstrap and replay rejection without using a real account token.

In non-test environments the BFF uses PostgreSQL repositories for accounts, sessions, projects, providers, assets and generations, plus S3-compatible object storage for generated media. In-memory adapters remain available only through explicit test dependencies. The persistent runtime starts a recoverable generation worker and uses the Sub2API HTTP provider adapter; authenticated browser sessions hydrate account-scoped projects and media assets from the BFF.

Set `CANVAS_STORAGE_RETENTION_MAX_BYTES` to enable logical media retention. The OVH Compose file defaults this to 40 GiB (`42949672960` bytes). After a successful generation is stored, the worker sums object metadata and removes the oldest Canvas bucket objects until the total is at or below the configured byte cap, deleting matching asset rows as well. The just-created object is protected for that cleanup pass; if it alone exceeds the cap, it remains available. This is an application retention policy, not a filesystem quota.

## Docker infrastructure smoke

From the repository root, run the isolated local stack:

```powershell
docker compose -f docker-compose.bff.local.yml -p infinite-canvas-bff up -d --build
powershell -ExecutionPolicy Bypass -File scripts/smoke-bff-stack.ps1
```

The stack starts PostgreSQL 16, applies the checked-in migrations, creates the `canvas-media` bucket in MinIO, and starts the persistent BFF on port `17372`. Run the adapter integration test after the stack is up to verify data and signed media URLs survive new repository instances:

```powershell
$env:RUN_PERSISTENCE_INTEGRATION = "1"
$env:DATABASE_URL = "postgresql://canvas:canvas-dev-password@127.0.0.1:15432/canvas"
$env:S3_ENDPOINT = "http://127.0.0.1:19000"
$env:S3_PUBLIC_ENDPOINT = "http://127.0.0.1:19000"
$env:S3_BUCKET = "canvas-media"
$env:S3_ACCESS_KEY_ID = "canvas"
$env:S3_SECRET_ACCESS_KEY = "canvas-dev-secret"
npm run test:integration
```

Stop it with `docker compose -f docker-compose.bff.local.yml -p infinite-canvas-bff down`. Named volumes are preserved unless `-v` is explicitly added.
