# Infinite Canvas BFF

The Canvas BFF is the account-scoped HTTP boundary for Infinite Canvas. It verifies a Sub2API dashboard JWT through user-facing Sub2API APIs, issues an opaque Canvas session, owns account-scoped provider/project/asset/generation records and exposes signed media URLs. The Sub2API assertion is retained only in process memory for the active Canvas session so catalog/key selection can be resolved server-side; it is never written to the database, response JSON or logs.

## Local setup

```text
CANVAS_ORIGIN=https://canvas.example.test
SUB2API_BASE_URL=https://sub2api.example.test
PORT=17372
```

Run `npm install`, then `npm test`, `npm run build` or `npm start` from this directory. The service never accepts a wildcard origin and does not log request credentials.

The current repositories and object storage are in-memory adapters intended for contract tests and local wiring. PostgreSQL, S3-compatible storage and concrete provider HTTP adapters still need deployment-specific selection and implementation before production use.
