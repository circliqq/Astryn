"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Brand } from "./brand";
import { Button, Input } from "./ui";
import { apiFetch, setToken } from "@/lib/api";

export function AuthCard({ mode }: { mode: "login" | "register" }) {
  const isLogin = mode === "login";
  const router = useRouter();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isLogin && password !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true);
    try {
      const data = await apiFetch<{ session?: { access_token: string } | null; user?: { id: string } | null }>(
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
    <main className="grid min-h-screen place-items-center bg-graphite-950 px-4">
      <div className="w-full max-w-[380px]">
        {/* Logo */}
        <div className="mb-8">
          <Brand />
        </div>

        {/* Card */}
        <div className="panel p-6">
          <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-graphite-100">
            {isLogin ? "Sign in" : "Create account"}
          </h1>
          <p className="mt-1 text-[12px] text-graphite-500">
            {isLogin
              ? "Continue to your mint operations console."
              : "Start with secure auth and encrypted wallet storage."}
          </p>

          <form className="mt-5 space-y-3" onSubmit={handleSubmit}>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-graphite-400">Email</label>
              <Input
                type="email"
                placeholder="you@example.com"
                className="w-full"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-graphite-400">Password</label>
              <Input
                type="password"
                placeholder="••••••••"
                className="w-full"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {!isLogin && (
              <div>
                <label className="mb-1 block text-[11px] font-medium text-graphite-400">Confirm password</label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  className="w-full"
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

            <Button className="mt-1 w-full" disabled={loading}>
              {loading ? "Please wait…" : isLogin ? "Sign in" : "Create account"}
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-[12px] text-graphite-500">
          {isLogin ? "New to Astryn?" : "Already have an account?"}{" "}
          <Link
            className="text-brand hover:underline"
            href={isLogin ? "/register" : "/login"}
          >
            {isLogin ? "Create account" : "Sign in"}
          </Link>
        </p>
      </div>
    </main>
  );
}
