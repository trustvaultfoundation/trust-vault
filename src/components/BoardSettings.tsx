"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Member,
  Role,
  Column,
  Project,
  ROLES,
  BoardMeta,
  BoardState,
  boardColumns,
  boardProjects,
  DEFAULT_COLUMNS,
  EXTRA_COLUMNS,
  columnColor,
  shortAddr,
  initials,
  canManage,
  newId,
} from "@/lib/board";
import { loadIdentities, saveIdentities, AuthorizedIdentity, isValidArweaveAddress } from "@/lib/accessKeys";
import { looksLikePublicKey } from "@/lib/recipients";
import {
  loadDepmSettings, saveDepmSettings, publishProject, unpublishProject, reconcileProjects,
  CATEGORIES, EMPLOYEE_RANGES, SOCIAL_KINDS, type DepmSettings, type DepmProjectInfo, type SocialKind,
} from "@/lib/depm";
import { ThemedSelect, ThemedCombo } from "./BoardDropdowns";
import { SocialIcon, WebsiteIcon, WhitepaperIcon } from "./SocialIcons";
import { PublicImg } from "./PublicImg";
import { uploadPublicFile } from "@/lib/turbo";

const roleOpts = ROLES.filter((r) => r.id !== "owner").map((r) => ({ value: r.id, label: r.label }));

type Toast = (m: string, t?: "error" | "info" | "warning") => void;
const roleLabel = (r: Role) => ROLES.find((x) => x.id === r)?.label ?? r;

