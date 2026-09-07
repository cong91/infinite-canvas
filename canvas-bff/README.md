# Infinite Canvas BFF

The Canvas BFF is the account-scoped HTTP boundary for Infinite Canvas. It verifies a Sub2API dashboard JWT through user-facing Sub2API APIs, issues an opaque Canvas session, owns account-scoped provider/project/asset/generation records and exposes signed media URLs. The Sub2API assertion is retained only in process memory for up to ten minutes so catalog/key selection can be resolved server-side; it is never written to the database, response JSON or logs. The Canvas session itself can remain valid longer, but a fresh SSO handoff is required after the upstream assertion expires.

## Local setup

```text
CANVAS_ORIGIN=https://canvas.example.test
SUB2API_BASE_URL=https://sub2api.example.test
PORT=17372
```

Run `npm install`, then `npm test`, `npm run build` or `npm start` from this directory. The service never accepts a wildcard origin and does not log request credentials.

The current repositories and object storage are in-memory adapters intended for contract tests and local wiring. PostgreSQL, S3-compatible storage and concrete provider HTTP adapters still need deployment-specific selection and implementation before production use.

## Docker infrastructure smoke

From the repository root, run the isolated local stack:

```powershell
docker compose -f docker-compose.bff.local.yml -p infinite-canvas-bff up -d --build
powershell -ExecutionPolicy Bypass -File scripts/smoke-bff-stack.ps1
```

The stack starts PostgreSQL 16, applies the checked-in migrations, creates the `canvas-media` bucket in MinIO, and starts the BFF on port `17372`. It intentionally tests infrastructure and migration wiring only; the running BFF still uses in-memory repositories until the PostgreSQL/S3 adapter slice is implemented. Stop it with `docker compose -f docker-compose.bff.local.yml -p infinite-canvas-bff down`. Named volumes are preserved unless `-v` is explicitly added.
