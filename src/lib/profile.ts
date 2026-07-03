// On-chain public profile: a wallet's display name + socials, published as a signed, plaintext
// ANS-104 data item (like the forum) so ANYONE can read it. Only the wallet itself can write its
// own profile — readers fetch the LATEST record whose on-chain owner.address === that wallet, so it
// can't be spoofed. Cached locally for instant render; refreshed from the chain in the background.

import { publishRecords } from "./turbo";
import type { Social } from "./accessKeys";

const APP_PROFILE = "GTV-Profile";
const ENDPOINTS = ["https://arweave.net/graphql", "https://turbo-gateway.com/graphql"];
const DATA_GATEWAYS = ["https://turbo-gateway.com", "https://arweave.net"];

export interface PublicProfile { name: string; socials: Social[]; at: number }

const cacheKey = (addr: string) => `gtv_pubprofile_${addr}`;
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

export function loadCachedProfile(addr: string | null): PublicProfile | null {
  if (!addr || typeof window === "undefined") return null;
  try { const raw = localStorage.getItem(cacheKey(addr)); return raw ? (JSON.parse(raw) as PublicProfile) : null; } catch { return null; }
}

function saveCached(addr: string, p: PublicProfile): void {
  try { localStorage.setItem(cacheKey(addr), JSON.stringify(p)); } catch { /* non-critical */ }
}

// Publish (or update) YOUR profile. Edits = republish; the latest Unix-Time wins at read time.
export async function publishProfile(addr: string, p: { name: string; socials: Social[] }): Promise<void> {
  const body: PublicProfile = { name: (p.name || "").trim(), socials: (p.socials || []).filter((s) => s.value.trim()), at: Date.now() };
  await publishRecords([{ data: enc(body), tags: [
    { name: "App-Name", value: APP_PROFILE },
    { name: "Profile-Of", value: addr },
    { name: "Unix-Time", value: String(body.at) },
  ] }]);
  saveCached(addr, body); // optimistic — show immediately while it indexes
}

// Fetch the latest on-chain profile for a wallet (signed by that wallet). Caches + returns it.
export async function fetchProfile(addr: string): Promise<PublicProfile | null> {
  if (!addr || typeof window === "undefined") return loadCachedProfile(addr);
  const query = `query($app:[String!]!,$o:[String!]!){transactions(tags:[{name:"App-Name",values:$app}],owners:$o,first:1,sort:HEIGHT_DESC){edges{node{id}}}}`;
  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables: { app: [APP_PROFILE], o: [addr] } }), signal: AbortSignal.timeout(10000) });
      const json = await res.json();
      const id = json?.data?.transactions?.edges?.[0]?.node?.id as string | undefined;
      if (!id) continue;
      for (const base of DATA_GATEWAYS) {
        try {
          const r = await fetch(`${base}/${id}`, { signal: AbortSignal.timeout(10000) });
          if (!r.ok) continue;
          const p = JSON.parse(await r.text()) as PublicProfile;
          if (p && typeof p === "object") { const clean: PublicProfile = { name: p.name || "", socials: Array.isArray(p.socials) ? p.socials : [], at: p.at || Date.now() }; saveCached(addr, clean); return clean; }
        } catch { /* try next gateway */ }
      }
    } catch { /* try next endpoint */ }
  }
  return loadCachedProfile(addr);
}
