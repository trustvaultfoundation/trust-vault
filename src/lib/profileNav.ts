// Tiny event bus so a @mention anywhere — a Tiptap node view, a chat chip, a rendered
// HTML pill — can ask the app to open a user's profile or start a chat with them,
// without threading callbacks through every component. AppShell listens.

export type ProfileTarget = { address: string; label?: string };

export function openUserProfile(t: ProfileTarget): void {
  if (typeof window !== "undefined" && t.address) window.dispatchEvent(new CustomEvent("gtv:open-profile", { detail: t }));
}

export function callUser(t: ProfileTarget): void {
  if (typeof window !== "undefined" && t.address) window.dispatchEvent(new CustomEvent("gtv:call-user", { detail: t }));
}

// A mention pill anywhere can pop a small user card anchored to its on-screen rect.
export type UserCardRequest = ProfileTarget & { rect: { top: number; left: number; bottom: number } };

export function showUserCard(req: UserCardRequest): void {
  if (typeof window !== "undefined" && req.address) window.dispatchEvent(new CustomEvent("gtv:user-card", { detail: req }));
}
