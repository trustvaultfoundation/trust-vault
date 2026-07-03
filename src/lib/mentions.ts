// Shared source for @mentions. A "person" you can mention is anyone in your
// authorized-identities address book, plus any contextual members passed in
// (board members, chat members, Service-Desk people…). De-duped by address;
// a contextual label wins over the address-book one, which wins over a bare address.

import { loadIdentities } from "./accessKeys";

export type MentionPerson = { id: string; label: string };

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export function mentionPeople(address: string | null, extra: MentionPerson[] = []): MentionPerson[] {
  const byId = new Map<string, string>();
  for (const id of loadIdentities(address)) if (id.address) byId.set(id.address, id.label?.trim() || short(id.address));
  // Contextual members override (their label is the most relevant in-context).
  for (const p of extra) if (p.id) byId.set(p.id, (p.label?.trim() || byId.get(p.id) || short(p.id)));
  return [...byId.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// Filter for the suggestion popup: match label or address, case-insensitive.
export function filterPeople(people: MentionPerson[], query: string, limit = 8): MentionPerson[] {
  const q = query.trim().toLowerCase();
  const hits = q ? people.filter((p) => p.label.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)) : people;
  return hits.slice(0, limit);
}
