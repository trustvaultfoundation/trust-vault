"use client";

import { useCallback, useEffect, useState } from "react";
import {
  loadSettings,
  saveSettings,
  clearCachedKeys,
  type VaultSettings,
} from "@/lib/settings";
import { loadPasswords, addPassword, removePassword, clearAllPasswords, type SavedPassword } from "@/lib/passwordLock";
import { useWallet } from "@/context/WalletContext";
import { removeLinkedWallet, walletLabel, type LinkedWallet } from "@/lib/linkedWallets";
import { downloadEmbeddedKeyfile } from "@/lib/embeddedWallet";
import { Switch } from "./AccessKeysView";
import { HelpTip } from "./HelpTip";
import PasswordInput from "./PasswordInput";
import { TurboCreditsModal } from "./TurboCreditsModal";
import { getTurboBalance } from "@/lib/turboCredits";
import { pendingFundTxs, retryPendingFundTxs, startPendingRetryLoop, scanAndAutoCredit, type TurboPayment } from "@/lib/turboCrypto";

type Toast = (message: string, type?: "error" | "info" | "warning") => void;

// When durable state-sync is on, the saved-passwords store rides in the encrypted per-wallet
// snapshot (only your wallet can decrypt it) so it survives a cache wipe; otherwise it's local-
// only. Drives the accurate help text below.
const SYNC_ON = typeof process !== "undefined" && !!process.env.NEXT_PUBLIC_STATE_SYNC;

