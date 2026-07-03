"use client";

// Edit the name + socials you keep for a wallet (yourself or anyone you mention). Saves into your
// Access Keys address book (gtv_identities_<you>) via upsertIdentity, so the name/socials show on
// their profile and hovercard. Used by the hovercard popup, the Profile page and Access Keys.
//
// For SOMEONE ELSE we also resolve their public key (like the Access Keys "Add" flow) so the saved
// identity is usable for sharing/encryption — fetched on-chain by address, or pasted for a brand-new
// wallet that has no on-chain key yet. Socials are only editable for yourself (they publish on-chain).

import { useEffect, useState } from "react";
import { upsertIdentity, loadIdentities, SOCIAL_KINDS, type Social, type SocialKind } from "@/lib/accessKeys";
import { fetchPublicKey, looksLikePublicKey, addressFromPublicKey } from "@/lib/recipients";
import { publishProfile } from "@/lib/profile";
import { SocialIcon } from "./SocialLinks";

const short = (a: string) => (a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);
type Toast = (m: string, t?: "error" | "info" | "warning" | "success") => void;

export function IdentityEditor({ owner, address, isSelf, initialLabel, initialSocials, onSaved, onCancel, onToast, compact }: {
  owner: string;
  address: string;
  isSelf: boolean;
  initialLabel: string;
  initialSocials: Social[];
  onSaved: () => void;
  onCancel: () => void;
  onToast?: Toast;
  compact?: boolean;
}) {
  const [label, setLabel] = useState(initialLabel === "You" ? "" : initialLabel);
  const [socials, setSocials] = useState<Social[]>(initialSocials.length ? initialSocials : []);
  const [saving, setSaving] = useState(false);
  // Public-key resolution for OTHERS: "checking" while we look it up, "found" once known, "missing"
  // when the wallet has no on-chain key (then we accept a pasted key).
  const [pubKey, setPubKey] = useState<string | null>(null);
  const [pubStatus, setPubStatus] = useState<"checking" | "found" | "missing">("checking");
  const [pubInput, setPubInput] = useState("");

  // Resolve the edited wallet's public key so the saved identity is usable for sharing — for
  // YOURSELF from the connected wallet (always available), for others fetched on-chain by address.
  useEffect(() => {
    let on = true;
    const known = loadIdentities(owner).find((i) => i.address === address)?.publicKey;
    if (known) { setPubKey(known); setPubStatus("found"); return; }
    setPubStatus("checking");
    (async () => {
      let k: string | null = null;
      if (isSelf && typeof window !== "undefined" && window.arweaveWallet) {
        try { k = await window.arweaveWallet.getActivePublicKey(); } catch { k = null; }
      }
      if (!k) k = await fetchPublicKey(address).catch(() => null);
      if (!on) return;
      if (k) { setPubKey(k); setPubStatus("found"); } else setPubStatus("missing");
    })();
    return () => { on = false; };
  }, [isSelf, owner, address]);

  const setSocial = (i: number, patch: Partial<Social>) => setSocials((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = async () => {
    const clean = socials.filter((s) => s.value.trim());
    if (isSelf) {
      // Store your own public key too, so your Access Keys entry is share-ready (not "no key").
      // Resolve it now in case the background lookup hasn't finished (getActivePublicKey is instant).
      let selfKey = pubKey ?? undefined;
      if (!selfKey && typeof window !== "undefined" && window.arweaveWallet) {
        try { selfKey = (await window.arweaveWallet.getActivePublicKey()) || undefined; } catch { /* keep undefined */ }
      }
      upsertIdentity(owner, { address, label, socials: clean, publicKey: selfKey });
      // Your own profile is PUBLISHED on-chain so others can see it.
      setSaving(true);
      try { await publishProfile(address, { name: label, socials: clean }); onToast?.("Profile published.", "success"); }
      catch { onToast?.("Saved locally, but couldn't publish on-chain (wallet declined or offline).", "error"); }
      finally { setSaving(false); }
      onSaved();
      return;
    }
    // Editing someone else: resolve their public key (known/fetched, or a pasted one for a new wallet).
    let key = pubKey ?? undefined;
    const pasted = pubInput.trim();
    if (!key && pasted) {
      if (!looksLikePublicKey(pasted)) { onToast?.("That doesn't look like a public key.", "warning"); return; }
      try { if ((await addressFromPublicKey(pasted)) !== address) { onToast?.("That public key belongs to a different wallet.", "warning"); return; } }
      catch { onToast?.("Couldn't verify that public key.", "warning"); return; }
      key = pasted;
    }
    upsertIdentity(owner, { address, label, publicKey: key });
    onToast?.(key ? "Saved." : "Saved (no public key yet — add one to share with them).", key ? "info" : "warning");
    onSaved();
  };

  const field = "w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none";

  return (
    <div className={compact ? "p-3" : "rounded-xl border border-slate-800 bg-slate-900/40 p-4"}>
      <p className="mb-2 text-[11px] text-slate-500">{isSelf ? "Your identity" : `Identity for ${short(address)}`}</p>
      <label className="block">
        <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">Name</span>
        <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder={isSelf ? "Your display name" : "Name for this person"} className={`${field} max-w-[15rem]`} />
      </label>

      {isSelf ? (
        <div className="mt-2.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Socials</span>
          <div className="mt-1 space-y-1.5">
            {socials.map((s, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-400"><SocialIcon kind={s.kind} className="h-3.5 w-3.5" /></span>
                <select value={s.kind} onChange={(e) => setSocial(i, { kind: e.target.value as SocialKind })} className="h-8 shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-1.5 text-[11px] text-slate-200 focus:border-indigo-500 focus:outline-none">
                  {/* only this row's kind + kinds not already used by another row, so each social is unique */}
                  {SOCIAL_KINDS.filter((k) => k.kind === s.kind || !socials.some((x) => x.kind === k.kind)).map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                </select>
                <input value={s.value} onChange={(e) => setSocial(i, { value: e.target.value })} placeholder={SOCIAL_KINDS.find((k) => k.kind === s.kind)?.placeholder} className={`${field} flex-1`} />
                <button type="button" onClick={() => setSocials((x) => x.filter((_, j) => j !== i))} title="Remove" className="shrink-0 text-slate-500 hover:text-rose-400"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
              </div>
            ))}
            {(() => {
              const next = SOCIAL_KINDS.find((k) => !socials.some((s) => s.kind === k.kind)); // first unused kind
              if (!next) return null; // every social already added → no "Add" option
              return (
                <button type="button" onClick={() => setSocials((s) => [...s, { kind: next.kind, value: "" }])} className="flex items-center gap-1 text-[11px] text-indigo-300 hover:text-indigo-200">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>Add social
                </button>
              );
            })()}
          </div>
        </div>
      ) : (
        <div className="mt-2.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Public key</span>
          {pubStatus === "checking" && <p className="mt-1 text-[11px] text-slate-500">Looking up their public key…</p>}
          {pubStatus === "found" && <p className="mt-1 text-[11px] text-emerald-400">Public key found — you can share encrypted with them.</p>}
          {pubStatus === "missing" && (
            <div className="mt-1 space-y-1">
              <p className="text-[11px] text-amber-400">No on-chain key yet. Paste their public key (from “View a Document”) to enable sharing — or save just the name for now.</p>
              <input value={pubInput} onChange={(e) => setPubInput(e.target.value)} placeholder="Paste their public key (optional)" className={`${field} font-mono`} />
            </div>
          )}
        </div>
      )}

      {isSelf && <p className="mt-2 text-[10px] text-slate-600">Your name &amp; socials are published on-chain so anyone can see them on your profile.</p>}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className="rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50">Cancel</button>
        <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-60">{saving ? "Publishing…" : "Save"}</button>
      </div>
    </div>
  );
}
