# Infinite Canvas BFF

The Canvas BFF is the account-scoped HTTP boundary for Infinite Canvas. This foundation slice exposes health/readiness checks, exact-origin CORS and redacted error handling. Authentication, persistence, providers and generation workers are added in later slices.

## Local setup

```text
CANVAS_ORIGIN=https://canvas.example.test
SUB2API_BASE_URL=https://sub2api.example.test
PORT=17372
```

Run `npm install`, then `npm test` or `npm run build` from this directory. The service never accepts a wildcard origin and does not log request credentials.
