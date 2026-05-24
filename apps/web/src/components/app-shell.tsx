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
    <span
      className="hidden items-center gap-1.5 rounded-[6px] border px-2.5 py-1 font-mono text-[12px] font-semibold md:flex"
      style={{
        background: "var(--surface-2)",
        borderColor: "var(--border)",
        color: "var(--text-1)",
      }}
    >
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
  const baseFeeGwei  = rawGwei !== null
    ? rawGwei < 1 ? rawGwei.toFixed(3) : rawGwei.toFixed(1)
    : null;
  const gasHigh = rawGwei !== null && rawGwei >= 50;
  const gasMid  = rawGwei !== null && rawGwei >= 10 && !gasHigh;

  return (
    <div className="hidden items-center gap-2 text-[11.5px] md:flex" style={{ color: "var(--text-3)" }}>
      {rpc.length > 0 && (
        <span
          className="flex items-center gap-1.5 rounded-[5px] px-2 py-0.5"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-2)" }}
        >
          <Dot tone={allRpcOk ? "green" : someRpcBad ? "yellow" : "muted"} />
          RPC {healthyRpc}/{rpc.length}
        </span>
      )}
      {readyPct !== null && (
        <span
          className="flex items-center gap-1.5 rounded-[5px] px-2 py-0.5"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-2)" }}
        >
          <Dot tone={readyPct >= 80 ? "green" : readyPct >= 50 ? "yellow" : "red"} />
          {readyPct}% ready
        </span>
      )}
      {baseFeeGwei !== null && (
        <span
          className="flex items-center gap-1.5 rounded-[5px] px-2 py-0.5"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-2)" }}
        >
          <Dot tone={gasHigh ? "red" : gasMid ? "yellow" : "green"} />
          {baseFeeGwei} gwei
        </span>
      )}
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
      <main
        className="grid min-h-screen place-items-center px-4"
        style={{ background: "var(--bg)" }}
      >
        <div className="panel w-full max-w-sm p-6 text-center">
          <p className="text-[13px] font-medium" style={{ color: "var(--text-1)" }}>
            {authState === "checking" ? "Checking session…" : "Unable to verify session."}
          </p>
          {authError && (
            <p className="mt-2 text-[12px] text-status-red-text">{authError}</p>
          )}
        </div>
      </main>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <Sidebar />
      <MobileSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header
          className="h-11 shrink-0 flex items-center justify-between px-5 border-b"
          style={{
            background: "var(--surface)",
            borderColor: "var(--border)",
          }}
        >
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              className="size-7 px-0 lg:hidden"
              aria-label="Open navigation"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={15} />
            </Button>
            <h1
              className="text-[13px] font-medium"
              style={{ color: "var(--text-1)" }}
            >
              {title}
            </h1>
          </div>

          <div className="flex items-center gap-1.5">
            <LiveClock />
            <LiveStatusBar />
            <span className="h-3.5 w-px mx-1" style={{ background: "var(--border-2)" }} />
            <Button
              type="button"
              variant="ghost"
              className="size-7 px-0"
              style={{ color: "var(--text-3)" }}
              aria-label="Logout"
              title="Logout"
              onClick={handleLogout}
              disabled={loggingOut}
            >
              <LogOut size={14} />
            </Button>
          </div>
        </header>

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] p-5">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
