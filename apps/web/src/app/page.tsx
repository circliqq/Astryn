import Link from "next/link";
import { ArrowRight, BarChart3, Gauge, LockKeyhole, RadioTower, ShieldCheck, WalletCards, Zap } from "lucide-react";
import { Brand } from "@/components/brand";
import { Badge, Button, Panel } from "@/components/ui";

const features = [
  { icon: Gauge, title: "Mint Readiness Score", copy: "Know your chances before you mint." },
  { icon: WalletCards, title: "Wallet Health Scanner", copy: "Scan wallets for risks and issues." },
  { icon: ShieldCheck, title: "Simulation Mode", copy: "Test before you send. Avoid reverts." },
  { icon: RadioTower, title: "RPC Pool & Gas Guardian", copy: "Fast, safe, and cost protected." },
  { icon: BarChart3, title: "Post-Mint Reports", copy: "Detailed analytics and CSV exports." }
];

const trust = [
  ["Your Keys, Your Control", "We never store private keys in plaintext."],
  ["Secure & Private", "Bank-level encryption and security best practices."],
  ["Fast & Reliable", "RPC pool, parallel broadcast, and gas protection."],
  ["Data You Can Trust", "Transparent logs, reports, and analytics."],
  ["We're Here", "24/7 support for serious minters."]
];

export default function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-6">
        <Brand />
        <nav className="hidden items-center gap-8 text-sm md:flex" style={{ color: "var(--text-3)" }}>
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <a href="#docs">Docs</a>
          <a href="#blog">Blog</a>
          <a href="#about">About</a>
        </nav>
        <div className="flex gap-2">
          <Button variant="secondary" className="hidden md:inline-flex">
            <Link href="/login">Login</Link>
          </Button>
          <Button>
            <Link href="/register" className="flex items-center gap-2">
              Get Started <ArrowRight size={15} />
            </Link>
          </Button>
        </div>
      </header>

      <section className="mx-auto grid min-h-[560px] max-w-7xl items-center gap-10 px-5 pb-12 pt-8 lg:grid-cols-[1fr_0.9fr]">
        <div>
          <h1 className="max-w-2xl text-5xl font-bold leading-tight tracking-normal md:text-6xl">
            Mint smarter.
            <span className="block text-brand">Not blindly.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-graphite-400">
            Astryn is the smart NFT mint command center for OpenSea Drops on Base and Ethereum.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button>
              <Link href="/dashboard">Start Minting</Link>
            </Button>
            <Button variant="secondary">
              <Link href="/scanner">View Demo</Link>
            </Button>
          </div>
          <div className="mt-8 flex items-center gap-3 text-xs text-graphite-400">
            <span>Trusted by minters worldwide</span>
            <span className="h-px w-12 bg-graphite-800" />
            <Badge tone="green">Base</Badge>
            <Badge tone="blue">Ethereum</Badge>
          </div>
        </div>

        <div className="relative min-h-[420px]">
          <div className="absolute inset-x-8 bottom-8 h-32 rounded-[50%] bg-cyan-300/10 blur-3xl" />
          <div className="absolute left-1/2 top-8 h-64 w-64 -translate-x-1/2 rotate-45 rounded-[2rem] border border-brand/10 bg-graphite-800 shadow-2xl" />
          <div className="absolute left-1/2 top-20 grid size-36 -translate-x-1/2 place-items-center rounded-3xl border border-emerald-300/30 bg-emerald-300/10 shadow-glow">
            <div className="grid size-20 place-items-center rounded-2xl bg-brand text-graphite-950">
              <LockKeyhole size={34} />
            </div>
          </div>
          <div className="absolute bottom-16 left-1/2 w-[360px] -translate-x-1/2 rounded-2xl border border-graphite-700 bg-graphite-900 p-4 shadow-2xl">
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((item) => (
                <div key={item} className="h-16 rounded-md border border-graphite-700 bg-graphite-800" />
              ))}
            </div>
            <div className="mt-4 h-3 rounded bg-cyan-300/30" />
            <div className="mt-3 h-3 w-3/4 rounded bg-emerald-300/30" />
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto grid max-w-7xl grid-cols-1 gap-4 px-5 pb-10 md:grid-cols-5">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <Panel key={feature.title} className="p-5">
              <div className="mb-4 grid size-10 place-items-center rounded-[8px]" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--brand)" }}>
                <Icon size={18} />
              </div>
              <h2 className="text-sm font-semibold">{feature.title}</h2>
              <p className="mt-2 text-xs leading-5" style={{ color: "var(--text-3)" }}>{feature.copy}</p>
            </Panel>
          );
        })}
      </section>

      <section className="border-t" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-px px-5 py-6 md:grid-cols-5">
          {trust.map(([title, copy]) => (
            <div key={title} className="px-4 py-5">
              <h3 className="text-lg font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-graphite-400">{copy}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
