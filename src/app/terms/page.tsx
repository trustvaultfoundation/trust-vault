import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { AppSidebar } from "@/components/AppSidebar";
import { Footer } from "@/components/Footer";

// Original Terms of Service + Privacy Policy tailored to TrustVault's non-custodial, client-side-
// encrypted, backendless, permanent-storage model. Placeholders ([...]) for the owner's legal entity,
// jurisdiction and contact — and this is a template, NOT legal advice; have counsel review before relying on it.
const UPDATED = "23 June 2026";

export default function TermsPage() {
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
          <article className="mx-auto w-full max-w-3xl flex-1 px-4 pb-10 pt-6 sm:px-6">
            <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-indigo-300">Legal</span>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">Terms &amp; Conditions and Privacy Policy</h1>
            <p className="mt-2 text-sm text-slate-500">Last updated: {UPDATED}</p>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">
              These terms govern your use of TrustVault (the &quot;Service&quot;) — an end-to-end-encrypted workspace that runs
              entirely in your browser and stores data on the Arweave network. By connecting a wallet or otherwise using
              the Service, you agree to these terms. If you do not agree, do not use the Service.
            </p>

            <Section n="1" title="What TrustVault is (and isn't)">
              <P>TrustVault is <strong className="text-slate-200">non-custodial and serverless</strong>. There is no TrustVault account,
              email, or password, and we operate no application backend that stores your data. Your content is encrypted
              <strong className="text-slate-200"> in your browser</strong> and stored on Arweave; only your wallet holds the keys.</P>
              <P>We do not hold, control, or have access to your private keys, your plaintext content, or any funds. The
              Service is software that helps you interact with public networks (Arweave, AO) and third-party tools — we are
              not a bank, broker, exchange, custodian, or money-services business.</P>
            </Section>

            <Section n="2" title="Your wallet and your keys">
              <Bullets items={[
                "You are solely responsible for your wallet, your keys, and any passkey or device used to access them.",
                "If you lose your keys/passkey and any backup, your account and data cannot be recovered by anyone, including us.",
                "You are responsible for all activity performed with your wallet through the Service.",
                "You must be legally able to enter these terms and use the Service where you live.",
              ]} />
            </Section>

            <Section n="3" title="Permanence — data cannot be unsent">
              <P><strong className="text-slate-200">Arweave is a permanent, public ledger.</strong> Anything you publish to it through the
              Service — including encrypted vault records and <em>public</em> content such as forum posts or public DePM
              project boards — is written immutably and <strong className="text-slate-200">cannot be edited or deleted</strong> at the
              protocol level. &quot;Edit,&quot; &quot;hide,&quot; &quot;delete,&quot; or &quot;make private&quot; in the app change what THIS app shows; they do not
              erase data already written on-chain. Do not publish anything you may later need removed.</P>
            </Section>

            <Section n="4" title="Public content & DePM">
              <P>Some features are public by design. The forum is public. With <strong className="text-slate-200">DePM (Decentralized Project
              Management)</strong>, a board owner may choose to make a board public so others can view its progress; doing so
              publishes a plaintext snapshot of that board to the public network. <strong className="text-slate-200">You decide what to make
              public</strong>, and you are responsible for the accuracy and lawfulness of what you publish (including any company
              name, links, or claims). Public information is not verified or endorsed by us.</P>
            </Section>

            <Section n="5" title="Acceptable use">
              <P>You agree not to use the Service to:</P>
              <Bullets items={[
                "break any law, or infringe anyone's rights (including IP, privacy, or publicity);",
                "publish unlawful, fraudulent, deceptive, hateful, or malicious content, or impersonate others;",
                "upload malware, attempt to disrupt networks/gateways, or abuse free upload tiers;",
                "misrepresent a project, its team, or its progress to deceive investors or users.",
              ]} />
              <P>We may, at our discretion, hide or moderate content within the app (e.g. forum/DePM) and restrict access,
              but we cannot remove data from the underlying public network.</P>
            </Section>

            <Section n="6" title="No financial or investment advice">
              <P>Nothing in the Service is financial, investment, legal, or tax advice. Any project information or progress
              shown through the Service is provided for information only and may be inaccurate or incomplete. Crypto assets
              are volatile and can lose all value. <strong className="text-slate-200">Do your own research</strong> and consult qualified
              professionals before making any decision. <strong className="text-slate-200">TrustVault has no token</strong> — there is nothing to
              buy and no investment offered. Some features may be unavailable or restricted in your jurisdiction.</P>
            </Section>

            <Section n="7" title="Governance & donations">
              <P>TrustVault is <strong className="text-slate-200">free</strong>. Governance is <strong className="text-slate-200">one wallet, one vote</strong>: the
              team posts proposals and any connected wallet can vote, with votes recorded as public records on Arweave.
              Governance is community signalling — outcomes guide the project but are <strong className="text-slate-200">not a binding contract</strong>,
              and the one-wallet-one-vote model is not resistant to someone voting from multiple wallets.</P>
              <Bullets items={[
                "Donations are entirely voluntary gifts to support development. They grant no token, equity, ownership, governance right, service, or expectation of profit or return.",
                "Donations are non-refundable, and crypto transfers are irreversible — always verify the network and address before sending.",
                "You are responsible for any taxes related to a donation, and for ensuring a donation is lawful where you live.",
              ]} />
            </Section>

            <Section n="8" title="Third-party networks & services">
              <P>The Service relies on independent third parties we do not control, including Arweave and AO, wallet
              providers (e.g. Wander), upload/bundling services (e.g. ArDrive Turbo), and public gateways. Your use of those
              is subject to their own terms, and we are not responsible for their availability, fees, security, or actions.</P>
            </Section>

            <Section n="9" title="Privacy">
              <P>Because TrustVault has no backend, <strong className="text-slate-200">we do not collect, store, or sell your personal data on a
              server.</strong> Specifically:</P>
              <Bullets items={[
                "Your documents and private workspace are encrypted in your browser; we never receive your plaintext or keys.",
                "Operational data (your wallet's saved list, UI preferences, cached keys for convenience) is kept in your browser's local storage on your device, and can be cleared by you at any time.",
                "Content you choose to publish (forum posts, public DePM boards, on-chain records) is, by nature, public and permanent on Arweave, and is associated with your wallet address on-chain.",
                "We do not set advertising cookies; a local cookie/consent preference may be stored on your device.",
                "Network requests go to public gateways/services (above), which may log requests under their own policies.",
              ]} />
              <P>Wallet addresses on a public ledger are pseudonymous, not anonymous; activity can be analysed by anyone.
              Where the app shows only a display name, the underlying address may still be discoverable on-chain.</P>
            </Section>

            <Section n="10" title="Disclaimers & limitation of liability">
              <P>The Service is provided <strong className="text-slate-200">&quot;as is&quot; and &quot;as available,&quot;</strong> without warranties of any kind, to
              the fullest extent permitted by law. We do not warrant that it will be uninterrupted, error-free, or secure, or
              that data will always be retrievable. To the maximum extent permitted by law, we are not liable for any loss
              of data, keys, funds, profits, or for any indirect or consequential damages arising from your use of the
              Service or the underlying networks.</P>
            </Section>

            <Section n="11" title="Changes, governing law & contact">
              <P>We may update these terms; continued use after an update means you accept the changes. These terms are
              governed by the laws of <strong className="text-slate-200">Portugal</strong>, without regard to conflict-of-laws rules. Questions:
              <a href="mailto:hello@trustvault.foundation" className="font-semibold text-indigo-300 hover:underline">hello@trustvault.foundation</a> (operated by <strong className="text-slate-200">TrustVault Foundation</strong>).</P>
            </Section>

            <p className="mt-8 rounded-xl border border-amber-800/40 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-200/90">
              This page is a plain-language template, not legal advice. Replace the bracketed placeholders and have a lawyer
              review it for your jurisdiction before relying on it.
            </p>
            <p className="mt-6 text-center text-xs text-slate-600">See also the <Link href="/help" className="text-indigo-300 hover:underline">Help guide</Link>.</p>
          </article>
          <Footer />
        </main>
      </div>
    </div>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="flex items-center gap-2 text-lg font-bold text-white"><span className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-500/15 text-xs font-semibold text-indigo-300">{n}</span>{title}</h2>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-slate-400">{children}</p>;
}
function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-400"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-indigo-400" /><span>{it}</span></li>
      ))}
    </ul>
  );
}
