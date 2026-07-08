<div align="center">

# TrustVault

**Your private workspace, kept forever.**

An all-in-one, end-to-end encrypted workspace that lives on the [Arweave](https://arweave.org) permaweb —
free to use, owned by you, and stored on-chain for life.

</div>

---

## Why TrustVault exists

Every "workspace" app today rents you space on someone else's servers. Your documents, tasks, chats and
notes live in a database a company controls — they can read them, lose them, lock you out, change the
price, or shut down and take everything with them.

TrustVault flips that model:

- **You hold the keys — literally.** Everything is **end-to-end encrypted** in your browser before it ever
  leaves your device. No server, no company (not even us) can read your data. Access is *cryptographic*,
  not a permission toggle someone can flip.
- **It can't disappear.** Data is written to **Arweave**, a decentralized network that stores information
  **permanently**. There's no server to shut down, no subscription to lapse, no vendor to trust with your
  history.
- **It's genuinely free.** No accounts, no passwords, no monthly fee. You connect an Arweave wallet once,
  and the tiny on-chain writes are covered by the free tier of bundled uploads.
- **You own it.** Your identity is your wallet. Move computers, connect the same wallet, and your entire
  workspace restores from the encrypted backup automatically.

The result is a workspace with the collaboration features teams expect — but with the ownership,
privacy and permanence of the decentralized web.

## What's inside

TrustVault is a full suite, not a single tool. Everything below is encrypted and shareable per-item with
the people you choose:

| Area | What it does |
| --- | --- |
| 🔐 **Vault** | Encrypted document storage on Arweave — upload, decrypt, download, and share files with specific people or with a password (for recipients who don't have a wallet). |
| 🗂️ **Boards** | Kanban boards with tickets, columns, comments, worklogs, roles and shared collaboration over an encrypted event log. |
| 💬 **Chat** | End-to-end encrypted multi-party group chats with the people in your Access Keys. |
| 📅 **Calendar** | Personal and shared events, reminders, and board due-dates in one place. |
| ⏱️ **Timesheet** | Log the hours you work per board/project, with manager approval flows. |
| 🛎️ **Service Desk** | Incidents / requests / changes / problems / and more with a priority matrix, approvals and SLAs. |
| 📖 **Documentation** | A per-board wiki with a rich-text editor, nested pages and whiteboards. |
| 📊 **Dashboard** | Analytics across your documents, boards and service-desk teams. |
| 👤 **Profiles & Access Keys** | On-chain public profiles, an encrypted address book, and the identities you share things with. |
| 🌐 **DePM** | Optionally publish a public, plaintext snapshot of a board so investors/community can follow real on-chain progress. |

## How the encryption works (in one paragraph)

A per-wallet **master key** is derived and RSA-wrapped to your wallet, then cached locally so decryption
is prompt-free. Each document / board / chat has its own **AES key**; that key is RSA-wrapped to every
recipient's public key (the same model a shared vault uses), so only members can decrypt — non-members
simply lack the key. Shared data travels as an **encrypted, append-only event log** on Arweave that
clients *fold* into state with newest-wins + role validation. Free, no-value writes are signed silently
by an in-browser app key so routine edits never nag you with a wallet popup, while genuine value actions
still ask for approval.

## Tech stack

- **[Next.js](https://nextjs.org)** (App Router) + **React** + **TypeScript**, exported as a fully static site.
- **[Tailwind CSS](https://tailwindcss.com)** for styling.
- **[Arweave](https://arweave.org)** + **[Irys / Turbo](https://irys.xyz)** for permanent storage and bundled uploads.
- **[ar.io](https://ar.io) SDK** for ArNS naming, **arbundles** for signing.
- **Wander** (`window.arweaveWallet`) as the wallet provider.
- Rich text via **[Tiptap](https://tiptap.dev)**, whiteboards via **[Excalidraw](https://excalidraw.com)**.

## Running it locally

> Requires Node.js 20+ and a desktop browser with the [Wander](https://www.wander.app) wallet extension.
> TrustVault is desktop-only for now; a native mobile app is planned.

```bash
npm install
cp .env.example .env.local   # fill in the blanks (only needed for ArNS features)
npm run dev                  # http://localhost:3000
```

Build a static export:

```bash
npm run build:static         # outputs to ./out
```

This site is hosted at **[trustvault.foundation](https://trustvault.foundation)** on Cloudflare Pages —
see [HOSTING.md](HOSTING.md) for the deploy runbook. The lightweight landing mirror served at
`trustvault.ar.io` lives in the sibling **`../trust-vault-ar-io`** project.

## Configuration

Server-only secrets (wallet JWKs, ArNS config) live in `.env.local` and are **never** shipped to the
browser. Copy [`.env.example`](.env.example) and fill in your own values. Never commit real keys — the
`.gitignore` already excludes `.env*`, `wallet.json` and `ao-wallet.json`.

## License

TrustVault is **source-available** under the **[Business Source License 1.1 (BUSL-1.1)](LICENSE)** —
see also [NOTICE](NOTICE).

What that means:

- ✅ You may **read, copy, modify, and make non-production use** of the code (review, audit, test locally).
- ⛔ **Production and commercial use are not granted by default** (Additional Use Grant: *None*). If you
  want to run it in production or use it commercially, contact the Licensor for a license or a targeted
  exception.
- 🔓 **Change Date — 2030-07-02:** on that date the code **automatically converts** to the permissive
  **[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)** and these restrictions fall away.

This is intentionally *not* a traditional open-source license — it protects the work from being copied for
commercial/production use for a few years, then opens fully. This project also **does not accept external
contributions** — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Author

Created and maintained by **TrustVault**.

Copyright © 2026 TrustVault. All rights reserved, except as expressly granted by the Business Source
License 1.1.
