# 1CE v2

Independent rebuild of 1CE. Production 1CE remains untouched.

## Local development

Requires Node.js 22+ and pnpm 10+.

```sh
pnpm install
pnpm dev:web
```

API health check:

```sh
pnpm --filter @1ce/api dev
```

The first commit contains a **non-production scaffold**. Authentication, legal documents and the full Library are not yet implemented. Do not deploy this as a replacement for `1ce.lol`.
