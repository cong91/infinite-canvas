# Infinite Canvas BFF

The Canvas BFF is the account-scoped HTTP boundary for Infinite Canvas. It verifies a Sub2API dashboard JWT through user-facing Sub2API APIs, issues an opaque Canvas session, owns account-scoped provider/project/asset/generation records and exposes signed media URLs. The Sub2API assertion is retained only in process memory for up to ten minutes so catalog/key selection can be resolved server-side; it is never written to the database, response JSON or logs. The Canvas session itself can remain valid longer, but a fresh SSO handoff is required after the upstream assertion expires.

## Local setup

```text
CANVAS_ORIGIN=https://canvas.example.test
SUB2API_BASE_URL=https://sub2api.example.test
PORT=17372
```

Run `npm install`, then `npm test`, `npm run build` or `npm start` from this directory. The service never accepts a wildcard origin and does not log request credentials.

In non-test environments the BFF uses PostgreSQL repositories for accounts, sessions, projects, providers, assets and generations, plus S3-compatible object storage for generated media. In-memory adapters remain available only through explicit test dependencies. Provider HTTP adapters and browser-side remote asset hydration are separate follow-up work.

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
