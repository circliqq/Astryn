"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { Panel } from "@/components/ui";

interface Me {
  id: string;
  email: string;
  role: string;
}

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { data, isLoading, isError } = useQuery<Me>({
    queryKey: ["auth-me"],
    queryFn: () => apiFetch<Me>("/auth/me"),
    staleTime: 30_000,
  });

  if (isLoading) {
    return <p className="text-[13px] text-graphite-400">Checking permissions…</p>;
  }
  if (isError || !data) {
    return (
      <Panel className="p-6">
        <p className="text-[13px] text-status-red-text">Unable to verify your session.</p>
      </Panel>
    );
  }
  if (data.role !== "admin") {
    return (
      <Panel className="p-6">
        <p className="text-[13px] font-medium text-graphite-100">Admin access required</p>
        <p className="mt-1 text-[12px] text-graphite-400">
          Your account does not have permission to view this page.
        </p>
        <Link href="/dashboard" className="mt-3 inline-block text-[12px] text-brand hover:underline">
          Back to dashboard
        </Link>
      </Panel>
    );
  }
  return <>{children}</>;
}
