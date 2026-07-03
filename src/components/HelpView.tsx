"use client";

import { useMemo, useState } from "react";

// ── content model ────────────────────────────────────────────────────────────
type Block =
  | { p: string }                       // paragraph
  | { h: string }                       // sub-heading
  | { ul: string[] }                    // bullet list
  | { ol: string[] }                    // numbered steps
  | { tip: string }                     // highlighted tip
  | { note: string }                    // caution / important note
  | { see: string[] }                   // related-topic chips (interactive)
  | { qa: { q: string; a: string }[] }; // expandable questions (interactive)

type Topic = {
  id: string;
  title: string;
  intro?: string;
  blocks: Block[];
  children?: Topic[];
};

// Full, nested documentation of the whole app. Topics can contain sub-topics
// (pages inside pages) so each area is explained in detail.
const TOPICS: Topic[] = [
  {
    id: "welcome",
    title: "Welcome",
    intro: "Generational Trust Vault is an encrypted, permanent home for the documents that matter — and a place to organise the work and knowledge around them.",
    blocks: [
      { h: "What it's for" },
      { p: "It keeps important documents — wills, deeds, certificates, family records, contracts — encrypted and stored permanently, so they survive devices, accounts and time, and can be handed to the people who should have them." },
      { p: "Everything is encrypted in your browser before it leaves your device. Files are stored on Arweave, a network that keeps data permanently, and your identity is your crypto wallet rather than an email and password. There's no company holding your account that could lock you out or shut down. Your whole workspace — files, boards, chats, calendar and more — is backed up to Arweave too (encrypted)." },
      { h: "The ideas behind it" },
      { ul: [
        "Client-side encryption — your documents are scrambled on your device; the plaintext is never sent anywhere.",
        "Permanent storage — once on Arweave, data isn't silently deleted or lost when a company shuts down.",
        "You hold the keys — access is tied to your wallet and keys derived from it, not to an account a provider controls.",
        "Lives on the network, not one centralized server — your whole workspace is backed up to Arweave (encrypted).",
        "Built to share and outlive you — pass documents to specific people, and collaborate with boards, chat and documentation.",
      ] },
      { h: "What's inside" },
      { ul: [
        "Uploads & Vault — encrypt, store and manage your documents.",
        "Sharing & Access Keys — give specific people access to specific documents.",
        "Dashboard — analytics for your documents, any board, or any Service Desk team.",
        "Board — a project tracker you can share with a team.",
        "DePM — make a board public so investors see your real, on-chain progress (transparency, not marketing).",
        "Service Desk — log incidents, requests, changes and problems and route them to a team.",
        "Documentation — a space to write things down.",
        "Chat — encrypted group chats with people from your Access Keys.",
        "Calendar — meetings, tasks and your tickets' due dates in one view.",
        "Timesheet — a calendar-style week of every hour logged across your boards, plus holiday/vacation requests.",
        // "ArNS Domains & Settings — friendly names and configuration.",
      ] },
      { tip: "New here? Read Security & privacy first, then Getting started — together they explain the one trade-off that matters (keys live in your browser) and how to sign in." },
      { see: ["signin", "security", "start", "servicedesk"] },
    ],
  },
  {
    id: "security",
    title: "Security & privacy",
    intro: "How your documents stay private, what is and isn't visible, and the trade-offs to understand.",
    blocks: [
      { p: "Privacy here isn't a policy promise — it's built into how the app works. Documents are encrypted before upload, so even the storage network and the app's own servers only ever see scrambled data." },
      { note: "Two things are permanent and worth understanding up front: data on Arweave can't be truly deleted, and anyone who can use this browser profile can read your documents. The sub-topics explain both." },
      { see: ["security-encryption", "security-where", "security-recovery", "security-limits"] },
    ],
    children: [
      {
        id: "security-encryption",
        title: "How encryption works",
        blocks: [
          { p: "Each document gets its own random AES-256 key and is encrypted in your browser (AES-GCM, an authenticated cipher that also detects tampering). Only the encrypted result is uploaded." },
          { h: "The key hierarchy" },
          { ul: [
            "Every document has its own random AES key.",
            "Those keys are protected by a master key tied to your wallet.",
            "The master key, and the per-document keys it unlocks, are cached in this browser so opening a document is instant — no wallet pop-up each time.",
          ] },
          { p: "When you share, the document's key is re-wrapped to the recipient's wallet using public-key cryptography (RSA), so they can decrypt it with their own wallet and nobody in the middle — not even the app — can read it." },
          { tip: "Instant, pop-up-free decryption is a deliberate choice — the raw keys sit in your browser so you're not approving a wallet prompt for every file. The cost of that convenience is covered in Best practices & limits." },
          { qa: [
            { q: "What exactly is encrypted, and with what?", a: "The file contents are encrypted with AES-256-GCM using a key unique to that document. That document key is itself protected by your wallet-derived master key, and re-wrapped with RSA public-key crypto when shared. The app never has access to your plaintext or your master key." },
            { q: "Can the app's servers read my files?", a: "No. Encryption happens in your browser before upload. The server side only ever relays already-encrypted data and public metadata (names, tags), never plaintext." },
          ] },
          { see: ["security-where", "sharing-how"] },
        ],
      },
      {
        id: "security-where",
        title: "What's stored where",
        blocks: [
          { h: "On Arweave (permanent, public network)" },
          { ul: [
            "The encrypted document — unreadable without the key.",
            "Public metadata you set: file name, document type and tags. Choose names and tags that you're comfortable being visible.",
            "Tiny records for sharing, boards and chats (their private contents are encrypted too).",
            "An encrypted backup of your workspace — your vault index, boards, chats, calendar, settings and saved passwords — wrapped with your master key, so only your wallet can read it.",
          ] },
          { h: "In this browser (cache only)" },
          { ul: [
            "Your keys, cached so documents open instantly — the master key is itself backed up (see Recovery).",
            "Working copies and view caches that rebuild themselves from Arweave when needed.",
          ] },
          { note: "Because that encrypted backup lives on Arweave, clearing this browser or moving to another device no longer loses your work — it syncs back when you reconnect. Plaintext never touches a server, and only your wallet can decrypt the backup." },
          { see: ["security-encryption", "security-recovery"] },
        ],
      },
      {
        id: "security-recovery",
        title: "Recovery & exporting keys",
        blocks: [
          { p: "Your work is no longer trapped in one centralized server. Your master key is backed up — encrypted to your wallet — on Arweave, and your whole workspace is saved there as an encrypted snapshot only your wallet can open." },
          { h: "On a fresh device, or after clearing data" },
          { ol: [
            "Connect the same wallet and approve one unlock — this recovers your master key from Arweave.",
            "Your vault index, boards, chats, calendar, settings and saved passwords restore automatically from the encrypted backup.",
            "Vault files also rebuild directly from Arweave (they're stored under your wallet), and anything shared with you re-appears from the network.",
          ] },
          { note: "Give it a moment after reconnecting — recovery reads from Arweave, which can take a short while to respond, then your workspace fills in." },
          { tip: "Exporting recovery keys from Settings is still there as an extra backup, but it's no longer required to switch devices — your wallet is enough." },
          { see: ["settings", "security-limits"] },
        ],
      },
      {
        id: "security-limits",
        title: "Best practices & limits",
        blocks: [
          { p: "The same design that makes the app fast and self-sovereign comes with responsibilities. Keep these in mind:" },
          { ul: [
            "Keep this device and browser profile secure — a logged-in profile can read your vault.",
            "Don't put secrets in file names or tags; those are public.",
            "Remember permanence: you can stop showing a document to someone, but you can't recall a copy they already downloaded.",
            "Back up your wallet seed phrase and export recovery keys from Settings.",
          ] },
          { see: ["security-recovery", "sharing-revoke"] },
        ],
      },
    ],
  },
  {
    id: "start",
    title: "Getting started",
    intro: "Create an account with a passkey, or connect a wallet — and you're in.",
    blocks: [
      { ol: [
        "Press Get started, then either create an account with a passkey (Face ID · Touch ID · Windows Hello — no extension, no password) or connect an Arweave wallet like Wander.",
        "Approve the passkey prompt (or the wallet's connection request).",
        "Unlock — this prepares your keys in the browser so documents open instantly.",
        "Upload your first document, or open the Dashboard to look around.",
      ] },
      { h: "Your identity" },
      { p: "Your wallet's address is your identity, and your encryption keys are derived from it. People share with you by your address or public key. There's no separate account server: the wallet is the account." },
      { note: "Brand-new wallets have no transactions yet, so they aren't discoverable on-chain and start with 0 AR. To receive a share, paste your public key to the sender; for larger uploads, top up Turbo credits or use a funded wallet (see Signing in)." },
      { see: ["signin", "uploads", "sharing-how"] },
    ],
  },
  {
    id: "signin",
    title: "Signing in & wallets",
    intro: "Create an account with a passkey, or connect any Arweave wallet.",
    blocks: [
      { h: "Sign in with a passkey (no extension)" },
      { p: "Choose “Create an account with a passkey” and TrustVault generates a real Arweave wallet for you, protected by your device's passkey (Face ID · Touch ID · Windows Hello · a security key) — no browser extension and no password. It's free and end-to-end encrypted: only your passkey can unlock it." },
      { ul: [
        "Your encrypted wallet is stored on Arweave, so it comes back on any device your passkey syncs to (iCloud Keychain / Google Password Manager) — just choose “Sign in with your passkey”.",
        "Closing the browser tab signs you out of the passkey wallet; you re-unlock with one biometric tap next time (the wallet key isn't kept after the tab closes).",
        "Needs a device/browser that supports passkey encryption (the WebAuthn PRF extension) — most modern phones and laptops do. If yours doesn't, use a wallet extension instead.",
      ] },
      { h: "Sign in with a wallet" },
      { p: "Connect any capable Arweave wallet (e.g. Wander, formerly ArConnect). Your wallet's address is your identity and your encryption keys derive from it, so encryption, sharing and permanent storage all work end-to-end — only your wallet holds the keys. No wallet yet? Install Wander from wander.app, then reload. A wallet that can't do in-wallet encryption is shown disabled with the reason." },
      { h: "Multiple accounts" },
      { ul: [
        "Each wallet is its own end-to-end-encrypted account — its own vault, boards, chat and calendar. They are never merged.",
        "Manage your accounts in the Wander extension. In TrustVault, add them to your list from the account menu in the header or Settings → Account & wallets — 'Suggested from your extension' lists ones it detects.",
        "To switch the active account, change it in the Wander extension — TrustVault follows it automatically. Removing a wallet only takes it off the list; its data stays on Arweave and returns if you connect it again.",
      ] },
      { h: "Funding (AR)" },
      { p: "A brand-new wallet holds no AR. Small records (your master key, the encrypted backup, tiny files) are free via Turbo's free tier, but larger uploads need Turbo credits — top up at turbo.ardrive.io with a card or crypto — or use a wallet that already holds AR." },
      { note: "There's no app server in the middle — your plaintext and keys never leave your device." },
      { see: ["start", "security-encryption", "sharing-how"] },
    ],
  },
  {
    id: "uploads",
    title: "Uploads",
    intro: "Encrypt a file and store it permanently.",
    blocks: [
      { ol: [
        "Go to Uploads and drag in a file (or click to choose one).",
        "Pick a document type and add any tags — these are public labels that make searching easier later.",
        "Confirm. The file is encrypted in your browser, then uploaded to Arweave.",
      ] },
      { h: "What happens behind the scenes" },
      { ul: [
        "A random key is generated and the file is encrypted locally.",
        "Only the ciphertext plus your chosen metadata is uploaded.",
        "The document is added to your Vault index so you can find it again.",
      ] },
      { tip: "Document types and tags are just for organising and searching — they're visible, so keep them generic (e.g. \"Will\", \"Property\") rather than sensitive." },
      { see: ["vault", "security-where"] },
    ],
  },
  {
    id: "vault",
    title: "Vault",
    intro: "Browse, search and manage everything you own or that's been shared with you.",
    blocks: [
      { h: "Finding documents" },
      { ul: [
        "Search by name, filter by tag or by document type.",
        "See at a glance what you own versus what others shared with you.",
      ] },
      { h: "Actions on a document" },
      { ul: [
        "Open / preview — images and common types render right in the app.",
        "Download — decrypts and saves the original file.",
        "Download with password — re-protects the file with a password so someone without a wallet can open it.",
        "Share — give a specific person access (see Sharing).",
      ] },
      { tip: "\"Download with password\" is the simplest way to hand a document to someone who doesn't use a wallet — send them the file and tell them the password through a separate channel." },
      { see: ["sharing", "view"] },
    ],
  },
  {
    id: "view",
    title: "View Document",
    intro: "Open a single document directly, and find your public key.",
    blocks: [
      { ul: [
        "Paste a document's transaction ID to open it directly.",
        "This screen also shows your own public key — copy it and send it to anyone who wants to share with you if your wallet is new and not yet discoverable on-chain.",
      ] },
      { see: ["sharing-how", "vault"] },
    ],
  },
  {
    id: "sharing",
    title: "Sharing & Access Keys",
    intro: "Give specific people access to specific documents — cryptographically, not just by hiding a link.",
    blocks: [
      { p: "Sharing re-wraps a document's key to the recipient so only they can decrypt it. It's real access control, not a public link that anyone with the URL could open." },
      { see: ["sharing-keys", "sharing-how", "sharing-revoke"] },
    ],
    children: [
      {
        id: "sharing-keys",
        title: "Access Keys (address book)",
        blocks: [
          { p: "Access Keys is your address book of the people you share with — each saved with a friendly label so you don't deal in raw addresses." },
          { ul: [
            "Add someone by their Arweave address or public key, with a label.",
            "Reuse them anywhere you share — documents or board members.",
          ] },
          { see: ["sharing-how", "board-members"] },
        ],
      },
      {
        id: "sharing-how",
        title: "How sharing works",
        blocks: [
          { ol: [
            "Pick a document and choose Share, then select a person (or add one).",
            "The app wraps that document's key to the recipient's public key and publishes a small on-chain grant record.",
            "The recipient sees the document in their Vault and decrypts it with their own wallet — one approval the first time.",
          ] },
          { note: "A brand-new wallet has no public key on-chain yet. In that case ask the recipient to paste their public key (from View Document) so you can share with them." },
          { see: ["view", "sharing-revoke"] },
        ],
      },
      {
        id: "sharing-revoke",
        title: "Revoking access",
        blocks: [
          { p: "Revoking publishes a tombstone record. The app stops showing the document to that person going forward." },
          { note: "Revoke is a soft control. Because Arweave is permanent, anything the person already downloaded can't be un-downloaded. Revoke to stop future access, not to recall a copy." },
          { see: ["security-limits"] },
        ],
      },
    ],
  },
  {
    id: "dashboard",
    title: "Dashboard",
    intro: "A configurable analytics view — of your documents, any board, or any Service Desk team.",
    blocks: [
      { h: "Choose what to analyse" },
      { ul: [
        "Use the selector next to the title to switch the whole dashboard between scopes.",
        "Documents — uploads over time, AR spent, totals, files by type and tag, and owned versus shared-with-you.",
        "A board — its tickets by status, priority, assignee and label, open versus done, and tickets created over time.",
        "A Service Desk team — its records by type, priority, state and assignee, open versus closed, and records created over time.",
        "Each scope keeps its OWN layout, card types and time range — saved per wallet.",
      ] },
      { h: "Make it yours" },
      { ul: [
        "Drag a card by its header to rearrange; resize from the bottom-right corner and the chart re-flows to fit.",
        "Switch each card between table, bar, line or single-stat.",
        "Pick a time range for the whole dashboard — quiet periods read 0 rather than holding the last value.",
        "Filter categories out of a chart, and export any card to CSV or Excel.",
        "“Reset layout” restores the current scope's default arrangement.",
      ] },
      { h: "Reading the over-time charts" },
      { ul: [
        "“Created” charts count items by the period they were created in.",
        "Service Desk breakdowns (by state, type, priority, assignee) are point-in-time snapshots: a record counts toward a value for the whole time it held it. A record that's “New” for three days stays on the New line for those three days, then moves to the next state's line the moment it changes — its state history drives the chart.",
      ] },
      { h: "Recent records / tickets" },
      { p: "The Recent Records card (Service Desk) lists every column — number, short description, type, state, priority, urgency, impact, category, assignee, requested-by, target date and updated — so you can scan or export the full picture at a glance." },
      { tip: "Your layout saves automatically per scope and per wallet — set a board and a team up differently and each remembers its own arrangement on refresh." },
      { see: ["board", "servicedesk"] },
    ],
  },
  {
    id: "board",
    title: "Board",
    intro: "A tracker for your work — boards with projects (each a column view), rich tickets with sub-tickets, workflow rules, time tracking, and optional team sharing.",
    blocks: [
      { p: "Use boards to plan and track work. A board is a pool of columns with tickets you drag between them. Inside a board you can have several projects (each a named view of some columns), move tickets across them, break tickets into sub-tickets, set workflow rules, search across everything, and share a board with a team — each member with a role." },
      { see: ["board-columns", "board-tickets", "board-subtickets", "board-richtext", "board-worklog", "board-attachments", "board-members", "board-sync", "timesheet"] },
    ],
    children: [
      {
        id: "board-columns",
        title: "Projects, columns & rules",
        blocks: [
          { h: "Boards & projects" },
          { ul: [
            "Each wallet starts with one board called \"Main\" — rename it from the board switcher at the top.",
            "Create more boards and switch between them from that dropdown.",
            "Inside a board you can have several PROJECTS — each a named view with its own columns. Open the board switcher and hover a board: its projects open beside it (to the right, or to the left when there's no room), where you can pick one, or create / rename / delete projects. The current board + project show on the switcher button.",
            "Example: a board could have a Main project (Open · Ready · In Progress · In Review · Done) and a Refinement project (Backlog · Functional Refinement · Architectural Analysis · Technical Refinement).",
          ] },
          { h: "Columns" },
          { ul: [
            "A board has one pool of columns; each project shows a chosen subset, in its own order. Settings has just Members and Columns — in Columns, a dropdown at the top picks the project and the columns below change to that project's, so you set up every project's columns in one place.",
            "Defaults are Backlog, Open, Ready, In Progress, In Review and Done. The Add list offers them all undivided — To Do, Functional/Technical Refinement, Architectural Analysis, Blocked, Testing, Released or a custom name — and adding puts the column in the selected project (creating it on the board if new).",
            "Rename, mark \"done\", hide, set move rules, reorder, or remove a column from a project (it stays available to add back — tickets in it simply show in whichever projects still have that column).",
          ] },
          { h: "Moving tickets across projects" },
          { p: "A ticket lives in a column. It shows in every project that includes that column — so to move a ticket from one project to another, set its column. If two projects share a column, a ticket there shows in both." },
          { tip: "On the board you drag a ticket between the current project's columns. To send it to a column in another project, open the ticket and change its Status — that list shows every column on the board." },
          { h: "Workflow rules" },
          { p: "By default a ticket can move from any column to any other. The owner/admin can shape the process in Settings → Columns: for each column, use the move-arrows icon to choose which columns a ticket there may move to (more than one allowed; empty means any). Rules apply when dragging on the board." },
          { h: "Finding tickets" },
          { p: "Type in the search box to filter; a dropdown of matches also opens — including tickets in HIDDEN columns or other projects — so you can always find and open one." },
          { note: "Members are shared across the whole board; per-project member overrides aren't available yet." },
          { see: ["board-tickets", "board-subtickets", "board-members"] },
        ],
      },
      {
        id: "board-tickets",
        title: "Tickets",
        blocks: [
          { h: "Creating a ticket" },
          { p: "The \"+\" on a column (or New ticket) opens a full form with every field up front, so you can fill in as much as you want before creating it." },
          { h: "Fields" },
          { ul: [
            "Description and comments — rich text (see the editor sub-topic), where the “+” inserts references to other tickets, events and Service Desk records.",
            "Assignee and Reporter — Reporter is set automatically to whoever created the ticket.",
            "Priority, tags, start date and due date.",
            "Estimate, plus a work log for time actually spent.",
            "Attachments from your vault or a fresh upload.",
            "A parent ticket and sub-tickets (see Sub-tickets).",
            "Related records — link the calendar events and Service Desk records (INC/REQ/CHG/PRB) this ticket connects to; each is a clickable chip, and the link shows on the other side too.",
          ] },
          { h: "Ticket keys" },
          { p: "Each ticket has a key like ABC-12. The prefix comes from the board's name and the number is stable — rename the board and every key re-prefixes while the numbers stay the same, so links and references never break." },
          { see: ["board-richtext", "board-subtickets", "board-worklog", "board-attachments", "servicedesk"] },
        ],
      },
      {
        id: "board-subtickets",
        title: "Sub-tickets",
        blocks: [
          { p: "Break a ticket into smaller ones. A ticket can have a parent and its own sub-tickets, so you can split big work into pieces." },
          { ul: [
            "Open a ticket and set its Parent (search by key or title), or add sub-tickets to it — create new ones inline, or link existing tickets.",
            "When a parent and its sub-tickets are in the same column, the sub-tickets sit grouped and indented right under the parent, in number order, with a connector line.",
            "You can't drop another card between a parent and its sub-tickets — they stay together.",
            "A card shows a small count of how many sub-tickets it has.",
          ] },
          { see: ["board-tickets"] },
        ],
      },
      {
        id: "board-richtext",
        title: "The rich text editor",
        blocks: [
          { p: "Descriptions, comments and documentation pages all use the same editor. The toolbar gives you:" },
          { ul: [
            "Undo and redo.",
            "Text style — a menu for Normal text and Headings 1 to 6.",
            "Bold, italic, strikethrough, quote and inline code.",
            "Bullet and numbered lists.",
            "Links and images.",
            "Tables — click the table button for a size grid to insert one; while your cursor is inside a table, its add/remove row & column options appear right in the toolbar.",
            "References — the “+” inserts a clickable chip for a board ticket, sub-ticket, calendar event or Service Desk record (INC/REQ/CHG/PRB); typing a ticket key or record number links it too.",
            "In Documentation only: attach a document (with an optional preview) and insert a whiteboard.",
          ] },
          { see: ["docs-rich", "docs-attachments", "docs-whiteboard", "servicedesk"] },
        ],
      },
      {
        id: "board-worklog",
        title: "Work log (time tracking)",
        blocks: [
          { p: "Log time. Enter durations like \"2h 30m\" (a plain number is read as hours), and the app rolls minutes up intelligently — 1h 30m plus 2h 30m totals 4h, never \"3h 60m\"." },
          { ul: [
            "Each log entry has a date, duration, optional title and description, and the author.",
            "The ticket shows a progress bar of logged time against the estimate, with remaining or over-budget time.",
          ] },
          { see: ["board-tickets"] },
        ],
      },
      {
        id: "board-attachments",
        title: "Attachments",
        blocks: [
          { ul: [
            "Attach a file from your vault, or upload a new one without leaving the ticket.",
            "On a shared board, attaching a file automatically shares it with the board's members so they can open it.",
            "Add a new member and the board's existing attachments are shared with them too.",
          ] },
          { see: ["sharing-how", "board-sync"] },
        ],
      },
      {
        id: "board-members",
        title: "Members & roles",
        blocks: [
          { p: "Open Settings → Members to manage who's on a board. Add people from your Access Keys or by address/public key." },
          { h: "Roles" },
          { ul: [
            "Owner — full control; anchors ownership of the board.",
            "Admin — manage members, columns and settings.",
            "Editor — create and edit tickets and comments.",
            "Viewer — read-only.",
          ] },
          { h: "Removing someone" },
          { p: "Removing a member marks them inactive rather than erasing them — their name stays on the tickets they created or were assigned, shown greyed out, and you can reactivate them later." },
          { see: ["sharing-keys", "board-sync"] },
        ],
      },
      {
        id: "board-sync",
        title: "Sharing & sync",
        blocks: [
          { p: "Sharing a board encrypts it and publishes it to Arweave as an append-only log of events, with the board key wrapped to each member so only members can read it." },
          { ul: [
            "Members discover boards shared with them and decrypt with their wallet (one approval).",
            "Your changes apply instantly for you and sync in the background for everyone else.",
            "Refresh any time; shared boards also poll periodically.",
          ] },
          { note: "Two things to expect: it isn't realtime — Arweave indexing takes a few minutes — and permissions are enforced by the app, not cryptographically. A removed member who kept the key could still read new events, so treat roles as cooperation, not a hard security boundary." },
          { qa: [
            { q: "Why isn't it instant like Google Docs?", a: "There's no central live server — changes are published to Arweave and read back, and the network takes a few minutes to index new data. You see your own edits immediately; teammates see them after a sync." },
            { q: "What happens if two people edit the same thing?", a: "Each change is its own event with a timestamp; when folded together the most recent change to a given field wins (last-writer-wins), so nothing is lost outright but the latest edit is what shows." },
          ] },
          { see: ["board-members", "security-encryption"] },
        ],
      },
    ],
  },
  {
    id: "depm",
    title: "DePM — public projects",
    intro: "Make a board public so investors and supporters can see your real progress, not just marketing.",
    blocks: [
      { p: "DePM (Decentralized Project Management) lets a project owner publish a board to the public Projects page, where anyone can study what a team is actually shipping — columns, ticket titles and progress — verifiable on-chain. It turns your day-to-day work into transparency that builds trust." },
      { h: "Why it helps" },
      { ul: [
        "For companies/teams: prove momentum with real, tamper-evident progress instead of marketing claims.",
        "For investors/supporters: judge a project by what it's actually building before backing it.",
      ] },
      { h: "How to make a board public" },
      { ul: [
        "Open the board → ⚙ Settings → the DePM tab (owner only).",
        "Add your company / project name (and optionally website, X, Discord, a description).",
        "Choose which projects (column views) to share — you don't have to share all of them.",
        "Click “Make public”. After that it updates automatically as you work — no need to re-publish.",
      ] },
      { h: "What is (and isn't) shared" },
      { ul: [
        "Shared: company info, the chosen projects' columns, ticket TITLES, and progress counts.",
        "Not shared: ticket descriptions, comments, attachments, assignees, members, or anything from boards you keep private.",
        "It's public and permanent on Arweave. “Make private” removes it from the page but can't erase what was already published.",
      ] },
      { note: "Public project info is self-published by each team and isn't verified or endorsed by TrustVault — always do your own research. This isn't financial advice." },
      { see: ["board", "security-limits"] },
    ],
  },
  {
    id: "servicedesk",
    title: "Service Desk",
    intro: "A ServiceNow-style place to log and route incidents, service requests, changes and problems — and connect them to the boards, events, chats and files that resolve them.",
    blocks: [
      { h: "What it's for" },
      { p: "When something breaks, someone needs access, or a change has to be planned, raise a record here instead of losing it in a chat. Each record gets a number (INC…, REQ…, CHG…, PRB…), a state, a priority and a full activity history, so the work is tracked end to end — on your own or across a team." },
      { h: "Finding your way around" },
      { ul: [
        "The title, search box, priority filter (the funnel) and refresh sit along the top — the same layout as the Calendar.",
        "The left rail has New record at the top, then views (All, Open, Assigned to me, Unassigned, Has target date) and the four types. The list lines up with the rail and loads more as you scroll.",
        "New records you haven't seen show a red dot in the list and on the sidebar icon until you open them.",
      ] },
      { p: "The sub-topics below cover the record types, how you work a record, the ways you connect it to the rest of the app, and how team sharing works." },
      { see: ["sd-types", "sd-work", "sd-links", "sd-team"] },
    ],
    children: [
      {
        id: "sd-types",
        title: "Record types & lifecycle",
        blocks: [
          { p: "Four types, each with its own number prefix and lifecycle. You pick the type when you click New record, and it sets the right states and rules." },
          { ul: [
            "Incident (INC) — something is broken or degraded; restore service. New → In Progress → On Hold → Resolved → Closed.",
            "Service Request (REQ) — a catalog ask such as access or hardware. Requested → Approved → In Progress → Fulfilled → Closed; gated on approval.",
            "Change (CHG) — a planned change with risk. Draft → Assess → Authorize → Implement → Review → Closed; gated on approval.",
            "Problem (PRB) — the root cause behind recurring incidents. New → Analysis → Known Error → Resolved → Closed.",
          ] },
          { p: "Any type can also be Cancelled. The state shows as a coloured badge in the list and the detail header." },
          { see: ["sd-work", "servicedesk"] },
        ],
      },
      {
        id: "sd-work",
        title: "Working a record",
        blocks: [
          { h: "Create & fill it in" },
          { ol: [
            "Click New record and pick a type.",
            "Write a short description, then set Urgency and Impact — the Priority (P1–P4) is worked out for you.",
            "Assign it, name who reported or requested it, set a category, and add full detail in the description (which takes references — see the next sub-topic).",
            "Optionally set a Target date (SLA) — it also shows on the Calendar's all-day row and opens back to the record.",
          ] },
          { h: "Priority matrix" },
          { p: "Priority is Urgency × Impact (each High / Medium / Low): High × High = P1 Critical, down to Low × Low = P4 Low. Change either and the badge updates instantly — you never set priority by hand." },
          { h: "Time spent & budgets" },
          { p: "While a record is in a working state (Incidents/Requests: “In Progress”; Changes: “Implement”; Problems: “Analysis”) the time it spends there is counted — worked out from its own state history, so it's accurate even when the app is closed and never needs a running timer. The detail shows a “Time worked” bar with a small “tracking” tag while it's actively counting." },
          { ul: [
            "Each priority has a time budget (how long a P1/P2/P3/P4 should take). The bar turns amber as you near it and red when you go over.",
            "On a shared board, the team's admins/owners can set the hours-per-priority budget with “Edit budgets”; everyone else just sees spent-vs-budget. Records with no board use sensible defaults.",
            "This worked time also rolls up into the Timesheet, under the record's board.",
          ] },
          { h: "Work notes & activity" },
          { p: "Post work notes as you go from the side panel. State changes, reassignments, priority and target-date edits and approvals are all logged automatically in the Activity stream — newest first, with who and when." },
          { h: "Approvals" },
          { p: "Requests and changes carry an approval. Until someone clicks Approve, the record can't move to a state past “Approved” — so a request can't be fulfilled, and a change can't be implemented, without sign-off. Approve/Reject is recorded with who and when." },
          { see: ["sd-links", "sd-team", "timesheet", "calendar"] },
        ],
      },
      {
        id: "sd-links",
        title: "Related records, links & files",
        blocks: [
          { h: "Related records" },
          { p: "Use the Related records field to link the board tickets, sub-tickets, calendar events and other Service Desk records a record connects to — search, tick more than one, and each shows as a clickable chip that jumps to the right place. It's bidirectional: link an incident from a ticket, and the ticket from the incident." },
          { h: "Inline references" },
          { p: "Type a record's number (e.g. INC0000001) in a chat message, a documentation page or a ticket/record description — or use the “+” in those editors — and it becomes the same clickable chip. People without access to that record just see a plain, unlinked chip, never a raw code." },
          { h: "Attachments" },
          { p: "Link a document from your vault or upload a new one straight onto the record, exactly like a board ticket. Use “Link or upload a file”, and click a file's name to open it. The file stays encrypted; on a shared record (one with a Team) its key is granted to the board's members so they can open it too. Read-only members can open files but can't add or remove them." },
          { see: ["board-tickets", "calendar", "chat"] },
        ],
      },
      {
        id: "sd-team",
        title: "Sharing with a team",
        blocks: [
          { p: "Set a Team (board) on a record and it's encrypted with that board's key and shared with the board's members — they see it in their own Service Desk within a minute or two. A record with no team stays private to you (and still syncs across your own devices via the encrypted snapshot)." },
          { ul: [
            "Edit rights follow your board role: managers and editors (and the creator) can change a record; viewers see it read-only but can still open it and its files.",
            "“Shared with the team” on the record shows exactly who can read it — the board's members. Route each record to the right team's board.",
            "Refresh pulls teammates' latest records from Arweave; the sidebar dot and list highlight flag ones updated since you last looked.",
          ] },
          { note: "Like boards and chat, sharing rides Arweave: it isn't realtime (a minute or two to index), and a board's members are exactly who can read its records. To share, open that board once so its key is cached, then save the record." },
          { see: ["board-members", "board-sync", "security-encryption"] },
        ],
      },
    ],
  },
  {
    id: "docs",
    title: "Documentation",
    intro: "A space to write things down — one space per board, nested pages, rich content and diagrams.",
    blocks: [
      { p: "Each board gets its own documentation space. Pick a space at the top, then build a tree of pages — perfect for runbooks, decisions, onboarding notes or anything you'd otherwise lose in chat." },
      { p: "Pages open in a clean reading view; if you have edit rights on the board you can switch a page into edit mode to change it." },
      { note: "Documentation is personal and saved on this device — it isn't synced to other board members." },
      { see: ["docs-pages", "docs-permissions", "docs-rich", "docs-attachments", "docs-whiteboard"] },
    ],
    children: [
      {
        id: "docs-pages",
        title: "Pages & the tree",
        blocks: [
          { ul: [
            "Create top-level pages, or sub-pages under any page, to organise by topic.",
            "Drag pages in the tree to reorder them or nest them inside another page.",
            "Deleting a page asks you to confirm and removes its sub-pages with it.",
          ] },
          { p: "The editor is a clean, document-style writing surface with a large title — it uses most of the width so you can see more at once." },
          { see: ["docs-permissions", "docs-rich", "docs-whiteboard"] },
        ],
      },
      {
        id: "docs-permissions",
        title: "Reading & editing",
        blocks: [
          { ul: [
            "A page opens in read view — click it in the tree to read it.",
            "To change a page you need edit rights on its board (Editor, Admin or Owner — boards you own are always editable). Then click the pencil on a tree row, or the Edit button at the top of the open page.",
            "Click Done to go back to reading. Without edit rights you get a clean, read-only space.",
          ] },
          { see: ["board-members", "docs-pages"] },
        ],
      },
      {
        id: "docs-rich",
        title: "Images & tables",
        blocks: [
          { ul: [
            "Insert images directly into a page.",
            "Insert tables from the size picker, then resize columns by dragging their borders.",
            "Make a table wider than the page — it scrolls horizontally with a themed scrollbar underneath, so wide data stays readable.",
          ] },
          { tip: "To widen a column, hover its right border until the resize cursor appears, then drag. Pull past the page edge and the table scrolls instead of squashing the other columns." },
          { see: ["board-richtext", "docs-attachments", "docs-whiteboard"] },
        ],
      },
      {
        id: "docs-attachments",
        title: "Attaching documents",
        blocks: [
          { p: "Drop a file from your vault straight into a page — or upload a new one — with the paperclip button, the same way board tickets attach files." },
          { ul: [
            "The file stays encrypted on Arweave; the page only references it.",
            "Each file has an eye toggle — turn the preview on to see it inline (images as pictures, PDFs and text in a frame), or leave it as a compact link. You decide, per file.",
            "Open opens the decrypted file in a new tab.",
          ] },
          { see: ["uploads", "vault", "docs-whiteboard"] },
        ],
      },
      {
        id: "docs-whiteboard",
        title: "Whiteboards & schemes",
        blocks: [
          { p: "Drop a whiteboard straight into a page to sketch a diagram or scheme (Miro-style) right alongside your text, so words and pictures live together." },
          { ul: [
            "Draw shapes, arrows and text on the canvas; it saves into the page automatically.",
            "The canvas is fully editable while the page is in edit mode, and read-only when you're just reading.",
            "Copy, paste and keyboard shortcuts work inside the canvas.",
            "Use the × on the block to remove a whiteboard.",
          ] },
          { see: ["docs-permissions", "docs-pages"] },
        ],
      },
    ],
  },
  {
    id: "chat",
    title: "Chat",
    intro: "Private, end-to-end encrypted group chats with people from your Access Keys.",
    blocks: [
      { p: "Start a chat, choose its members, and message them. Every message is encrypted with a key only the members hold — the same Multi-Party Encryption your shared boards use — so no server can read it." },
      { h: "Starting a chat" },
      { ol: [
        "Open Chat and click New chat.",
        "Give it a name and set your display name (what others see on your messages).",
        "Add members — search your Access Keys, or paste an Arweave address / public key for someone new (new wallets must be added by public key).",
        "Create — each member is granted the chat key so only they can read it.",
      ] },
      { h: "Messaging" },
      { ul: [
        "Type and press Enter to send (Shift+Enter for a new line). Messages show their time, grouped under day dividers, newest at the bottom by the composer.",
        "Only the latest messages load — scroll up to pull in older ones, 20 at a time.",
        "Hover a message to react (👍 ❤️ 😂 …); click a reaction again to remove yours.",
        "Hover your own message and click the pencil to edit it. Edited messages are marked “edited”, and because the text changed, the “Seen” resets so people read the new version (and it re-notifies them).",
        "When someone reads your latest message you'll see “Seen” (or “Seen by N” in a group) under it.",
        "Link a board ticket, sub-ticket, calendar event or Service Desk record with the + button by the message box: search, pick one, and it appears as a coloured pill right in the box as you type — indigo for a ticket (its key, e.g. DESIGN-12), green for an event, and a typed pill for a record (e.g. INC0000001). Typing a ticket key or record number still auto-links too.",
        "A chip opens the right place — tickets open the Board, events open the Calendar, records open the Service Desk — and only for people who actually have access. Anyone without it just sees a plain, unlinked chip (never a raw code).",
        "Writing a lot? The expand toggle at the message box's top-right grows it; the + and Send buttons match its height.",
        "The chat owner can add more members later from the members bar.",
      ] },
      { h: "Names & notifications" },
      { ul: [
        "Open the members bar (the “N members” line) and click the pencil on anyone to rename them — it's just for you, so wallets are easy to recognise.",
        "Chats with unread messages jump to the top of the list with a red dot; the Chat icon in the sidebar shows a badge so you notice even from another tab.",
        "Opening the Chat tab jumps straight to your most recent conversation. Use the search box to find another.",
      ] },
      { note: "It isn't realtime — messages are published to Arweave and read back, which takes ~seconds (there's no central server). The chat polls faster while you're active. As with shared boards, a member who kept the key could still read new messages." },
      { see: ["sharing", "security-encryption", "board-sync"] },
    ],
  },
  {
    id: "calendar",
    title: "Calendar",
    intro: "Meetings, tasks and reminders in one place — alongside your board tickets' due dates.",
    blocks: [
      { p: "A Teams-style week view: all 7 days as 24-hour columns. Move with the arrows or Today, or pick a date to jump to that week." },
      { ul: [
        "Click-and-drag down a day (say 4pm to 5pm) to create an event for exactly that slot. Click any event to open it.",
        "Overlapping events split the column side by side, so a busy hour is easy to read. A red line marks the current time.",
        "Each event has a type — Meeting, Task, Event or Reminder — plus an optional start/end time, location and notes. Events with no time, and board ticket due dates, sit in the all-day row at the top.",
      ] },
      { h: "Invite people" },
      { ul: [
        "Open an event and add people under “People” (search your Access Keys). They'll see the event on their own calendar — it's encrypted to them, like a shared board or chat.",
        "If the event is linked to a board (see below), invites are limited to that board's members — so the event stays within the team that owns it.",
        "Everyone gets a 15-minute reminder by default. The owner can change reminders in the event; an invitee can mute reminders for an invite from its details.",
        "Invited events are read-only for guests (only the owner edits). Updates and deletes by the owner sync to everyone (~seconds, via Arweave).",
      ] },
      { h: "Custom repeats" },
      { ul: [
        "Set Repeat to Daily, Weekly or Monthly, then “every N” — so every 2 weeks, every 3 days, etc.",
        "Weekly is fully custom: tick one or several weekdays. “Every 2 weeks on Friday”, or “every week on Wed + Sun + Mon” — both just work.",
        "Choose Ends → Never or On a date. Repeating events show a ↻; deleting one lets you remove just that occurrence or the whole series.",
      ] },
      { h: "Board, links, tickets & places" },
      { ul: [
        "Link the event to a Board (optional, any type): pick a board — and a project — in the editor. The board then shows on the event's chip when you reference it in chat, so people can see which project it belongs to, and it limits who you can invite to that board's members.",
        "Any event can carry an optional Link, plus Related records — link the board tickets, Service Desk records (INC/REQ/CHG/PRB) and other events this relates to. Search, tick more than one, and each becomes a clickable chip that jumps to the right place; the link shows on the other side too.",
        "Set the type to Meeting for a meeting link — paste your own (Zoom/Teams/Meet) or hit Generate for an instant no-sign-in Jitsi room (chat built in). Anyone who opens the link joins and hosts with full controls — no login or wallet — and the first person in is the admin. Use Copy link to share it anywhere.",
        "Start typing in Location to get address suggestions (free, via OpenStreetMap) — click the one you mean, and use “Open in maps” to view it. Guests get the address and that link on the invite.",
        "If you include a house number you'll only see exact matches; when there's no exact match it shows none rather than a near-miss — drop the number to find the street, or just type the place/city. (Typed addresses are sent to OpenStreetMap to find the spot.)",
      ] },
      { h: "Reminders" },
      { ul: [
        "Under “Remind me before”, pick lead times (5, 10, 15, 30 min, 1 hr, 1 day — choose several). You'll get a notification ahead of the start, with a click-through to the meeting.",
        "Reminders use your browser's notifications (you'll be asked once) plus an in-app alert, and work as long as the app is open — even on another tab.",
      ] },
      { note: "Your own events are saved on this device; invited events are encrypted to each guest and read back from Arweave (no central server, so syncing takes ~seconds). Removing one guest from an event doesn't cryptographically revoke them — same soft-revoke tradeoff as boards and chat." },
      { see: ["board-tickets", "servicedesk", "sharing", "chat"] },
    ],
  },
  {
    id: "timesheet",
    title: "Timesheet",
    intro: "A calendar-style week view of every hour logged across your boards — cards, calendar and Service Desk time, side by side.",
    blocks: [
      { p: "The Timesheet shows a week at a glance, just like the Calendar: seven day columns with the time you logged as coloured blocks. Time with no fixed slot (Service Desk, holidays, notes) shows as a block down the day column. Move between weeks with the arrows or “Today”." },
      { h: "Where the time comes from" },
      { ul: [
        "board tickets (blue) — time logged on a ticket's worklog, placed by its from–to.",
        "Calendar (purple) — your events that are linked to a board, by their start/end.",
        "Service Desk (amber) — time a record spent in a working state, worked out from its history, shown as an all-day block on the day it happened.",
        "Holiday / Vacation (teal) and Normal entries (green) — markers spanning a day, period or month (or a from–to). Service Desk and these are sized by their real hours and share the column with everything else.",
      ] },
      { h: "Adding time" },
      { ul: [
        "Pick the board from the dropdown by the title (like the Dashboard), then “+ Add time” offers a Calendar event — the full editor (title, people, related records, date, start, end, repeat, notes) that also lands on your Calendar; a board ticket — pick the ticket (required), a title, the date and a from–to; a Normal entry across a day, period or month (or a from–to); and a Holiday / Vacation request. New entries default to today's date.",
        "Everything you add shows on the week immediately, coloured by source.",
        "Click any block to edit or remove it — changes apply everywhere (a card's worklog, your calendar, etc.). You can edit your own time; board admins/owners can edit anyone's. Service Desk time is derived from a record's history, so edit it on the record itself.",
      ] },
      { h: "Filtering members" },
      { ul: [
        "Managers (board admins/owners) see everyone's time by default. The Members filter ticks people off — or hit “Only me” to see just your own.",
        "Editors and members without a manager role only ever see their own time.",
      ] },
      { h: "Holidays & approval" },
      { ul: [
        "Only Holiday / Vacation requests need sign-off. You add one (a day, a period or a month) and it's sent to your board's managers as “pending”. A board owner's own request is auto-approved.",
        "Managers get a “Holiday & vacation requests” list under the grid with Approve / Reject; the request shows ⏳ pending, ✓ approved or ✗ rejected on the grid. Hit Refresh to pull the latest from teammates.",
        "When you have requests waiting, a count shows on the Timesheet icon in the left menu and on the board dropdown by the title — switch to that board to action them.",
        "Everything else — board tickets, calendar and Service Desk — is just logged and counted; it never needs approval.",
      ] },
      { note: "Card and Service-Desk time live on the board, so on a shared board they sync (encrypted) to its members and managers review across wallets. Calendar time is read from your own events. Same near-realtime (~seconds) and soft-revoke tradeoffs as the board itself." },
      { see: ["board", "board-tickets", "servicedesk", "calendar", "sharing"] },
    ],
  },
  // {
  //   id: "arns",
  //   title: "ArNS Domains",
  //   intro: "Give your content a friendly, human-readable name.",
  //   blocks: [
  //     { p: "ArNS (Arweave Name System) maps a readable name to your content instead of a long transaction ID — like a domain name for permanent data." },
  //     { ul: [
  //       "Claim a free friendly name (an undername) that points at your content.",
  //       "Share the name instead of a raw address or ID.",
  //     ] },
  //   ],
  // },
  {
    id: "settings",
    title: "Settings",
    intro: "Configuration, keys and housekeeping.",
    blocks: [
      { ul: [
        "Gateway and network options for how content is fetched and published.",
        "Download passwords for the password-protected export feature.",
        "Export recovery keys — do this before switching browser or device.",
        "Clear cached keys from this browser when you want to lock things down.",
      ] },
      { note: "Clearing cached keys means documents won't open instantly until your keys are restored or re-derived from your wallet. Export your recovery keys first." },
      { see: ["security-recovery"] },
    ],
  },
  {
    id: "faq",
    title: "FAQ & troubleshooting",
    intro: "Quick answers to the things people hit most. Tap a question to expand it.",
    blocks: [
      { qa: [
        { q: "A document won't open or decrypt", a: "Make sure your wallet is connected and unlocked — your keys and workspace recover from Arweave on reconnect. If a single file still won't open right after a cache clear, give Arweave a moment to respond and then Refresh; you can also re-import keys from Settings." },
        { q: "Someone can't receive a share", a: "Their wallet is probably new and not discoverable on-chain. Ask them to copy their public key from View Document and share it with you, then add them by public key." },
        { q: "A teammate doesn't see my board change", a: "Shared boards sync through Arweave, which takes a few minutes to index. Use Refresh; if it still doesn't appear, confirm they're an active member with at least Viewer access." },
        { q: "Can I delete something permanently?", a: "No. Arweave is permanent — you can revoke access and hide items, but copies already stored or downloaded can't be erased. Only upload what you're comfortable keeping forever (encrypted)." },
        { q: "I'm moving to a new computer", a: "Just connect the same wallet on the new computer and approve one unlock — your master key recovers from Arweave and your vault, boards, chats, calendar and settings restore from the encrypted backup automatically. Exporting recovery keys from Settings is an optional extra backup, not a requirement; keep your wallet seed phrase safe." },
        { q: "Is my data readable by the app's servers?", a: "No. Files are encrypted in your browser before upload; servers only relay encrypted data and public metadata such as names and tags." },
      ] },
      { see: ["security", "sharing-how", "board-sync"] },
    ],
  },
];

