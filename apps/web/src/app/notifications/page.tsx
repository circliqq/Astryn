"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCircle2, Globe2, MessageSquare, Save, Send, Smartphone, XCircle } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Input, Panel } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

type NotificationEvent =
  | "MINT_SUCCESS"
  | "MINT_FAILED"
  | "SNIPE_SUCCESS"
  | "SNIPE_FAILED"
  | "COLLECTION_PHASE_CHANGE"
  | "WALLET_LOW_BALANCE"
  | "BOT_COMPETITION_DETECTED"
  | "SWEEP_DETECTED";

type Channel = "DISCORD" | "SMS" | "WEBHOOK" | "TELEGRAM";

interface NotificationConfig {
  enabled: boolean;
  events: NotificationEvent[];
  discordJson: { webhookUrl?: string } | null;
  smsJson: { accountSid?: string; authToken?: string; from?: string; to?: string } | null;
  webhookJson: { url?: string; secret?: string } | null;
  telegramJson: { botToken?: string; chatId?: string } | null;
}

interface NotificationLog {
  id: string;
  channel: Channel;
  event: NotificationEvent;
  success: boolean;
  error: string | null;
  sentAt: string;
}

const EVENTS: Array<{ id: NotificationEvent; label: string; detail: string }> = [
  { id: "MINT_SUCCESS", label: "Mint success", detail: "Confirmed mints and completed runs." },
  { id: "MINT_FAILED", label: "Mint failed", detail: "Failed transactions or task errors." },
  { id: "SNIPE_SUCCESS", label: "Snipe success", detail: "Triggered buys and confirmed fills." },
  { id: "SNIPE_FAILED", label: "Snipe failed", detail: "Missed opportunities or failed orders." },
  { id: "COLLECTION_PHASE_CHANGE", label: "Phase change", detail: "Drop windows opening or closing." },
  { id: "WALLET_LOW_BALANCE", label: "Low balance", detail: "Wallets below funding thresholds." },
  { id: "BOT_COMPETITION_DETECTED", label: "Bot pressure", detail: "High competition signals." },
  { id: "SWEEP_DETECTED", label: "Sweep detected", detail: "Mass buys across a collection in a short window." },
];

