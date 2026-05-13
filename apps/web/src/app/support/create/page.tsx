"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Button, Input, Panel, Select, Textarea } from "@/components/ui";
import { apiFetch } from "@/lib/api";

export default function CreateSupportTicketPage() {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [body, setBody] = useState("");

  const create = useMutation({
    mutationFn: () =>
      apiFetch("/support/tickets", {
        method: "POST",
        body: JSON.stringify({
          subject: subject.trim(),
          category: category || null,
          priority,
          body: body.trim(),
        }),
      }),
    onSuccess: (res: { id: string }) => {
      router.push(`/support/${res.id}`);
    },
  });

  const canSubmit = subject.trim() && body.trim() && body.trim().length >= 5;

  return (
    <AppShell title="Create support ticket">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-[24px] font-bold text-graphite-100 mb-2">Create support ticket</h1>
        <p className="text-[13px] text-graphite-400 mb-6">
          Describe your issue and we'll get back to you as soon as possible
        </p>

        <Panel className="p-6 space-y-4">
          <div>
            <label className="block text-[12px] font-medium uppercase tracking-[0.06em] text-graphite-500 mb-2">
              Subject
            </label>
            <Input
              placeholder="Brief description of your issue"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
            />
            <p className="mt-1 text-[11px] text-graphite-500">
              {subject.length} / 200 characters
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] font-medium uppercase tracking-[0.06em] text-graphite-500 mb-2">
                Category (optional)
              </label>
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Select category</option>
                <option value="account">Account</option>
                <option value="wallets">Wallets</option>
                <option value="minting">Minting</option>
                <option value="technical">Technical</option>
                <option value="billing">Billing</option>
                <option value="other">Other</option>
              </Select>
            </div>

            <div>
              <label className="block text-[12px] font-medium uppercase tracking-[0.06em] text-graphite-500 mb-2">
                Priority
              </label>
              <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </Select>
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium uppercase tracking-[0.06em] text-graphite-500 mb-2">
              Description
            </label>
            <Textarea
              placeholder="Please describe your issue in detail. Include any error messages or steps to reproduce."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={8000}
              className="min-h-[150px]"
            />
            <p className="mt-1 text-[11px] text-graphite-500">
              {body.length} / 8000 characters (minimum 5)
            </p>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-graphite-700">
            <Button variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button
              onClick={() => create.mutate()}
              disabled={!canSubmit || create.isPending}
            >
              {create.isPending ? "Creating…" : "Create ticket"}
            </Button>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
