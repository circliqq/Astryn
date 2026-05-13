"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Input, Panel, Textarea } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import Link from "next/link";

interface Message {
  id: string;
  body: string;
  authorRole: "user" | "admin" | "support";
  author: { id: string; email: string; displayName: string | null };
  internal: boolean;
  createdAt: string;
}

interface TicketDetail {
  id: string;
  subject: string;
  category: string | null;
  priority: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
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

export default function SupportTicketPage() {
  const params = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [message, setMessage] = useState("");

  const { data, isLoading } = useQuery<TicketDetail>({
    queryKey: ["support-ticket", params.id],
    queryFn: () => apiFetch<TicketDetail>(`/support/tickets/${params.id}`),
    enabled: !!params.id,
  });

  const addMessage = useMutation({
    mutationFn: (body: string) =>
      apiFetch(`/support/tickets/${params.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => {
      setMessage("");
      qc.invalidateQueries({ queryKey: ["support-ticket", params.id] });
    },
  });

  return (
    <AppShell title="Support ticket">
      <div className="max-w-2xl mx-auto">
        {isLoading || !data ? (
          <Panel className="p-6 text-center">
            <p className="text-[13px] text-graphite-400">Loading…</p>
          </Panel>
        ) : (
          <div className="space-y-4">
            {/* Header */}
            <Panel className="p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h1 className="text-[20px] font-bold text-graphite-100">{data.subject}</h1>
                  {data.category && (
                    <p className="mt-1 text-[12px] text-graphite-400">{data.category}</p>
                  )}
                </div>
                <Link href="/support" className="text-[12px] text-brand hover:underline">
                  ← Back
                </Link>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={STATUS_COLORS[data.status] || "slate"}>
                  {data.status.replace(/_/g, " ")}
                </Badge>
                <Badge tone={PRIORITY_COLORS[data.priority] || "blue"}>
                  {data.priority}
                </Badge>
                <span className="text-[11px] text-graphite-500">
                  Created {new Date(data.createdAt).toLocaleString()}
                </span>
              </div>
            </Panel>

            {/* Messages */}
            <div className="space-y-3">
              {data.messages.map((msg) => (
                <Panel
                  key={msg.id}
                  className={`p-4 ${
                    msg.authorRole === "user"
                      ? "bg-graphite-800/40"
                      : "bg-graphite-900"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <p className="text-[12px] font-medium text-graphite-100">
                        {msg.author.displayName || msg.author.email}
                      </p>
                      {msg.authorRole !== "user" && (
                        <Badge
                          tone={msg.authorRole === "admin" ? "blue" : "yellow"}
                          className="mt-1"
                        >
                          {msg.authorRole === "admin" ? "Admin" : "Support"}
                        </Badge>
                      )}
                    </div>
                    <span className="text-[11px] text-graphite-500">
                      {new Date(msg.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-[13px] text-graphite-300 whitespace-pre-wrap">
                    {msg.body}
                  </p>
                </Panel>
              ))}
            </div>

            {/* Reply form - only show if ticket is open for replies */}
            {data.status !== "CLOSED" && (
              <Panel className="p-4">
                <div className="space-y-3">
                  <label className="block text-[12px] font-medium uppercase tracking-[0.06em] text-graphite-500">
                    Add a message
                  </label>
                  <Textarea
                    placeholder="Type your message here…"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    maxLength={8000}
                    className="min-h-[100px]"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-graphite-500">
                      {message.length} / 8000
                    </span>
                    <Button
                      onClick={() => addMessage.mutate(message)}
                      disabled={!message.trim() || addMessage.isPending}
                    >
                      {addMessage.isPending ? "Sending…" : "Send message"}
                    </Button>
                  </div>
                </div>
              </Panel>
            )}

            {data.status === "CLOSED" && (
              <Panel className="p-4 text-center">
                <p className="text-[12px] text-graphite-400">
                  This ticket is closed and no longer accepts messages.
                </p>
              </Panel>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
