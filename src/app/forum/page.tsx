import { SiteHeader } from "@/components/SiteHeader";
import { AppSidebar } from "@/components/AppSidebar";
import { Footer } from "@/components/Footer";
import ForumView from "@/components/ForumView";

// Public forum route (like /help): readable by anyone; posting requires a connected wallet. Lives
// outside the authed app shell so visitors reaching it from the landing/help footers can read it.
export default function ForumPage() {
  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-slate-950">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-40 h-[26rem] w-[26rem] rounded-full bg-indigo-600/15 blur-3xl" />
        <div className="absolute right-0 top-24 h-96 w-96 rounded-full bg-violet-600/10 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.04] [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:42px_42px]" />
      </div>

      <SiteHeader />

      {/* When signed in, the app's left menu appears (self-hides when signed out). */}
      <div className="relative z-10 flex min-h-0 flex-1">
        <AppSidebar />
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl flex-1 px-4 pb-10 pt-6 sm:px-6">
            <div className="mb-4">
              <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-indigo-300">Community</span>
              <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">Forum</h1>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-400">Feedback, ideas and discussion. Only your display name is shown — never your wallet address.</p>
            </div>
            <ForumView />
          </div>
          <Footer />
        </main>
      </div>
    </div>
  );
}