// Board settings drawer: Members (share / roles, from Access Keys) + Columns
// (show/hide, rename, reorder, add custom, delete) tabs.
export function BoardSettings({
  address,
  meta,
  state,
  myRole,
  busy,
  onClose,
  onToast,
  onShare,
  onAddMember,
  onSetRole,
  onRemoveMember,
  onColumns,
  projects,
  currentProjectId,
  onProjectColumns,
  onAddColumn,
}: {
  address: string;
  meta: BoardMeta;
  state: BoardState;
  myRole: Role;
  busy: boolean;
  onClose: () => void;
  onToast: Toast;
  onShare: () => void | Promise<void>;
  onAddMember: (token: string, label: string, role: Role) => void | Promise<void>;
  onSetRole: (addr: string, role: Role) => void | Promise<void>;
  onRemoveMember: (addr: string) => void | Promise<void>;
  onColumns: (columns: Column[]) => void;
  projects: Project[];
  currentProjectId: string;
  onProjectColumns: (projectId: string, columnIds: string[]) => void;
  onAddColumn: (col: Column, projectId: string) => void;
}) {
  const [tab, setTab] = useState<"members" | "columns" | "depm">("members");
  const [shown, setShown] = useState(false);
  const manage = canManage(myRole);
  const isOwner = meta.owner === address; // DePM publishing is owner-only

  // Slide in on open; slide out then unmount on close (× or click-outside / Esc).
  const close = () => { setShown(false); setTimeout(onClose, 200); };
  useEffect(() => {
    setShown(true);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      <div className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`} onClick={close} />
      <div className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-slate-800 bg-slate-900 shadow-2xl transition-transform duration-200 ${shown ? "translate-x-0" : "translate-x-full"}`}>
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-3 shrink-0">
          <span className="text-sm font-medium text-slate-200">Board settings · {meta.title}</span>
          <button onClick={close} aria-label="Close" className="text-slate-500 hover:text-slate-200 transition-colors">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="flex shrink-0 gap-1 border-b border-slate-800 px-3 pt-2">
          {(isOwner ? (["members", "columns", "depm"] as const) : (["members", "columns"] as const)).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-t-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${tab === t ? "bg-slate-800 text-slate-100" : "text-slate-500 hover:text-slate-300"}`}>
              {t === "depm" ? "DePM" : t}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
          {tab === "members" ? (
            <MembersTab address={address} meta={meta} members={meta.shared ? state.members : []} manage={manage} myRole={myRole} busy={busy} onToast={onToast} onShare={onShare} onAddMember={onAddMember} onSetRole={onSetRole} onRemoveMember={onRemoveMember} />
          ) : tab === "columns" ? (
            <ColumnsTab state={state} manage={manage} onColumns={onColumns} projects={projects} currentProjectId={currentProjectId} onProjectColumns={onProjectColumns} onAddColumn={onAddColumn} />
          ) : (
            <DepmTab address={address} boardId={meta.id} state={state} onToast={onToast} />
          )}
        </div>

        <div className="border-t border-slate-800 px-4 py-2.5 shrink-0">
          <p className="text-[10px] leading-relaxed text-slate-600">
            {meta.shared
              ? "Changes propagate through Arweave (~minutes). Roles & column config are app-enforced."
              : "Private board — settings stay on this device until you share it."}
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// DePM tab (owner only): make this board public on the /projects page, or take it private.
function DepmTab({ address, boardId, state, onToast }: { address: string; boardId: string; state: BoardState; onToast: Toast }) {
  const [s, setS] = useState<DepmSettings>(() => {
    const loaded = loadDepmSettings(boardId);
    return { ...loaded, projects: reconcileProjects(state, loaded) };
  });
  const [busy, setBusy] = useState(false);
  const field = "w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none";
  const allProjects = boardProjects(state);
  const projName = (id: string) => allProjects.find((p) => p.id === id)?.name ?? "Project";
  const publicProjects = s.projects.filter((p) => p.isPublic);
  const privateProjects = allProjects.filter((p) => !s.projects.find((x) => x.id === p.id)?.isPublic);

  // Update settings; while the board is public, persist immediately so the board's live auto-publisher
  // picks up the change (no manual "update" step). Keep projectIds cleared so we don't re-migrate.
  const save = (p: Partial<DepmSettings>) => setS((v) => { const next = { ...v, ...p, projectIds: undefined }; if (next.isPublic) saveDepmSettings(boardId, next); return next; });
  const setSocial = (kind: SocialKind, url: string) => save({ socials: { ...s.socials, [kind]: url } });
  const setProject = (id: string, patch: Partial<DepmProjectInfo>) =>
    save({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  const publish = async () => {
    if (!s.company.trim()) { onToast("Add a company / project name first.", "warning"); return; }
    if (publicProjects.length === 0) { onToast("Pick at least one project to publish.", "warning"); return; }
    setBusy(true);
    try {
      const next = { ...s, isPublic: true };
      await publishProject(address, boardId, state, next);
      saveDepmSettings(boardId, next); setS(next);
      onToast("Published to the public DePM page — it updates automatically as you work.", "info");
    } catch (e) { onToast(e instanceof Error ? e.message : "Couldn't publish.", "error"); }
    finally { setBusy(false); }
  };
  const makePrivate = async () => {
    setBusy(true);
    try {
      await unpublishProject(address, boardId, s.company || "Project");
      const next = { ...s, isPublic: false }; saveDepmSettings(boardId, next); setS(next);
      onToast("Removed from the public DePM page.", "info");
    } catch (e) { onToast(e instanceof Error ? e.message : "Couldn't update.", "error"); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-800 bg-slate-800/40 p-3 text-[11px] leading-relaxed text-slate-400">
        <p className="mb-1 font-semibold uppercase tracking-wide text-indigo-300">DePM · what “public” means</p>
        Publishing makes a <strong className="text-slate-300">plaintext snapshot</strong> of the projects you pick — your company profile,
        and each chosen project&apos;s columns + ticket <em>titles</em> and progress — visible to everyone on the{" "}
        <a href="/projects" className="text-indigo-300 hover:underline">Projects page</a>, so supporters and investors see what you&apos;re really
        shipping. It <strong className="text-slate-300">updates automatically</strong> as you work and publishing is{" "}
        <strong className="text-slate-300">free — no wallet approval</strong>. Ticket descriptions, comments, attachments, assignees and
        member info are <strong className="text-slate-300">not</strong> included. It&apos;s public and permanent on Arweave; “Make private”
        hides it from the app but can&apos;t erase what was already published.
      </div>

      {/* ── company profile ── */}
      <Section title="Company profile">
        <LogoField s={s} save={save} onToast={onToast} />
        <label className="block text-xs font-medium text-slate-400">Company / project name *
          <input value={s.company} onChange={(e) => save({ company: e.target.value })} placeholder="e.g. TrustVault" className={`${field} mt-1`} />
        </label>
        <label className="block text-xs font-medium text-slate-400">Tagline
          <input value={s.tagline} onChange={(e) => save({ tagline: e.target.value })} placeholder="One line on what you do" className={`${field} mt-1`} />
        </label>
        <label className="block text-xs font-medium text-slate-400">About
          <textarea value={s.description} onChange={(e) => save({ description: e.target.value })} rows={3} placeholder="What is this company building, and why?" className={`${field} mt-1 resize-y`} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><p className="mb-1 text-xs font-medium text-slate-400">Category</p>
            <ThemedCombo value={s.category} onChange={(v) => save({ category: v })} placeholder="Search categories…" allowClear options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
          </div>
          <div><p className="mb-1 text-xs font-medium text-slate-400">Team size</p>
            <ThemedSelect value={s.employees} onChange={(v) => save({ employees: v })} options={[{ value: "", label: "— Select —" }, ...EMPLOYEE_RANGES.map((c) => ({ value: c, label: c }))]} />
          </div>
          <label className="block text-xs font-medium text-slate-400">Founded
            <input value={s.founded} onChange={(e) => save({ founded: e.target.value })} placeholder="2024" className={`${field} mt-1`} />
          </label>
          <label className="block text-xs font-medium text-slate-400">Location
            <input value={s.location} onChange={(e) => save({ location: e.target.value })} placeholder="Remote · Berlin · …" className={`${field} mt-1`} />
          </label>
        </div>
      </Section>

      {/* ── links & socials (icon + field) ── */}
      <Section title="Links & socials">
        <IconField icon={<WebsiteIcon />} value={s.website} onChange={(v) => save({ website: v })} placeholder="example.com" />
        <WhitepaperField s={s} save={save} onToast={onToast} />
        {SOCIAL_KINDS.map(({ kind, placeholder }) => (
          <IconField key={kind} icon={<SocialIcon kind={kind} />} value={s.socials[kind] ?? ""} onChange={(v) => setSocial(kind, v)} placeholder={placeholder} />
        ))}
      </Section>

      {/* ── projects to publish (each explained) ── */}
      <Section title="Projects to publish">
        <p className="-mt-1 text-[11px] leading-relaxed text-slate-500">
          New projects are <strong className="text-slate-400">private by default</strong>. Pick the ones to show publicly and describe each.
        </p>
        {publicProjects.length > 0 && (
          <div className="space-y-2">
            {publicProjects.map((p) => (
              <div key={p.id} className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-slate-100">{projName(p.id)}</span>
                  <button onClick={() => setProject(p.id, { isPublic: false })} className="shrink-0 rounded-md border border-slate-700 px-2 py-0.5 text-[10px] font-medium text-rose-300 hover:bg-slate-800">Remove</button>
                </div>
                <textarea value={p.description} onChange={(e) => setProject(p.id, { description: e.target.value })} rows={2} placeholder={`What is "${projName(p.id)}" about?`} className={`${field} mt-2 resize-y text-xs`} />
              </div>
            ))}
          </div>
        )}
        {privateProjects.length > 0 ? (
          <div>
            <p className="mb-1 text-xs font-medium text-slate-400">Add a project to publish</p>
            <ThemedSelect
              value=""
              onChange={(id) => id && setProject(id, { isPublic: true })}
              options={[{ value: "", label: "Select a project…" }, ...privateProjects.map((p) => ({ value: p.id, label: p.name }))]}
            />
          </div>
        ) : allProjects.length === 0 ? (
          <p className="text-xs text-slate-500">This board has no projects yet.</p>
        ) : (
          <p className="text-[11px] text-slate-600">All projects are public.</p>
        )}
      </Section>

      <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-800/40 p-3">
        <span className="text-sm text-slate-200">{s.isPublic ? "Public — updates live" : "Private"}</span>
        {s.isPublic
          ? <button onClick={makePrivate} disabled={busy} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-slate-700 disabled:opacity-50">Make private</button>
          : <button onClick={publish} disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50">{busy ? "Publishing…" : "Make public"}</button>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

// A social/link row: a fixed icon on the left, the URL field filling the rest — cleaner than labels.
function IconField({ icon, value, onChange, placeholder }: { icon: React.ReactNode; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-700 bg-slate-800/60 text-slate-400">{icon}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
    </div>
  );
}

// Whitepaper: paste a URL, OR upload a PDF stored PUBLICLY on Arweave (same Turbo upload the board uses —
// free under ~100 KiB, otherwise it draws on Turbo credits). Public/unencrypted so anyone on the Projects
// page can open it. The upload is an icon to the RIGHT of the link field; PDFs only.
function WhitepaperField({ s, save, onToast }: { s: DepmSettings; save: (p: Partial<DepmSettings>) => void; onToast: Toast }) {
  const [busy, setBusy] = useState(false);
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) { onToast("Please choose a PDF file.", "warning"); return; }
    setBusy(true);
    try {
      const { txId, name } = await uploadPublicFile(file);
      save({ whitepaperFile: { txId, name } });
      onToast("Whitepaper uploaded to Arweave.", "info");
    } catch (err) { onToast(err instanceof Error ? err.message : "Upload failed.", "error"); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-700 bg-slate-800/60 text-slate-400"><WhitepaperIcon /></span>
        <input value={s.whitepaper} onChange={(e) => save({ whitepaper: e.target.value })} placeholder="Whitepaper / docs URL" className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
        <label title="Upload a PDF (public)" aria-label="Upload a PDF" className={`grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-slate-700 bg-slate-800/60 transition-colors hover:border-indigo-500/50 hover:text-indigo-200 ${busy ? "text-indigo-300" : "text-slate-400"}`}>
          {busy
            ? <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M12 3a9 9 0 109 9" /></svg>
            : <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L8 8m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>}
          <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={busy} onChange={pick} />
        </label>
      </div>
      {s.whitepaperFile?.txId && (
        <div className="ml-11 flex items-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/5 px-2.5 py-1.5">
          <WhitepaperIcon />
          <a href={`https://arweave.net/${s.whitepaperFile.txId}`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-xs text-indigo-300 hover:underline">{s.whitepaperFile.name}</a>
          <button onClick={() => save({ whitepaperFile: undefined })} className="shrink-0 rounded-md border border-slate-700 px-2 py-0.5 text-[10px] font-medium text-rose-300 hover:bg-slate-800">Remove</button>
        </div>
      )}
    </div>
  );
}