export default function SettingsView({
  address,
  onToast,
}: {
  address: string;
  onToast: Toast;
}) {
  const { balance, walletType, linkedWallets, switchWallet, refreshLinkedWallets, addWallet, listAccounts } = useWallet();
  // Other accounts detected in the connected wallet (Wander) that aren't saved yet — offered as
  // suggestions to add (the user explicitly chooses; nothing is auto-added).
  const [suggested, setSuggested] = useState<string[]>([]);
  const refreshSuggested = useCallback(() => {
    listAccounts().then((all) => {
      const saved = new Set(linkedWallets.map((w) => w.address));
      setSuggested(all.filter((a) => a && !saved.has(a)));
    }).catch(() => setSuggested([]));
  }, [listAccounts, linkedWallets]);
  useEffect(() => { refreshSuggested(); }, [refreshSuggested]);

  // Turbo credits for the connected wallet (funds larger uploads).
  const [showCredits, setShowCredits] = useState(false);
  const [turboBalance, setTurboBalance] = useState<number | null>(null);
  const [turboPayments, setTurboPayments] = useState<TurboPayment[]>([]);
  const [turboCredited, setTurboCredited] = useState<Set<string>>(new Set());
  const [turboScanning, setTurboScanning] = useState(false);
  useEffect(() => { if (address) getTurboBalance(address).then(setTurboBalance).catch(() => {}); }, [address, showCredits]);
  // Scan crypto top-ups on-chain and auto-credit any Turbo hasn't applied — no button. Powers the
  // history + pending total below, and keeps crediting in the background.
  useEffect(() => {
    if (!address) return;
    let alive = true;
    const refresh = async () => {
      setTurboScanning(true);
      try {
        const { payments, credited, creditedNow } = await scanAndAutoCredit(address);
        if (!alive) return;
        setTurboPayments(payments); setTurboCredited(credited);
        if (creditedNow > 0) getTurboBalance(address).then(setTurboBalance).catch(() => {});
      } catch { /* ignore */ } finally { if (alive) setTurboScanning(false); }
    };
    void refresh();
    if (pendingFundTxs().length > 0) { startPendingRetryLoop(); retryPendingFundTxs().catch(() => {}); }
    const onCredited = () => { void refresh(); getTurboBalance(address).then(setTurboBalance).catch(() => {}); };
    window.addEventListener("gtv:turbo-credited", onCredited);
    return () => { alive = false; window.removeEventListener("gtv:turbo-credited", onCredited); };
  }, [address, showCredits]);
  const turboPendingAr = turboPayments.filter((p) => !turboCredited.has(p.txId)).reduce((s, p) => s + p.ar, 0);

  const [settings, setSettings] = useState<VaultSettings>(() => loadSettings());
  const [gatewayDraft, setGatewayDraft] = useState(settings.gatewayUrl);

  // Reusable download passwords (labeled, e.g. per project).
  const [passwords, setPasswords] = useState<SavedPassword[]>([]);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [pwLabel, setPwLabel] = useState("");
  const [pwValue, setPwValue] = useState("");
  useEffect(() => { setPasswords(loadPasswords()); }, []);

  // Push the saved-passwords change into the encrypted Arweave snapshot right away (not just on
  // the ~15s background tick), so passwords survive a cache clear even if cleared seconds later.
  const mirrorState = () => {
    if (!SYNC_ON) return;
    import("@/lib/stateSync").then((m) => m.mirror(address)).catch(() => {});
  };

  const addNewPassword = () => {
    if (pwValue.length < 8) { onToast("Use a password of at least 8 characters.", "warning"); return; }
    addPassword(pwLabel, pwValue);
    setPasswords(loadPasswords());
    setPwLabel("");
    setPwValue("");
    mirrorState();
    onToast("Password saved.", "info");
  };
  const deletePassword = (id: string) => {
    removePassword(id);
    setPasswords(loadPasswords());
    mirrorState();
  };
  const deleteAllPasswords = () => {
    if (passwords.length === 0) return;
    if (!confirm(`Delete all ${passwords.length} saved password${passwords.length !== 1 ? "s" : ""}? This can't be undone.`)) return;
    clearAllPasswords();
    setPasswords(loadPasswords());
    setRevealed(new Set());
    mirrorState();
    onToast("All saved passwords deleted.", "info");
  };
  const toggleReveal = (id: string) =>
    setRevealed((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // Persist whenever settings change.
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const update = (patch: Partial<VaultSettings>) => setSettings((s) => ({ ...s, ...patch }));

  const saveGateway = () => {
    const url = gatewayDraft.trim();
    try {
      new URL(url);
    } catch {
      onToast("Enter a valid gateway URL (including https://).", "warning");
      return;
    }
    update({ gatewayUrl: url });
    onToast("Gateway updated.", "info");
  };

  const clearKeys = () => {
    const n = clearCachedKeys();
    onToast(n > 0 ? `Cleared ${n} cached key${n !== 1 ? "s" : ""}.` : "No cached keys to clear.", "info");
  };

  const exportRecoveryKeys = async () => {
    try {
      const publicKey = await window.arweaveWallet.getActivePublicKey();
      const masterKeyTxId = localStorage.getItem(`gtv_master_tx_${address}`) ?? null;
      const backup = {
        app: "Generational-Trust-Vault",
        kind: "recovery-key-config",
        version: 1,
        generatedAt: new Date().toISOString(),
        address,
        publicKey,
        masterKeyTxId,
        network: settings.network,
        gatewayUrl: settings.gatewayUrl,
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `trust-vault-recovery-${address.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      onToast("Recovery key configuration downloaded.", "info");
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Could not export recovery keys.");
    }
  };

  return (
    <div className="flex flex-col gap-6 pr-1">
      <div className="shrink-0">
        <h2 className="text-lg font-semibold text-white">Settings</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Network, storage, and security preferences for your vault.
        </p>
      </div>

      {/* Account & wallets */}
      <Section
        title="Account & wallets"
        help="Each browser-extension wallet you connect is its own end-to-end-encrypted account with its own vault, boards, chat and calendar. Switching changes which account you're viewing; it never merges data. Clicking Switch reopens Wander so you can confirm which account to use (the wallet owns the active account); switching directly in the extension also works — TrustVault follows it."
        subtitle="The wallets linked to this browser. Switch between them, add another from your extension below, or remove one."
      >
        <div className="space-y-2">
          {linkedWallets.map((w: LinkedWallet) => {
            const active = w.address === address;
            return (
              <div key={w.address} className={`flex items-center gap-2.5 rounded-lg border p-2.5 ${active ? "border-indigo-500/40 bg-indigo-500/10" : "border-slate-800 bg-slate-800/40"}`}>
                <span className={`h-2 w-2 shrink-0 rounded-full ${active ? "bg-emerald-400" : "bg-slate-600"}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs text-slate-200">{walletLabel(w)}{active && <span className="ml-2 rounded bg-indigo-500/20 px-1.5 py-0.5 align-middle text-[9px] font-medium uppercase tracking-wide text-indigo-200">Active</span>}</p>
                  <p className="mt-0.5 truncate text-[10px] text-slate-500">{w.type === "embedded" ? "Passkey wallet" : "Browser wallet"}{active && balance ? ` · ${balance} AR` : ""}</p>
                </div>
                <button onClick={() => navigator.clipboard?.writeText(w.address).then(() => onToast("Address copied.", "info"))} title="Copy address" aria-label="Copy address" className="shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-slate-700 hover:text-slate-200">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" /></svg>
                </button>
                {!active && (
                  <button onClick={() => switchWallet(w.address).catch((e) => onToast(e instanceof Error ? e.message : "Couldn't switch wallet."))} className="shrink-0 rounded-md border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700">Switch</button>
                )}
                {linkedWallets.length > 1 && !active && (
                  <button onClick={() => { removeLinkedWallet(w.address); refreshLinkedWallets(); }} title="Remove from this list" aria-label="Remove" className="shrink-0 rounded-md p-1.5 text-slate-600 hover:text-red-400">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                )}
              </div>
            );
          })}
          {linkedWallets.length === 0 && <p className="text-xs text-slate-500">No wallets linked yet.</p>}
        </div>

        {/* Passkey wallets: keyfile backup + how to fund via Wander. A random RSA key has no seed phrase,
            so the keyfile IS the backup — and importing it into Wander is how you add AR. */}
        {walletType === "embedded" && (
          <div className="space-y-2 border-t border-slate-800 pt-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Back up &amp; add funds</p>
            <div className="flex items-start gap-2 rounded-lg border border-amber-800/40 bg-amber-500/10 p-2.5">
              <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
              <p className="text-[11px] leading-relaxed text-amber-200/90">
                Your passkey account is a real Arweave wallet. Export its <strong>keyfile</strong> and import it into <a href="https://www.wander.app" target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-100">Wander</a> to buy / add AR. <strong>Keep the file safe</strong> — it&apos;s this wallet&apos;s private key and the only way to recover it if you lose your passkey. (A random key has no seed phrase.)
              </p>
            </div>
            <button
              onClick={() => { if (downloadEmbeddedKeyfile()) onToast("Keyfile downloaded — import it into Wander to add AR. Keep it safe.", "info"); else onToast("Couldn't export the keyfile — reconnect your passkey and try again."); }}
              className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>
              Export wallet keyfile
            </button>
          </div>
        )}

        <div className="space-y-2 border-t border-slate-800 pt-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Add another wallet</p>
          {suggested.length > 0 ? (
            <>
              <p className="text-[11px] leading-relaxed text-slate-500">Other accounts detected in your Wander extension — tap + to add the ones you want.</p>
              {suggested.map((addr) => (
                <div key={addr} className="flex items-center gap-2.5 rounded-lg border border-dashed border-slate-700 bg-slate-800/30 p-2.5">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-slate-600" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs text-slate-300">{addr.slice(0, 6)}…{addr.slice(-4)}</p>
                    <p className="mt-0.5 truncate text-[10px] text-slate-500">Another account in your Wander extension</p>
                  </div>
                  <button onClick={() => navigator.clipboard?.writeText(addr).then(() => onToast("Address copied.", "info"))} title="Copy address" aria-label="Copy address" className="shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-slate-700 hover:text-slate-200">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" /></svg>
                  </button>
                  <button onClick={() => { addWallet(addr); refreshSuggested(); onToast("Wallet added.", "info"); }} title="Add this wallet" aria-label="Add this wallet" className="shrink-0 rounded-md p-1.5 text-indigo-300 hover:bg-indigo-500/20">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
                  </button>
                </div>
              ))}
            </>
          ) : (
            <div className="flex items-start gap-2 rounded-lg border border-amber-800/40 bg-amber-500/10 p-2.5">
              <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
              <p className="text-[11px] leading-relaxed text-amber-200/90">No other accounts found in your Wander extension. To add another wallet, create or import a new account in Wander — it&apos;ll then appear here to add.</p>
            </div>
          )}
        </div>
        <p className="text-[10px] leading-relaxed text-slate-600">Removing a wallet only takes it off this list — its data stays encrypted on Arweave and returns if you connect it again. Switch reopens Wander to confirm the account.</p>
      </Section>

      {/* RPC Node & Gateway */}
      <Section
        title="RPC Node & Gateway"
        help="A gateway is the doorway your browser uses to read data from the permanent Arweave network. If one provider is slow or down, paste another gateway URL here and everything keeps working — your documents live on the network, not on any single gateway."
        subtitle="The Arweave / ar.io gateway used to read and resolve data. Change it if a provider fails."
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={gatewayDraft}
            onChange={(e) => setGatewayDraft(e.target.value)}
            placeholder="https://arweave.net"
            className="h-9 flex-1 min-w-[240px] text-sm bg-slate-800 border border-slate-700 rounded-lg px-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
          />
          <button
            onClick={saveGateway}
            className="h-9 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-4 rounded-lg transition-colors"
          >
            Save
          </button>
        </div>
        {settings.gatewayUrl !== "https://arweave.net" && (
          <button
            onClick={() => { setGatewayDraft("https://arweave.net"); update({ gatewayUrl: "https://arweave.net" }); }}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            Reset to default
          </button>
        )}
      </Section>

      {/* Storage */}
      <Section
        title="Storage"
        help="Your files are encrypted in your browser, then bundled to Arweave through Turbo (ArDrive's uploader) and kept permanently. Small files are free; larger files draw on Turbo credits, which you top up at turbo.ardrive.io with a card or crypto — no AR self-funding needed."
        subtitle="Encrypted files are stored permanently on Arweave via Turbo."
      >
        <p className="text-sm leading-relaxed text-slate-300">
          Uploads are encrypted in your browser and stored permanently on Arweave through Turbo. Small files
          are free; larger ones use Turbo credits, tied to your connected wallet.
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2.5">
          <span className="text-xs text-slate-400">
            Turbo credit balance:{" "}
            <span className="text-slate-200">{turboBalance == null ? "—" : `${turboBalance.toFixed(turboBalance >= 1 ? 2 : 4)} credits`}</span>
            {turboPendingAr > 0 && <span className="text-amber-300"> · {turboPendingAr.toFixed(turboPendingAr >= 1 ? 2 : 4)} AR pending</span>}
          </span>
          <button
            onClick={() => setShowCredits(true)}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
          >
            Add Turbo credits
          </button>
        </div>
      </Section>

      {/* Turbo transaction history (crypto top-ups) */}
      <Section
        title="Turbo transactions"
        help="Every crypto (AR) top-up you've sent to Turbo, read from the Arweave chain. Confirmed payments are credited to your wallet automatically — no action needed. 'Pending' means Arweave is still confirming the transfer; it flips to 'Approved' on its own."
        subtitle="Your crypto top-ups and whether they've been credited."
      >
        {turboPayments.length === 0 ? (
          <p className="text-sm text-slate-500">{turboScanning ? "Loading your transactions…" : "No crypto top-ups yet. Add Turbo credits with AR to see them here."}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-800">
            <table className="w-full text-xs">
              <thead className="bg-slate-900/60 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium text-right">Transaction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {turboPayments.map((p) => {
                  const approved = turboCredited.has(p.txId);
                  return (
                    <tr key={p.txId} className="text-slate-300">
                      <td className="px-3 py-2 text-slate-400">{p.at ? new Date(p.at).toLocaleDateString() : "—"}</td>
                      <td className="px-3 py-2">{p.ar.toFixed(p.ar >= 1 ? 2 : 4)} AR</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${approved ? "bg-emerald-500/15 text-emerald-300" : p.confirmed ? "bg-indigo-500/15 text-indigo-300" : "bg-amber-500/15 text-amber-300"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${approved ? "bg-emerald-400" : p.confirmed ? "bg-indigo-400" : "bg-amber-400 animate-pulse"}`} />
                          {approved ? "Approved" : p.confirmed ? "Crediting…" : "Pending"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <a href={`https://viewblock.io/arweave/tx/${p.txId}`} target="_blank" rel="noopener noreferrer" className="font-mono text-indigo-300 underline-offset-2 hover:underline">{p.txId.slice(0, 6)}…{p.txId.slice(-5)}</a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {showCredits && <TurboCreditsModal address={address} onClose={() => setShowCredits(false)} onToast={onToast} />}

      <Section
        title="Download Passwords"
        help={`Passwords you reuse to download password-protected copies of documents (Vault → Download with password). Save one per project or recipient so you can pick it at download time. ${SYNC_ON ? "They're encrypted with your vault key — only your wallet can read them — and synced with the rest of your data, so they survive clearing this browser." : "Stored in this browser only — like cached keys, anyone with this browser profile can read them; they are never uploaded."}`}
        subtitle="Save reusable passwords for password-protected downloads — pick one per project, or add new ones at download time."
      >
        {passwords.length > 0 ? (
          <>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-500">{passwords.length} saved</span>
            <button
              onClick={deleteAllPasswords}
              className="text-xs text-red-300 border border-red-800/50 bg-red-500/10 hover:bg-red-500/20 px-3 py-1 rounded-lg transition-colors"
            >
              Delete all
            </button>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 divide-y divide-slate-800">
            {passwords.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2">
                <span className="text-sm text-slate-200 truncate flex-1 min-w-0">{p.label}</span>
                <span className="font-mono text-xs text-slate-400 truncate max-w-[40%]">
                  {revealed.has(p.id) ? p.password : "••••••••"}
                </span>
                <button
                  onClick={() => toggleReveal(p.id)}
                  title={revealed.has(p.id) ? "Hide" : "Show"}
                  className="text-slate-500 hover:text-slate-200 transition-colors shrink-0"
                >
                  {revealed.has(p.id) ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18" /><path d="M10.6 10.6a2 2 0 002.8 2.8" /><path d="M9.4 5.2A9.4 9.4 0 0112 5c5 0 9 4.6 9 7a11.8 11.8 0 01-2.2 3M6.1 6.2A12.4 12.4 0 003 12c0 2.4 4 7 9 7a9.5 9.5 0 003.3-.6" /></svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
                  )}
                </button>
                <button
                  onClick={() => deletePassword(p.id)}
                  title="Remove"
                  className="text-slate-500 hover:text-red-400 transition-colors shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
            ))}
          </div>
          </>
        ) : (
          <p className="text-[11px] text-slate-500">No saved passwords yet. Add one below, or create one at download time.</p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <input
            value={pwLabel}
            onChange={(e) => setPwLabel(e.target.value)}
            placeholder="Label (e.g. Estate 2026)"
            className="h-9 text-sm bg-slate-800 border border-slate-700 rounded-lg px-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 max-w-[200px]"
          />
          <PasswordInput value={pwValue} onChange={setPwValue} placeholder="Password (min 8 characters)" className="flex-1 min-w-[180px]" />
          <button
            onClick={addNewPassword}
            className="h-9 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold px-4 rounded-lg transition-colors"
          >
            Save Password
          </button>
        </div>
      </Section>

      {/* Security & Caching */}
      <Section
        title="Security & Caching"
        help="When caching is on, the keys that decrypt your documents are kept in this browser so you can re-open files without repeated wallet pop-ups. Turn it off for zero-trace mode on a shared or public computer — nothing is retained and keys are wiped when the tab closes. Export Recovery Keys saves a backup of your public key configuration (never your private key)."
        subtitle="Control how decryption keys are retained and back up your key configuration."
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-slate-200">Decryption Caching</p>
            <p className="text-[11px] text-slate-500">
              {settings.decryptionCaching
                ? "Keys are cached for the session for prompt-free re-opening."
                : "Zero-trace — keys are never stored and wiped on tab close."}
            </p>
          </div>
          <Switch checked={settings.decryptionCaching} onChange={(v) => update({ decryptionCaching: v })} />
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={clearKeys}
            className="text-xs text-amber-300 border border-amber-800/50 bg-amber-500/10 hover:bg-amber-500/20 px-3 py-1.5 rounded-lg transition-colors"
          >
            Clear cached keys now
          </button>
          <button
            onClick={exportRecoveryKeys}
            className="text-xs text-indigo-300 border border-indigo-800/50 bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-1.5 rounded-lg transition-colors"
          >
            Export Recovery Keys
          </button>
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  subtitle,
  help,
  children,
}: {
  title: string;
  subtitle: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-4 shrink-0">
      <div>
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {help && <HelpTip text={help} />}
        </div>
        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}
