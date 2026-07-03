import AppShell from "@/components/AppShell";

// Persistent shell for every authenticated section. AppShell renders the nav, header
// and the active section (derived from the URL). Because it lives in this layout it
// stays mounted as you move between /dashboard, /board, /vault … — so loaded data and
// in-flight actions (e.g. a chat → board ticket jump) survive navigation.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppShell />
      {children}
    </>
  );
}
