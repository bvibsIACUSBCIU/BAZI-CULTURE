# Cloudflare Production Deployment

## Prerequisites

Use Node.js 20 or newer. Authenticate the local Wrangler CLI with the Cloudflare account that owns the target domain:

```bash
npx wrangler login
npx wrangler whoami
```

Create production resources and copy the generated identifiers into the production binding section of `wrangler.toml` before deployment:

```bash
npx wrangler d1 create liangyi-bazi-production
npx wrangler kv namespace create AUTH_KV
npx wrangler pages project create liangyi-bazi
```

Create separate preview D1 and KV resources. Never point preview bindings at production data.

## Secrets

Set provider and webhook secrets interactively. Do not put them in `wrangler.toml`, `.env.example`, frontend code, or Git history.

```bash
npx wrangler secret put OPENAI_API_KEY --env production
npx wrangler secret put TELEGRAM_BOT_TOKEN --env production
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --env production
```

Set `ALLOWED_ORIGIN` to the final HTTPS Pages/custom-domain origin, not a wildcard. Set `ENVIRONMENT=production` so sessions are issued with the `Secure` cookie attribute.

## Deployment Order

1. Apply the migrations to preview and verify a test wallet can register, create a profile, write a preference, generate a report, log out, and sign in again.
2. Apply the migrations to production before routing production traffic.
3. Deploy the Worker and bind its `/api/*` route to the Pages/custom-domain origin.
4. Deploy the static workbench to Pages.
5. Run the automated health check and then exercise the two-wallet isolation flow in a browser.

```bash
npm run cf:db:migrate:remote
npm run cf:deploy
npx wrangler pages deploy . --project-name liangyi-bazi
```

## Production Checks

- `GET /api/health` returns `200` with security headers.
- Unauthenticated `GET /api/auth/me` returns `401`.
- A valid personal-sign challenge sets an HttpOnly, Secure, SameSite=Lax session cookie.
- A second wallet cannot list, delete, bookmark, or fetch the first wallet's profiles, conversations, reports, preferences, credits, or check-ins.
- Refreshing the first wallet's session on a second browser profile restores the same profiles, history, reports, credits, and preferences.
- Cloudflare logs contain no raw session cookie, private key, signature, or provider secret.

## Rollback

Do not roll back D1 migrations by deleting production data. Roll back the Worker or Pages deployment to the prior known-good version, keep the schema forward-compatible, and investigate with Cloudflare logs before applying a corrective migration.
