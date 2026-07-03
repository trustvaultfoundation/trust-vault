# Hosting TrustVault on `trustvault.foundation`

TrustVault is a **fully static export** (`output: "export"` → `./out`, no server backend — all
Arweave / Turbo / wallet work runs in the browser). It is hosted on **Cloudflare Pages** in front of
**Cloudflare DNS**, with the domain registered at **Spaceship** and email on **Spacemail**.

> **Secrets never touch the host.** `PLATFORM_WALLET_JWK` / `DEPLOY_WALLET_JWK` are build/deploy-time
> only (ArNS mint + permaweb publish). They must **not** be added as Cloudflare env vars — the static
> bundle doesn't need them. Prefer the *direct upload* deploy below so keys stay on your machine.

## One-time domain setup

1. **Nameservers (at Spaceship).** Point the domain's nameservers to Cloudflare:
   - `drake.ns.cloudflare.com`
   - `riya.ns.cloudflare.com`

   The Cloudflare zone stays *pending* until this propagates and ownership verifies.

2. **DNSSEC (optional, recommended).** Enable in Cloudflare → DNS → Settings, then add the shown **DS
   record** at Spaceship.

## DNS records (Cloudflare → DNS)

| Type | Name | Value | Proxy | Purpose |
| --- | --- | --- | --- | --- |
| MX | `@` | `mx1.spacemail.com` (prio 0) | DNS only | Spacemail — **do not touch** |
| MX | `@` | `mx2.spacemail.com` (prio 0) | DNS only | Spacemail — **do not touch** |
| SRV | `_autodiscover._tcp` | `0 443 autoconfig.spacemail.com` | DNS only | Spacemail autodiscover |
| TXT | `@` | `v=spf1 include:spf.spacemail.com ~all` | — | SPF (email auth) |
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:hello@trustvault.foundation; fo=1` | — | DMARC (add this) |
| CNAME | `@` and `www` | *(auto-created by Pages)* | Proxied | Website — added via Pages custom domains |

- **Email records must stay "DNS only" (grey cloud).** Never proxy MX/SPF/DMARC.
- Add the **DKIM** record from Spacemail's dashboard if it provides one (usually a `CNAME` or `TXT`).
- Start DMARC at `p=none` for a week to monitor, then tighten to `p=quarantine` (shown) or `p=reject`.

## Deploy

Build the static bundle (this also emits `out/_headers` and `out/_redirects`):

```bash
npm run build:static      # → ./out
```

**Direct upload (recommended — secrets stay local):**

```bash
npx wrangler pages deploy out --project-name trustvault
```

**Or Git-connected auto-deploy:** connect the GitHub repo in Cloudflare Pages with
build command `npm run build:static` and output directory `out`. Do **not** add the wallet-JWK env
vars — the build doesn't need them.

Then attach the custom domains (Pages **Custom domains**, or via the API — the CLI has no command
for this). Add `trustvault.foundation` and `www.trustvault.foundation`, then in **DNS** add the two
proxied CNAMEs pointing at the `*.pages.dev` target (the apex uses CNAME flattening).

**www → apex redirect:** this is *not* done via a `_redirects` file — Cloudflare Pages `_redirects`
only matches on path, not hostname. Use a zone-level **Rules → Redirect Rules** entry instead:
- When incoming requests match: Hostname equals `www.trustvault.foundation`
- Then Redirect → **Dynamic**, 301, URL expression
  `concat("https://trustvault.foundation", http.request.uri.path)`, preserve query string.

## Security (all free, in the Cloudflare dashboard)

- **SSL/TLS mode: Full (strict)**; enable **Always Use HTTPS** and **HSTS**.
- Security headers (CSP, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS) ship via
  [`public/_headers`](public/_headers). Adjust the CSP there if you add new third-party origins.
- Cloudflare provides DDoS protection at the edge out of the box (this is what fixes the ar.io
  gateway instability).

## Keep Arweave as a permanence mirror (optional)

`trustvault.foundation` is the fast, stable front door. Keep publishing an immutable copy to the
permaweb so the app stays censorship-proof and on-brand:

```bash
npm run deploy            # publishes to Arweave / ArNS (needs the wallet JWKs in .env.local)
```