const EVENT_LABELS = Object.fromEntries(EVENTS.map((event) => [event.id, event.label])) as Record<NotificationEvent, string>;

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const [activeChannel, setActiveChannel] = useState<"discord" | "sms" | "webhook" | "telegram">("discord");
  const [enabled, setEnabled] = useState(true);
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [discordWebhook, setDiscordWebhook] = useState("");
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [smsAccountSid, setSmsAccountSid] = useState("");
  const [smsAuthToken, setSmsAuthToken] = useState("");
  const [smsFrom, setSmsFrom] = useState("");
  const [smsTo, setSmsTo] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const { data: config, isLoading: configLoading } = useQuery<NotificationConfig>({
    queryKey: ["notification-config"],
    queryFn: () => apiFetch<NotificationConfig>("/notifications/config"),
  });

  const { data: logs = [], isLoading: logsLoading } = useQuery<NotificationLog[]>({
    queryKey: ["notification-logs"],
    queryFn: () => apiFetch<NotificationLog[]>("/notifications/logs?limit=50"),
  });

  useEffect(() => {
    if (!config) return;
    setEnabled(Boolean(config.enabled));
    setEvents(config.events ?? []);
    setDiscordWebhook(config.discordJson?.webhookUrl ?? "");
    setTelegramBotToken(config.telegramJson?.botToken ?? "");
    setTelegramChatId(config.telegramJson?.chatId ?? "");
    setSmsAccountSid(config.smsJson?.accountSid ?? "");
    setSmsAuthToken(config.smsJson?.authToken ?? "");
    setSmsFrom(config.smsJson?.from ?? "");
    setSmsTo(config.smsJson?.to ?? "");
    setWebhookUrl(config.webhookJson?.url ?? "");
    setWebhookSecret(config.webhookJson?.secret ?? "");
  }, [config]);

  const saveConfig = useMutation({
    mutationFn: () =>
      apiFetch<NotificationConfig>("/notifications/config", {
        method: "PUT",
        body: JSON.stringify({
          enabled,
          events,
          discordJson: discordWebhook.trim() ? { webhookUrl: discordWebhook.trim() } : undefined,
          telegramJson:
            telegramBotToken.trim() && telegramChatId.trim()
              ? { botToken: telegramBotToken.trim(), chatId: telegramChatId.trim() }
              : undefined,
          smsJson:
            smsAccountSid.trim() && smsAuthToken.trim() && smsFrom.trim() && smsTo.trim()
              ? {
                  accountSid: smsAccountSid.trim(),
                  authToken: smsAuthToken.trim(),
                  from: smsFrom.trim(),
                  to: smsTo.trim(),
                }
              : undefined,
          webhookJson: webhookUrl.trim()
            ? { url: webhookUrl.trim(), secret: webhookSecret.trim() || undefined }
            : undefined,
        }),
      }),
    onSuccess: () => {
      setMessage("Notification settings saved.");
      queryClient.invalidateQueries({ queryKey: ["notification-config"] });
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : "Unable to save notification settings.");
    },
  });

  const enabledChannels = useMemo(() => {
    return [
      discordWebhook.trim() ? "Discord" : null,
      telegramBotToken.trim() && telegramChatId.trim() ? "Telegram" : null,
      smsAccountSid.trim() && smsAuthToken.trim() && smsFrom.trim() && smsTo.trim() ? "SMS" : null,
      webhookUrl.trim() ? "Webhook" : null,
    ].filter(Boolean);
  }, [discordWebhook, telegramBotToken, telegramChatId, smsAccountSid, smsAuthToken, smsFrom, smsTo, webhookUrl]);

  function toggleEvent(id: NotificationEvent) {
    setEvents((current) => (current.includes(id) ? current.filter((event) => event !== id) : [...current, id]));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveConfig.mutate();
  }

  return (
    <AppShell title="Notifications">
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="metric-card">
            <p className="label-caps">System status</p>
            <div className="mt-3 flex items-center justify-between">
              <p className="text-[18px] font-semibold text-graphite-100">{enabled ? "Enabled" : "Paused"}</p>
              <Badge tone={enabled ? "green" : "slate"}>{enabled ? "Active" : "Paused"}</Badge>
            </div>
          </div>
          <div className="metric-card">
            <p className="label-caps">Delivery routes</p>
            <p className="metric-value">{enabledChannels.length}</p>
            <p className="mt-2 text-[12px] text-graphite-500">{enabledChannels.join(", ") || "No channel configured"}</p>
          </div>
          <div className="metric-card">
            <p className="label-caps">Events watched</p>
            <p className="metric-value">{events.length}</p>
            <p className="mt-2 text-[12px] text-graphite-500">Minting, sniping, balances, and phase changes.</p>
          </div>
        </div>

        <Panel>
          <div className="panel-header">
            <div>
              <p className="text-[14px] font-semibold text-graphite-100">System Notification Routing</p>
              <p className="mt-0.5 text-[12px] text-graphite-500">This page now lives under System and controls global alert delivery.</p>
            </div>
            <Button type="button" variant={enabled ? "secondary" : "primary"} onClick={() => setEnabled((value) => !value)}>
              <Bell size={14} /> {enabled ? "Pause" : "Enable"}
            </Button>
          </div>

          <div className="grid gap-5 p-5 lg:grid-cols-[280px_1fr]">
            <div className="space-y-2">
              {[
                { id: "discord" as const, label: "Discord", icon: MessageSquare },
                { id: "telegram" as const, label: "Telegram", icon: Send },
                { id: "sms" as const, label: "SMS", icon: Smartphone },
                { id: "webhook" as const, label: "Webhook", icon: Globe2 },
              ].map((channel) => {
                const Icon = channel.icon;
                const active = activeChannel === channel.id;
                return (
                  <button
                    key={channel.id}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md border px-3 py-3 text-left transition-colors",
                      active
                        ? "border-brand bg-brand-bg text-graphite-100"
                        : "border-graphite-700 bg-graphite-800 text-graphite-400 hover:border-graphite-600 hover:text-graphite-100"
                    )}
                    onClick={() => setActiveChannel(channel.id)}
                  >
                    <Icon size={15} />
                    <span className="font-medium">{channel.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="panel-section p-4">
              {activeChannel === "discord" && (
                <div>
                  <p className="text-[13px] font-semibold text-graphite-100">Discord webhook</p>
                  <p className="mt-1 text-[12px] text-graphite-500">Send concise operational alerts into a private Discord channel.</p>
                  <label className="mt-4 block">
                    <span className="mb-1 block text-[11px] font-medium text-graphite-400">Webhook URL</span>
                    <Input value={discordWebhook} onChange={(event) => setDiscordWebhook(event.target.value)} placeholder="https://discord.com/api/webhooks/..." />
                  </label>
                </div>
              )}

              {activeChannel === "telegram" && (
                <div>
                  <p className="text-[13px] font-semibold text-graphite-100">Telegram bot</p>
                  <p className="mt-1 text-[12px] text-graphite-500">Send alerts to a private chat, group, or channel through your Telegram bot.</p>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <label>
                      <span className="mb-1 block text-[11px] font-medium text-graphite-400">Bot token</span>
                      <Input value={telegramBotToken} onChange={(event) => setTelegramBotToken(event.target.value)} placeholder="123456:ABC..." type="password" />
                    </label>
                    <label>
                      <span className="mb-1 block text-[11px] font-medium text-graphite-400">Chat ID</span>
                      <Input value={telegramChatId} onChange={(event) => setTelegramChatId(event.target.value)} placeholder="-1001234567890" />
                    </label>
                  </div>
                </div>
              )}

              {activeChannel === "sms" && (
                <div>
                  <p className="text-[13px] font-semibold text-graphite-100">SMS delivery</p>
                  <p className="mt-1 text-[12px] text-graphite-500">Use Twilio credentials for high-signal mobile alerts.</p>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <Input value={smsAccountSid} onChange={(event) => setSmsAccountSid(event.target.value)} placeholder="Account SID" />
                    <Input value={smsAuthToken} onChange={(event) => setSmsAuthToken(event.target.value)} placeholder="Auth token" type="password" />
                    <Input value={smsFrom} onChange={(event) => setSmsFrom(event.target.value)} placeholder="From number" />
                    <Input value={smsTo} onChange={(event) => setSmsTo(event.target.value)} placeholder="To number" />
                  </div>
                </div>
              )}

              {activeChannel === "webhook" && (
                <div>
                  <p className="text-[13px] font-semibold text-graphite-100">Custom webhook</p>
                  <p className="mt-1 text-[12px] text-graphite-500">Forward signed event payloads to your own automation stack.</p>
                  <div className="mt-4 grid gap-3">
                    <Input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://example.com/astryn-webhook" />
                    <Input value={webhookSecret} onChange={(event) => setWebhookSecret(event.target.value)} placeholder="Signing secret (optional)" type="password" />
                  </div>
                </div>
              )}
            </div>
          </div>
        </Panel>

        <Panel>
          <div className="panel-header">
            <div>
              <p className="text-[14px] font-semibold text-graphite-100">Event Coverage</p>
              <p className="mt-0.5 text-[12px] text-graphite-500">Choose the system events that should leave the console.</p>
            </div>
            <Badge tone="neutral">{events.length}/{EVENTS.length}</Badge>
          </div>
          <div className="grid gap-2 p-5 md:grid-cols-2 xl:grid-cols-3">
            {EVENTS.map((item) => {
              const checked = events.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={cn(
                    "rounded-md border px-3 py-3 text-left transition-colors",
                    checked
                      ? "border-brand bg-brand-bg text-graphite-100"
                      : "border-graphite-700 bg-graphite-800 text-graphite-400 hover:border-graphite-600"
                  )}
                  onClick={() => toggleEvent(item.id)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{item.label}</span>
                    <Badge tone={checked ? "green" : "slate"}>{checked ? "On" : "Off"}</Badge>
                  </div>
                  <p className="mt-1 text-[12px] text-graphite-500">{item.detail}</p>
                </button>
              );
            })}
          </div>
        </Panel>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12px] text-graphite-500">{configLoading ? "Loading saved configuration..." : message}</p>
          <Button type="submit" disabled={saveConfig.isPending}>
            <Save size={14} /> {saveConfig.isPending ? "Saving..." : "Save Notification System"}
          </Button>
        </div>
      </form>

      <Panel className="mt-5">
        <div className="panel-header">
          <div>
            <p className="text-[14px] font-semibold text-graphite-100">Delivery Log</p>
            <p className="mt-0.5 text-[12px] text-graphite-500">Recent notification attempts across every channel.</p>
          </div>
          <Badge tone="neutral">{logs.length}</Badge>
        </div>
        {logsLoading ? (
          <div className="empty-state">Loading delivery log...</div>
        ) : logs.length === 0 ? (
          <div className="empty-state">No notification logs yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full min-w-[720px] text-left">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Channel</th>
                  <th>Status</th>
                  <th>Sent</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="font-medium text-graphite-200">{EVENT_LABELS[log.event] ?? log.event}</td>
                    <td><Badge tone={log.channel === "DISCORD" || log.channel === "TELEGRAM" ? "blue" : log.channel === "SMS" ? "green" : "slate"}>{log.channel}</Badge></td>
                    <td>
                      {log.success ? (
                        <span className="flex items-center gap-1 text-status-green-text"><CheckCircle2 size={12} /> Sent</span>
                      ) : (
                        <span className="flex items-center gap-1 text-status-red-text"><XCircle size={12} /> Failed</span>
                      )}
                    </td>
                    <td className="text-[12px] text-graphite-500">{new Date(log.sentAt).toLocaleString()}</td>
                    <td className="max-w-[260px] truncate text-[12px] text-graphite-500">{log.error ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </AppShell>
  );
}
