"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Flame } from "lucide-react";
import { Button, Input } from "./ui";
import { apiFetch, setToken } from "@/lib/api";

// ── Logo mark ─────────────────────────────────────────────────────────────

function AuthLogo() {
  return (
    <div className="flex flex-col items-center gap-2.5">
      <span
        className="grid size-10 shrink-0 place-items-center rounded-[8px] leading-none text-white"
        style={{ background: "var(--brand)" }}
      >
        <Flame size={18} strokeWidth={2.2} />
      </span>
      <div className="text-center">
        <p className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--text-1)" }}>
          Astryn
        </p>
        <p className="text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--text-3)", letterSpacing: "0.14em" }}>
          Gas War
        </p>
      </div>
    </div>
  );
}

// ── AuthCard ──────────────────────────────────────────────────────────────

export function AuthCard({ mode }: { mode: "login" | "register" }) {
  const isLogin = mode === "login";
  const router  = useRouter();

  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isLogin && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch<{
        session?: { access_token: string } | null;
        user?: { id: string } | null;
      }>(
        isLogin ? "/auth/login" : "/auth/register",
        { method: "POST", body: JSON.stringify({ email, password }) }
      );
      if (data.session?.access_token) {
        setToken(data.session.access_token);
        router.push("/dashboard");
      } else if (!isLogin && data.user) {
        setError("Check your email for a confirmation link before logging in.");
      } else {
        setError("Login failed — no session returned. Check your credentials.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: "var(--bg)" }}
    >
      <div className="w-full max-w-[380px]">
        {/* Logo */}
        <div className="mb-8 flex justify-center">
          <AuthLogo />
        </div>

        {/* Card */}
        <div className="panel p-8">
          <h1
            className="text-[18px] font-semibold tracking-tight"
            style={{ color: "var(--text-1)" }}
          >
            {isLogin ? "Sign in" : "Create account"}
          </h1>
          <p
            className="mt-1 mb-6 text-[13px]"
            style={{ color: "var(--text-3)" }}
          >
            {isLogin
              ? "Access your minting console."
              : "Secure auth with encrypted wallet storage."}
          </p>

          <form className="space-y-3" onSubmit={handleSubmit}>
            <div>
              <label
                className="mb-1.5 block text-[11px] font-medium"
                style={{ color: "var(--text-2)" }}
              >
                Email
              </label>
              <Input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div>
              <label
                className="mb-1.5 block text-[11px] font-medium"
                style={{ color: "var(--text-2)" }}
              >
                Password
              </label>
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {!isLogin && (
              <div>
                <label
                  className="mb-1.5 block text-[11px] font-medium"
                  style={{ color: "var(--text-2)" }}
                >
                  Confirm password
                </label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
            )}

            {error && (
              <p className="rounded border border-status-red-border bg-status-red-bg px-3 py-2 text-[12px] text-status-red-text">
                {error}
              </p>
            )}

            {isLogin && (
              <div className="flex justify-end">
                <Link
                  href="/forgot-password"
                  className="text-[12px] hover:underline"
                  style={{ color: "var(--brand)" }}
                >
                  Forgot password?
                </Link>
              </div>
            )}

            <Button className="w-full mt-1" disabled={loading}>
              {loading ? "Please wait…" : isLogin ? "Sign in" : "Create account"}
            </Button>
          </form>
        </div>

        {/* Footer link */}
        <p
          className="mt-5 text-center text-[12px]"
          style={{ color: "var(--text-3)" }}
        >
          {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
          <Link
            href={isLogin ? "/register" : "/login"}
            className="font-medium hover:underline"
            style={{ color: "var(--brand)" }}
          >
            {isLogin ? "Register" : "Sign in"}
          </Link>
        </p>
      </div>
    </main>
  );
}
