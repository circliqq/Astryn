"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Panel } from "@/components/ui";
import { apiFetch } from "@/lib/api";

interface Ticket {
  id: string;
  subject: string;
  category: string | null;
  priority: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
}

interface TicketsResponse {
  items: Ticket[];
  total: number;
}

const STATUS_COLORS: Record<string, "blue" | "green" | "yellow" | "slate"> = {
  OPEN: "blue",
  IN_PROGRESS: "yellow",
  WAITING_USER: "yellow",
  RESOLVED: "green",
  CLOSED: "slate",
};

const PRIORITY_COLORS: Record<string, "blue" | "yellow" | "red"> = {
  LOW: "blue",
  MEDIUM: "yellow",
  HIGH: "red",
  URGENT: "red",
};

export default function SupportPage() {
  const { data, isLoading } = useQuery<TicketsResponse>({
    queryKey: ["support-tickets"],
    queryFn: () => apiFetch<TicketsResponse>("/support/tickets/mine"),
  });

  return (
    <AppShell title="Support">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-[24px] font-bold text-graphite-100">Support tickets</h1>
            <p className="text-[13px] text-graphite-400">View and manage your support requests</p>
          </div>
          <Link href="/support/create">
            <Button>New ticket</Button>
          </Link>
        </div>

        {isLoading ? (
          <Panel className="p-6 text-center">
            <p className="text-[13px] text-graphite-400">Loading tickets…</p>
          </Panel>
        ) : !data?.items.length ? (
          <Panel className="p-6 text-center">
            <p className="text-[13px] text-graphite-400">No support tickets yet.</p>
            <Link href="/support/create">
              <Button className="mt-4">Create your first ticket</Button>
            </Link>
          </Panel>
        ) : (
          <div className="space-y-3">
            {data.items.map((ticket) => (
              <Link key={ticket.id} href={`/support/${ticket.id}`}>
                <Panel className="cursor-pointer p-4 transition-colors hover:bg-graphite-800/40">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <h3 className="text-[14px] font-semibold text-graphite-100">{ticket.subject}</h3>
                      {ticket.category && (
                        <p className="mt-1 text-[12px] text-graphite-400">{ticket.category}</p>
                      )}
                      <div className="mt-2 flex items-center gap-2 text-[11px] text-graphite-500">
                        <span>{new Date(ticket.createdAt).toLocaleDateString()}</span>
                        <span>•</span>
                        <span>{ticket._count.messages} message{ticket._count.messages !== 1 ? "s" : ""}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Badge tone={STATUS_COLORS[ticket.status] || "slate"}>
                        {ticket.status.replace(/_/g, " ")}
                      </Badge>
                      <Badge tone={PRIORITY_COLORS[ticket.priority] || "blue"}>
                        {ticket.priority}
                      </Badge>
                    </div>
                  </div>
                </Panel>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
