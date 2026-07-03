import { SiteHeader } from "@/components/SiteHeader";
import { AppSidebar } from "@/components/AppSidebar";
import { Footer } from "@/components/Footer";
import GovernanceView from "@/components/GovernanceView";

// Public governance page (like /help, /forum). Shows the connected wallet's token balance + % vote
// weight, the token distribution, and proposals to vote on. Works once the token process id is set.
export default function GovernancePage() {
  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-slate-950">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-40 h-[26rem] w-[26rem] rounded-full bg-indigo-600/15 blur-3xl" />
        <div className="absolute right-0 top-24 h-96 w-96 rounded-full bg-violet-600/10 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.04] [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:42px_42px]" />
      </div>

      <SiteHeader />

      <div className="relative z-10 flex min-h-0 flex-1">
        <AppSidebar />
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl flex-1 px-4 pb-10 pt-6 sm:px-6"><GovernanceView /></div>
          <Footer />
        </main>
      </div>
    </div>
  );
}
