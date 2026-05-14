"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { LogOut, Menu } from "lucide-react";
import { Sidebar, MobileSidebar } from "./sidebar";
import { Button } from "./ui";
import { applyAppPreferences, readAppSettings } from "@/lib/app-settings";
import { apiFetch, clearToken, getToken } from "@/lib/api";
import { cn } from "@/lib/utils";
import { getUserTimezone } from "@/lib/format-date";

// ── Types ─────────────────────────────────────────────────────────────────
interface WalletStub { id: string; status: string }
interface RpcResult  { endpointId: string; status: string }
interface GasResult  { baseFeePerGas: string }

// ── Dot ───────────────────────────────────────────────────────────────────
function Dot({ tone }: { tone: "green" | "yellow" | "red" | "muted" }) {
  return (
    <span
      className={cn(
        "inline-block size-[6px] rounded-full shrink-0",
        tone === "green"  && "bg-status-green-text",
        tone === "yellow" && "bg-status-yellow-text",
        tone === "red"    && "bg-status-red-text",
        tone === "muted"  && "bg-graphite-600",
      )}
    />
  );
}

// ── Live clock ────────────────────────────────────────────────────────────
function LiveClock() {
  const [time, setTime] = useState("");

  useEffect(() => {
    function tick() {
      const tz = getUserTimezone();
      setTime(
        new Intl.DateTimeFormat("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZone: tz,
          timeZoneName: "short",
        }).format(new Date())
      );
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  if (!time) return null;
  return (
    <span className="hidden items-center gap-1.5 rounded-md border border-graphite-700 bg-graphite-800 px-2.5 py-1 font-mono text-[12px] font-medium text-graphite-100 md:flex">
      {time}
    </span>
  );
}

// ── Live status bar ───────────────────────────────────────────────────────
function LiveStatusBar() {
  const { data: wallets = [] } = useQuery<WalletStub[]>({
    queryKey: ["wallets"],
    queryFn: () => apiFetch<WalletStub[]>("/wallets"),
    staleTime: 30_000,
  });
  const { data: rpc = [] } = useQuery<RpcResult[]>({
    queryKey: ["rpc-health"],
    queryFn: () => apiFetch<RpcResult[]>("/rpc/health"),
    refetchInterval: 60_000,
  });
  const { data: gas } = useQuery<GasResult>({
    queryKey: ["gas-current", "ethereum"],
    queryFn: () => apiFetch<GasResult>("/gas/current?network=ethereum"),
    refetchInterval: 15_000,
  });

  const totalWallets = wallets.length;
  const readyWallets = wallets.filter((w) => w.status === "READY").length;
  const readyPct     = totalWallets > 0 ? Math.round((readyWallets / totalWallets) * 100) : null;
  const healthyRpc   = rpc.filter((r) => r.status === "healthy").length;
  const allRpcOk     = rpc.length > 0 && healthyRpc === rpc.length;
  const someRpcBad   = rpc.length > 0 && healthyRpc < rpc.length;
  const rawGwei      = gas ? Number(BigInt(gas.baseFeePerGas)) / 1e9 : null;
  // Use 3 decimal places at low gas (<1 gwei), 1 decimal place otherwise
  const baseFeeGwei  = rawGwei !== null
    ? rawGwei < 1 ? rawGwei.toFixed(3) : rawGwei.toFixed(1)
    : null;
  const gasHigh      = rawGwei !== null && rawGwei >= 50;
  const gasMid       = rawGwei !== null && rawGwei >= 10 && !gasHigh;

  return (
    <div className="hidden items-center gap-4 text-[12px] text-graphite-400 md:flex">
      {rpc.length > 0 && (
        <span className="flex items-center gap-1.5">
          <Dot tone={allRpcOk ? "green" : someRpcBad ? "yellow" : "muted"} />
          RPC {healthyRpc}/{rpc.length}
        </span>
      )}
      {readyPct !== null && (
        <span className="flex items-center gap-1.5">
          <Dot tone={readyPct >= 80 ? "green" : readyPct >= 50 ? "yellow" : "red"} />
          Wallets {readyPct}%
        </span>
      )}
      {baseFeeGwei !== null && (
        <span className="flex items-center gap-1.5">
          <Dot tone={gasHigh ? "red" : gasMid ? "yellow" : "green"} />
          Gas {baseFeeGwei} gwei
        </span>
      )}
      <span className="h-3.5 w-px bg-graphite-700" />
    </div>
  );
}

// ── AppShell ──────────────────────────────────────────────────────────────
export function AppShell({ title, children }: { title: string; children: React.ReactNode }) {
  const router = useRouter();
  const [authState, setAuthState]   = useState<"checking" | "ready" | "error">("checking");
  const [authError, setAuthError]   = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function verify() {
      if (!getToken()) { clearToken(); router.replace("/login"); return; }
      try {
        await apiFetch("/auth/me");
        if (cancelled) return;
        setAuthState("ready");
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Unable to verify session.";
        if (msg === "Session expired. Please log in again.") { router.replace("/login"); return; }
        setAuthError(msg);
        setAuthState("error");
      }
    }
    void verify();
    return () => { cancelled = true; };
  }, [router]);

  useEffect(() => { applyAppPreferences(readAppSettings()); }, []);

  async function handleLogout() {
    setLoggingOut(true);
    try { await apiFetch("/auth/logout", { method: "POST" }); } catch { /* ok */ }
    finally { clearToken(); router.replace("/login"); }
  }

  if (authState !== "ready") {
    return (
      <main className="grid min-h-screen place-items-center bg-graphite-950 px-4">
        <div className="panel w-full max-w-sm p-6 text-center">
          <p className="text-[13px] font-medium text-graphite-100">
            {authState === "checking" ? "Checking session…" : "Unable to verify session."}
          </p>
          {authError && <p className="mt-2 text-[12px] text-status-red-text">{authError}</p>}
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen bg-graphite-950">
      <Sidebar />
      <MobileSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b border-graphite-700 bg-graphite-950/95 px-4 backdrop-blur-[8px] md:px-5">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              className={cn("size-8 px-0 lg:hidden")}
              aria-label="Open navigation"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={16} />
            </Button>
            <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-graphite-100">
              {title}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <LiveClock />
            <LiveStatusBar />
            <Button
              type="button"
              variant="ghost"
              className="size-8 px-0 text-graphite-400"
              aria-label="Logout"
              title="Logout"
              onClick={handleLogout}
              disabled={loggingOut}
            >
              <LogOut size={14} />
            </Button>
          </div>
        </header>

        <div className="mx-auto max-w-[1480px] p-4 md:p-5">{children}</div>
      </main>
    </div>
  );
}