// Company logo: a small public image so cards/detail aren't just text. Icon-only uploader with a preview.
function LogoField({ s, save, onToast }: { s: DepmSettings; save: (p: Partial<DepmSettings>) => void; onToast: Toast }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null); // local object URL — shows instantly, before indexing
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { onToast("Please choose an image file.", "warning"); return; }
    if (file.size > 400 * 1024) { onToast("Logo must be under 400 KB.", "warning"); return; }
    setBusy(true);
    setPreview(URL.createObjectURL(file)); // instant feedback while it uploads + indexes
    try {
      const { txId } = await uploadPublicFile(file);
      save({ logo: { txId } });
      onToast("Logo uploaded.", "info");
    } catch (err) { setPreview(null); onToast(err instanceof Error ? err.message : "Upload failed.", "error"); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-700 bg-slate-800/60">
        {preview || s.logo?.txId
          ? <PublicImg txId={s.logo?.txId ?? ""} override={preview ?? undefined} alt="Logo" className="h-full w-full object-cover" />
          : <span className="text-lg font-bold text-slate-500">{(s.company || "?").slice(0, 1).toUpperCase()}</span>}
      </span>
      <div>
        <p className="text-xs font-medium text-slate-300">Company logo</p>
        <p className="mb-1.5 text-[10px] text-slate-500">Square image (PNG/SVG), under 400 KB.</p>
        <div className="flex items-center gap-1.5">
          <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-[11px] font-medium hover:border-indigo-500/50 hover:text-indigo-200 ${busy ? "text-indigo-300" : "text-slate-300"}`}>
            <svg className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>{busy ? <path strokeLinecap="round" d="M12 3a9 9 0 109 9" /> : <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L8 8m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />}</svg>
            {busy ? "Uploading…" : s.logo?.txId ? "Replace" : "Upload"}
            <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={pick} />
          </label>
          {s.logo?.txId && <button onClick={() => save({ logo: undefined })} className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] font-medium text-rose-300 hover:bg-slate-800">Remove</button>}
        </div>
      </div>
    </div>
  );
}

function MembersTab({
  address, meta, members, manage, myRole, busy, onToast, onShare, onAddMember, onSetRole, onRemoveMember,
}: {
  address: string; meta: BoardMeta; members: Member[]; manage: boolean; myRole: Role; busy: boolean;
  onToast: Toast;
  onShare: () => void | Promise<void>;
  onAddMember: (token: string, label: string, role: Role) => void | Promise<void>;
  onSetRole: (addr: string, role: Role) => void | Promise<void>;
  onRemoveMember: (addr: string) => void | Promise<void>;
}) {
  const [identities, setIdentities] = useState<AuthorizedIdentity[]>(() => loadIdentities(address));
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [role, setRole] = useState<Role>("editor");

  // Reload the address book when this tab opens / the wallet changes, so a name you edited
  // elsewhere (hovercard / profile / Access Keys) shows up here too.
  useEffect(() => { setIdentities(loadIdentities(address)); }, [address, members.length]);
  // Prefer the name YOU saved in Access Keys over the member's stored board label.
  const nameOf = (m: Member) => identities.find((i) => i.address === m.address)?.label?.trim() || m.label;

  const pick = (addr: string) => { const id = identities.find((i) => i.address === addr); if (id) { setToken(id.publicKey || id.address); setLabel(id.label || shortAddr(id.address)); } };
  const submit = async () => {
    const tkn = token.trim();
    if (!tkn) { onToast("Enter an address or public key.", "error"); return; }
    if (!isValidArweaveAddress(tkn) && !looksLikePublicKey(tkn)) { onToast("That doesn't look like an address or public key.", "error"); return; }
    await onAddMember(tkn, label.trim(), role);
    if (isValidArweaveAddress(tkn)) {
      const list = loadIdentities(address);
      if (!list.some((i) => i.address === tkn)) saveIdentities(address, [...list, { address: tkn, label: label.trim() || shortAddr(tkn), hasPublicKey: false, addedAt: Date.now() }]);
    }
    setToken(""); setLabel("");
  };

  if (!meta.shared) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-800/40 p-4 text-center">
        <p className="text-sm text-slate-300">This board is private to your wallet.</p>
        <p className="mt-1 text-xs text-slate-500">Share it to collaborate — its contents get encrypted and published to Arweave, and you can invite people.</p>
        <button onClick={onShare} disabled={busy || myRole !== "owner"} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
          {busy ? "Sharing…" : "Share board"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        {[...members].sort((a, b) => Number(!!a.inactive) - Number(!!b.inactive)).map((m) => (
          <div key={m.address} className={`flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-800/40 px-2.5 py-2 ${m.inactive ? "opacity-60" : ""}`}>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600/30 text-[10px] font-medium text-indigo-200">{initials(nameOf(m))}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-slate-200">{nameOf(m)}{m.address === address ? " (you)" : ""}</p>
              <p className="truncate text-[10px] text-slate-500">{shortAddr(m.address)}</p>
            </div>
            {m.inactive ? (
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] text-slate-400">Inactive</span>
                {manage && <button onClick={() => onAddMember(m.address, nameOf(m), m.role === "owner" ? "editor" : m.role)} title="Reactivate" className="text-[10px] text-indigo-300 hover:text-indigo-200">reactivate</button>}
              </div>
            ) : m.role === "owner" || !manage || m.address === address ? (
              <span className="shrink-0 rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300">{roleLabel(m.role)}</span>
            ) : (
              <>
                <div className="w-24 shrink-0">
                  <ThemedSelect value={m.role} options={roleOpts} onChange={(v) => onSetRole(m.address, v as Role)} className="flex w-full items-center gap-1 rounded border border-slate-700 bg-slate-800 px-1.5 py-1 text-[10px] text-slate-200 hover:border-slate-600" />
                </div>
                <button onClick={() => onRemoveMember(m.address)} title="Remove" className="shrink-0 p-1 text-slate-500 hover:text-red-400">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {manage && (
        <div className="rounded-lg border border-slate-800 bg-slate-800/30 p-3 space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Add member</p>
          {identities.length > 0 && (
            <select value="" onChange={(e) => { if (e.target.value) pick(e.target.value); }} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none">
              <option value="">From Access Keys…</option>
              {identities.map((i) => <option key={i.address} value={i.address}>{i.label || shortAddr(i.address)}</option>)}
            </select>
          )}
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name / label" className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
          <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Arweave address or public key" className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
          <div className="flex items-center gap-2">
            <div className="w-28"><ThemedSelect value={role} options={roleOpts} onChange={(v) => setRole(v as Role)} /></div>
            <button onClick={submit} disabled={busy} className="ml-auto rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50">{busy ? "…" : "Add"}</button>
          </div>
          <p className="text-[10px] text-slate-600">New wallets (no transactions yet) must be added by public key — copy it from “View a Document”.</p>
        </div>
      )}
    </div>
  );
}

// Columns are edited PER PROJECT: a dropdown picks the project, the list shows that
// project's columns (rename/done/hide/rules/reorder edit the shared board column;
// remove takes it out of THIS project), and "Add" offers every suggestion in one
// list — adding creates the column in the board pool if new and puts it in the project.
function ColumnsTab({ state, manage, onColumns, projects, currentProjectId, onProjectColumns, onAddColumn }: {
  state: BoardState; manage: boolean; onColumns: (c: Column[]) => void;
  projects: Project[]; currentProjectId: string; onProjectColumns: (projectId: string, columnIds: string[]) => void;
  onAddColumn: (col: Column, projectId: string) => void;
}) {
  const pool = boardColumns(state);
  const [projId, setProjId] = useState(currentProjectId);
  const [custom, setCustom] = useState("");
  const [rulesFor, setRulesFor] = useState<string | null>(null);
  const proj = projects.find((p) => p.id === projId) ?? projects[0];
  const cols = (proj?.columnIds ?? []).map((id) => pool.find((c) => c.id === id)).filter((c): c is Column => !!c);

  const patch = (id: string, p: Partial<Column>) => onColumns(pool.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const move = (i: number, dir: -1 | 1) => { if (!proj) return; const j = i + dir; if (j < 0 || j >= proj.columnIds.length) return; const next = [...proj.columnIds]; [next[i], next[j]] = [next[j], next[i]]; onProjectColumns(proj.id, next); };
  const removeFromProject = (id: string) => { if (proj) onProjectColumns(proj.id, proj.columnIds.filter((x) => x !== id)); };
  const addCustom = () => { const l = custom.trim(); if (!l || !proj) return; onAddColumn({ id: `c_${newId().slice(0, 6)}`, label: l }, proj.id); setCustom(""); };

  // One undivided suggestion list: all known columns + any custom pool columns, minus
  // those already in this project.
  const known = [...DEFAULT_COLUMNS, ...EXTRA_COLUMNS];
  const poolCustom = pool.filter((c) => !known.some((k) => k.id === c.id));
  const suggestions = [...known, ...poolCustom].filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i).filter((c) => !(proj?.columnIds ?? []).includes(c.id));
  const projOpts = projects.map((p) => ({ value: p.id, label: p.name }));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-slate-500">Project</span>
        <div className="min-w-0 flex-1"><ThemedSelect value={projId} options={projOpts} onChange={setProjId} /></div>
      </div>
      <p className="text-[11px] text-slate-500">Columns shown in <span className="text-slate-300">{proj?.name ?? "—"}</span>. A ticket appears in any project that has its column — moving a ticket between columns moves it between projects.</p>

      <div className="space-y-1.5">
        {cols.length === 0 && <p className="text-[11px] text-slate-600">No columns in this project yet — add some below.</p>}
        {cols.map((c, i) => (
          <div key={c.id}>
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-800/40 px-2 py-1.5">
              <span className={`h-2 w-2 shrink-0 rounded-full ${columnColor(i)}`} />
              {manage ? (
                <input value={c.label} onChange={(e) => patch(c.id, { label: e.target.value })} className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-xs text-slate-100 hover:bg-slate-800 focus:bg-slate-800 focus:outline-none" />
              ) : (
                <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{c.label}{c.hidden ? " · hidden" : ""}</span>
              )}
              {manage && (
                <>
                  <button onClick={() => patch(c.id, { done: !c.done })} title="Mark as a done/complete column" className={`shrink-0 rounded px-1 py-0.5 text-[9px] ${c.done ? "bg-emerald-500/20 text-emerald-300" : "text-slate-500 hover:text-slate-300"}`}>done</button>
                  <button onClick={() => setRulesFor(rulesFor === c.id ? null : c.id)} title="Move rules (where a ticket here can go)" className={`shrink-0 p-1 ${rulesFor === c.id || (c.allowedTransitions?.length ?? 0) > 0 ? "text-indigo-300" : "text-slate-500 hover:text-slate-200"}`}>
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-3-3m3 3l-3 3M16 17H4m0 0l3-3m-3 3l3 3" /></svg>
                  </button>
                  <button onClick={() => patch(c.id, { hidden: !c.hidden })} title={c.hidden ? "Show" : "Hide"} className="shrink-0 p-1 text-slate-500 hover:text-slate-200">
                    {c.hidden ? (
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 4.2A9.6 9.6 0 0112 4c6.5 0 10 7 10 7a13 13 0 01-2.3 3M6.6 6.6A13 13 0 002 11s3.5 7 10 7a9.5 9.5 0 003.4-.6" /></svg>
                    ) : (
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
                    )}
                  </button>
                  <div className="flex shrink-0 flex-col">
                    <button onClick={() => move(i, -1)} disabled={i === 0} className="text-slate-500 hover:text-slate-200 disabled:opacity-30"><svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M6 15l6-6 6 6" /></svg></button>
                    <button onClick={() => move(i, 1)} disabled={i === cols.length - 1} className="text-slate-500 hover:text-slate-200 disabled:opacity-30"><svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M6 9l6 6 6-6" /></svg></button>
                  </div>
                  <button onClick={() => removeFromProject(c.id)} title="Remove from this project" className="shrink-0 p-1 text-slate-500 hover:text-red-400"><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
                </>
              )}
            </div>
            {manage && rulesFor === c.id && (
              <div className="ml-3 mt-1 rounded-lg border border-slate-800 bg-slate-900/60 p-2">
                <p className="mb-1.5 text-[10px] text-slate-500">From <span className="text-slate-300">{c.label}</span>, a ticket may move to{(c.allowedTransitions?.length ?? 0) === 0 ? <span className="text-slate-400"> any column (no rule)</span> : ":"}</p>
                <div className="flex flex-wrap gap-1.5">
                  {pool.filter((o) => o.id !== c.id).map((o) => {
                    const on = !!c.allowedTransitions?.includes(o.id);
                    return <button key={o.id} onClick={() => { const cur = c.allowedTransitions ?? []; patch(c.id, { allowedTransitions: on ? cur.filter((x) => x !== o.id) : [...cur, o.id] }); }} className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? "border-indigo-500 bg-indigo-500/15 text-indigo-200" : "border-slate-700 text-slate-400 hover:border-slate-500"}`}>{o.label}</button>;
                  })}
                </div>
                {(c.allowedTransitions?.length ?? 0) > 0 && <button onClick={() => patch(c.id, { allowedTransitions: [] })} className="mt-1.5 text-[10px] text-slate-500 hover:text-slate-300">Clear (allow any)</button>}
              </div>
            )}
          </div>
        ))}
      </div>

      {manage && (
        <div className="rounded-lg border border-slate-800 bg-slate-800/30 p-3 space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Add a column to {proj?.name ?? "this project"}</p>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((c) => <button key={c.id} onClick={() => proj && onAddColumn(c, proj.id)} className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 hover:border-indigo-500 hover:text-indigo-300">+ {c.label}</button>)}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addCustom(); }} placeholder="Custom column name…" className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
            <button onClick={addCustom} disabled={!custom.trim()} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50">Add</button>
          </div>
        </div>
      )}
    </div>
  );
}