// ── helpers ──────────────────────────────────────────────────────────────────
function flatten(topics: Topic[], parents: string[] = [], out: { topic: Topic; path: string[] }[] = []) {
  for (const t of topics) {
    out.push({ topic: t, path: parents });
    if (t.children) flatten(t.children, [...parents, t.id], out);
  }
  return out;
}

function topicText(t: Topic): string {
  const parts: string[] = [t.title, t.intro ?? ""];
  for (const b of t.blocks) {
    if ("p" in b) parts.push(b.p);
    else if ("h" in b) parts.push(b.h);
    else if ("ul" in b) parts.push(...b.ul);
    else if ("ol" in b) parts.push(...b.ol);
    else if ("tip" in b) parts.push(b.tip);
    else if ("note" in b) parts.push(b.note);
    else if ("qa" in b) for (const x of b.qa) parts.push(x.q, x.a);
  }
  return parts.join(" ").toLowerCase();
}

// The two-column help browser (topic tree + search on the left, reading pane on
// the right). Shared by the in-app Help tab and the public /help page so both use
// the exact same content and logic. `className` sizes the outer flex container.
export function HelpBrowser({ className = "", flow = false }: { className?: string; flow?: boolean }) {
  const flat = useMemo(() => flatten(TOPICS), []);
  const byId = useMemo(() => new Map(flat.map((f) => [f.topic.id, f])), [flat]);

  const [selId, setSelId] = useState("welcome");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set()); // subtopics collapsed by default; a topic opens when you read it
  const [query, setQuery] = useState("");
  const [navOpen, setNavOpen] = useState(false); // mobile topics drawer

  const sel = byId.get(selId)?.topic ?? TOPICS[0];
  const crumbs = (byId.get(selId)?.path ?? []).map((id) => byId.get(id)?.topic.title).filter(Boolean) as string[];

  // prev / next in reading order (depth-first), for the page footer
  const idx = flat.findIndex((f) => f.topic.id === selId);
  const prev = idx > 0 ? flat[idx - 1].topic : null;
  const next = idx >= 0 && idx < flat.length - 1 ? flat[idx + 1].topic : null;

  const q = query.trim().toLowerCase();
  const results = q ? flat.filter((f) => topicText(f.topic).includes(q)) : [];

  const titleOf = (id: string) => byId.get(id)?.topic.title ?? id;
  const open = (id: string) => {
    setSelId(id);
    setNavOpen(false); // close the mobile drawer after picking a topic
    const f = byId.get(id);
    const path = f?.path ?? [];
    const hasKids = !!f?.topic.children?.length;
    // Accordion: keep only this topic's branch open — opening one closes the others.
    setExpanded(new Set(hasKids ? [...path, id] : path));
  };
  const toggle = (id: string) => setExpanded((s) => {
    if (s.has(id)) { const n = new Set(s); n.delete(id); return n; } // collapse
    return new Set([...(byId.get(id)?.path ?? []), id]); // expand this branch only (close the rest)
  });

  const renderTree = (topics: Topic[], depth: number): React.ReactNode =>
    topics.map((t) => {
      const hasKids = !!t.children?.length;
      const isOpen = expanded.has(t.id);
      return (
        <div key={t.id}>
          <div
            className={`group flex items-center gap-0.5 rounded-lg pr-1 ${t.id === selId ? "bg-slate-800" : "hover:bg-slate-800/50"}`}
            style={{ paddingLeft: 4 + depth * 12 }}
          >
            <button onClick={() => hasKids && toggle(t.id)} className="flex h-6 w-4 shrink-0 items-center justify-center text-slate-500">
              {hasKids ? (
                <svg className={`h-3 w-3 transition-transform ${isOpen ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M9 6l6 6-6 6" /></svg>
              ) : (
                <span className="h-1 w-1 rounded-full bg-slate-600" />
              )}
            </button>
            <button onClick={() => open(t.id)} className={`min-w-0 flex-1 truncate py-1.5 text-left text-xs ${t.id === selId ? "text-slate-100" : "text-slate-300"}`}>{t.title}</button>
          </div>
          {hasKids && (
            <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
              <div className="overflow-hidden">{renderTree(t.children!, depth + 1)}</div>
            </div>
          )}
        </div>
      );
    });

  return (
    <div className={`relative flex gap-0 md:gap-4 ${flow ? "items-start" : "min-h-0"} ${className}`}>
        {navOpen && <div className="absolute inset-0 z-20 bg-black/50 md:hidden" onClick={() => setNavOpen(false)} aria-hidden />}
        {/* topic tree + search — slide-in drawer on mobile, static column on md+ */}
        <div className={`${flow ? "fixed" : "absolute"} inset-y-0 left-0 z-30 flex w-72 max-w-[85%] shrink-0 flex-col rounded-xl border border-slate-800 bg-slate-900 transition-transform duration-200 md:z-auto md:w-64 md:max-w-none md:translate-x-0 md:bg-slate-900/40 ${flow ? "md:sticky md:top-4 md:max-h-[calc(100vh-7rem)] md:self-start" : "md:static"} ${navOpen ? "translate-x-0 shadow-2xl shadow-black/50" : "-translate-x-[110%]"}`}>
          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2 md:hidden">
            <span className="text-xs font-semibold text-slate-300">Topics</span>
            <button onClick={() => setNavOpen(false)} title="Close" className="rounded p-1 text-slate-400 hover:text-slate-200"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
          </div>
          <div className="border-b border-slate-800 p-2">
            <div className="relative">
              <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M21 21l-4-4" /></svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search help…"
                className="w-full rounded-lg border border-slate-700 bg-slate-800/60 py-1.5 pl-8 pr-7 text-xs text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
              />
              {query && (
                <button onClick={() => setQuery("")} title="Clear" className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-200">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 p-2">
            {q ? (
              results.length === 0 ? (
                <p className="px-1 py-6 text-center text-[11px] text-slate-600">No matches for “{query}”.</p>
              ) : (
                results.map((f) => (
                  <button key={f.topic.id} onClick={() => open(f.topic.id)} className={`block w-full rounded-lg px-2 py-1.5 text-left ${f.topic.id === selId ? "bg-slate-800" : "hover:bg-slate-800/50"}`}>
                    <span className="block truncate text-xs text-slate-200">{f.topic.title}</span>
                    {f.path.length > 0 && <span className="block truncate text-[10px] text-slate-500">{f.path.map(titleOf).join(" › ")}</span>}
                  </button>
                ))
              )
            ) : (
              renderTree(TOPICS, 0)
            )}
          </div>
        </div>

        {/* reading pane — borderless, document-style */}
        <div className={`min-w-0 flex-1 ${flow ? "" : "overflow-y-auto"}`}>
          <div className="mx-auto w-full max-w-4xl px-4">
            <button onClick={() => setNavOpen(true)} className="mb-3 mt-1 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-500 md:hidden">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
              Browse topics
            </button>
            {crumbs.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 pt-1 text-[11px] text-slate-500">
                {crumbs.map((c, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {c}
                    <svg className="h-2.5 w-2.5 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M9 6l6 6-6 6" /></svg>
                  </span>
                ))}
              </div>
            )}
            <h3 className="pt-1 text-2xl font-bold text-white">{sel.title}</h3>
            {sel.intro && <p className="mt-2 text-sm leading-relaxed text-slate-400">{sel.intro}</p>}

            <div className="mt-4 space-y-3">
              {sel.blocks.map((b, i) => <BlockView key={i} block={b} nav={open} titleOf={titleOf} />)}
            </div>

            {sel.children && sel.children.length > 0 && (
              <div className="mt-6 border-t border-slate-800 pt-4">
                <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-slate-500">In this section</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {sel.children.map((c) => (
                    <button key={c.id} onClick={() => open(c.id)} className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-left transition-colors hover:border-slate-700 hover:bg-slate-800/50">
                      <span className="text-xs font-medium text-slate-200">{c.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* prev / next page navigation */}
            <div className="mt-8 grid grid-cols-2 gap-3 border-t border-slate-800 pt-4 pb-12">
              {prev ? (
                <button onClick={() => open(prev.id)} className="group/n flex flex-col items-start rounded-lg border border-slate-800 px-3 py-2 text-left transition-colors hover:border-slate-700 hover:bg-slate-800/40">
                  <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500"><svg className="h-3 w-3 transition-transform group-hover/n:-translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M15 6l-6 6 6 6" /></svg> Back</span>
                  <span className="mt-0.5 text-xs font-medium text-slate-200 group-hover/n:text-white">{prev.title}</span>
                </button>
              ) : <span />}
              {next ? (
                <button onClick={() => open(next.id)} className="group/n flex flex-col items-end rounded-lg border border-slate-800 px-3 py-2 text-right transition-colors hover:border-slate-700 hover:bg-slate-800/40">
                  <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">Next <svg className="h-3 w-3 transition-transform group-hover/n:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M9 6l6 6-6 6" /></svg></span>
                  <span className="mt-0.5 text-xs font-medium text-slate-200 group-hover/n:text-white">{next.title}</span>
                </button>
              ) : <span />}
            </div>
          </div>
        </div>
      </div>
  );
}

// In-app Help tab — the shared browser under a dashboard heading.
export default function HelpView() {
  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col">
      <div className="mb-4 shrink-0">
        <h2 className="text-lg font-semibold text-white">Help &amp; documentation</h2>
        <p className="text-xs text-slate-500 mt-0.5">How the app works, end to end — browse or search topics on the left.</p>
      </div>
      <HelpBrowser className="flex-1 min-h-0" />
    </div>
  );
}

function BlockView({ block, nav, titleOf }: { block: Block; nav: (id: string) => void; titleOf: (id: string) => string }) {
  if ("h" in block) return <h4 className="pt-2 text-sm font-semibold text-slate-100">{block.h}</h4>;
  if ("p" in block) return <p className="text-sm leading-relaxed text-slate-300">{block.p}</p>;
  if ("ul" in block) return (
    <ul className="space-y-1.5">
      {block.ul.map((li, i) => (
        <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-300">
          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-indigo-400/70" />
          <span className="min-w-0">{li}</span>
        </li>
      ))}
    </ul>
  );
  if ("ol" in block) return (
    <ol className="space-y-1.5">
      {block.ol.map((li, i) => (
        <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-slate-300">
          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-semibold text-slate-300">{i + 1}</span>
          <span className="min-w-0">{li}</span>
        </li>
      ))}
    </ol>
  );
  if ("tip" in block) return (
    <div className="flex gap-2.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2.5">
      <svg className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3a6 6 0 00-3 11.2V16h6v-1.8A6 6 0 0012 3zM9.5 20h5M10 22h4" /></svg>
      <p className="text-xs leading-relaxed text-indigo-100">{block.tip}</p>
    </div>
  );
  if ("see" in block) return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      <span className="text-[11px] font-medium text-slate-500">See also</span>
      {block.see.map((id) => (
        <button key={id} onClick={() => nav(id)} className="flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/50 px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:border-indigo-500/50 hover:text-indigo-200">
          {titleOf(id)}
          <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M9 6l6 6-6 6" /></svg>
        </button>
      ))}
    </div>
  );
  if ("qa" in block) return <QA items={block.qa} />;
  // note
  return (
    <div className="flex gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
      <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 4.3 2.6 18a2 2 0 001.7 3h15.4a2 2 0 001.7-3L13.7 4.3a2 2 0 00-3.4 0z" /></svg>
      <p className="text-xs leading-relaxed text-amber-100">{block.note}</p>
    </div>
  );
}

function QA({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-2">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={i} className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
            <button onClick={() => setOpen(isOpen ? null : i)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium text-slate-200 hover:bg-slate-800/40">
              <span className="min-w-0">{item.q}</span>
              <svg className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${isOpen ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M9 6l6 6-6 6" /></svg>
            </button>
            {isOpen && <p className="px-3 pb-3 text-sm leading-relaxed text-slate-400">{item.a}</p>}
          </div>
        );
      })}
    </div>
  );
}
