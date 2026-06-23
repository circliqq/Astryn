"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Play, RotateCcw, Search } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Checkbox, Input, Panel, Textarea } from "@/components/ui";
import { apiFetch } from "@/lib/api";

interface Wallet {
  id: string;
  name: string;
  address: string;
  network: "BASE" | "ETHEREUM";
  status: string;
}

type SubmitStatus = "idle" | "queued" | "submitting" | "submitted" | "failed";

interface DetectedField {
  label: string;
  fieldName: string;
  required: boolean;
  type: string;
}

interface DetectResponse {
  actionUrl: string;
  fields: DetectedField[];
}

function normalizeGoogleFormUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return "";
  return trimmed
    .replace("/viewform", "/formResponse")
    .replace(/\/viewform\?.*$/, "/formResponse");
}

function parseExtraFields(raw: string) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf("=");
      if (index === -1) return null;
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()] as const;
    })
    .filter((item): item is readonly [string, string] => Boolean(item?.[0]));
}

function submitHiddenForm(actionUrl: string, fields: Array<readonly [string, string]>) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = actionUrl;
  form.target = "bulk-form-submit-frame";
  form.style.display = "none";

  for (const [name, value] of fields) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
  window.setTimeout(() => form.remove(), 2_000);
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function BulkFormsPage() {
  const [formUrl, setFormUrl] = useState("");
  const [walletField, setWalletField] = useState("");
  const [nameField, setNameField] = useState("");
  const [networkField, setNetworkField] = useState("");
  const [extraFields, setExtraFields] = useState("");
  const [delayMs, setDelayMs] = useState("1200");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<Record<string, SubmitStatus>>({});
  const [detectedFields, setDetectedFields] = useState<DetectedField[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");

  const { data: wallets = [], isLoading } = useQuery<Wallet[]>({
    queryKey: ["wallets"],
    queryFn: () => apiFetch<Wallet[]>("/wallets"),
  });

  const selectedWallets = useMemo(
    () => wallets.filter((wallet) => selectedIds.includes(wallet.id)),
    [wallets, selectedIds],
  );
  const actionUrl = normalizeGoogleFormUrl(formUrl);
  const parsedExtras = parseExtraFields(extraFields);
  const selectedAll = wallets.length > 0 && selectedIds.length === wallets.length;

  function toggleWallet(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function resetRun() {
    setStatuses({});
    setMessage("");
  }

  async function detectFields() {
    if (!formUrl.trim()) {
      setMessage("Paste the Google Form link first.");
      return;
    }
    setDetecting(true);
    setMessage("Detecting Google Form fields...");
    try {
      const result = await apiFetch<DetectResponse>(`/form-tools/google-fields?url=${encodeURIComponent(formUrl)}`);
      setFormUrl(result.actionUrl);
      setDetectedFields(result.fields);
      const walletMatch = result.fields.find((field) => /wallet|evm|address/i.test(field.label));
      const xMatch = result.fields.find((field) => /\bx\b|twitter|username/i.test(field.label));
      if (walletMatch) setWalletField(walletMatch.fieldName);
      if (xMatch && !extraFields.includes(xMatch.fieldName)) {
        setExtraFields((current) => current || `${xMatch.fieldName}=`);
      }
      setMessage(`Detected ${result.fields.length} field${result.fields.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not detect fields.");
    } finally {
      setDetecting(false);
    }
  }

  async function runSubmissions() {
    if (!actionUrl) {
      setMessage("Paste a form link first.");
      return;
    }
    if (!walletField.trim()) {
      setMessage("Add the wallet address field name, for example entry.123456.");
      return;
    }
    if (selectedWallets.length === 0) {
      setMessage("Select at least one wallet.");
      return;
    }

    const delay = Math.max(500, Number.parseInt(delayMs, 10) || 1200);
    setRunning(true);
    setMessage(`Submitting ${selectedWallets.length} wallet form entries...`);
    setStatuses(Object.fromEntries(selectedWallets.map((wallet) => [wallet.id, "queued" as SubmitStatus])));

    for (const wallet of selectedWallets) {
      try {
        setStatuses((current) => ({ ...current, [wallet.id]: "submitting" }));
        const fields: Array<readonly [string, string]> = [
          [walletField.trim(), wallet.address],
          ...parsedExtras,
        ];
        if (nameField.trim()) fields.push([nameField.trim(), wallet.name]);
        if (networkField.trim()) fields.push([networkField.trim(), wallet.network]);
        fields.push(["submit", "Submit"]);

        submitHiddenForm(actionUrl, fields);
        setStatuses((current) => ({ ...current, [wallet.id]: "submitted" }));
        await sleep(delay);
      } catch {
        setStatuses((current) => ({ ...current, [wallet.id]: "failed" }));
      }
    }

    setRunning(false);
    setMessage("Bulk submit run finished.");
  }

  return (
    <AppShell title="Bulk Form Submitter">
      <iframe name="bulk-form-submit-frame" title="Bulk form submit frame" className="hidden" />
      <div className="space-y-5">
        <Panel className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-[7px]" style={{ background: "var(--surface-2)", color: "var(--brand)" }}>
                <ClipboardList size={18} />
              </span>
              <div>
                <h2 className="text-[15px] font-semibold" style={{ color: "var(--text-1)" }}>Wallet form batch</h2>
                <p className="text-[12px]" style={{ color: "var(--text-3)" }}>Submit one public form entry per selected wallet.</p>
              </div>
            </div>
            <Badge tone={running ? "yellow" : "blue"}>{running ? "Running" : `${selectedWallets.length} selected`}</Badge>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <label>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em]" style={{ color: "var(--text-3)" }}>Form link or action URL</p>
              <div className="flex gap-2">
                <Input value={formUrl} onChange={(event) => setFormUrl(event.target.value)} placeholder="https://docs.google.com/forms/d/e/.../viewform" />
                <Button type="button" variant="secondary" onClick={detectFields} disabled={detecting || running}>
                  <Search size={14} /> {detecting ? "Detecting" : "Detect"}
                </Button>
              </div>
              {actionUrl && <p className="mt-1 truncate text-[11px]" style={{ color: "var(--text-3)" }}>POST: {actionUrl}</p>}
            </label>

            <label>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em]" style={{ color: "var(--text-3)" }}>Wallet address field</p>
              <Input value={walletField} onChange={(event) => setWalletField(event.target.value)} placeholder="entry.123456789" />
            </label>

            <label>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em]" style={{ color: "var(--text-3)" }}>Wallet name field optional</p>
              <Input value={nameField} onChange={(event) => setNameField(event.target.value)} placeholder="entry.987654321" />
            </label>

            <label>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em]" style={{ color: "var(--text-3)" }}>Network field optional</p>
              <Input value={networkField} onChange={(event) => setNetworkField(event.target.value)} placeholder="entry.555555555" />
            </label>
          </div>

          {detectedFields.length > 0 && (
            <Panel className="mt-4 border p-3" style={{ borderColor: "var(--border)" }}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-[13px] font-semibold" style={{ color: "var(--text-1)" }}>Detected form fields</p>
                <Badge tone="blue">{detectedFields.length} fields</Badge>
              </div>
              <div className="grid gap-2">
                {detectedFields.map((field) => (
                  <div key={field.fieldName} className="grid gap-2 rounded-[7px] border px-3 py-2 md:grid-cols-[1fr_auto]" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-medium" style={{ color: "var(--text-1)" }}>
                        {field.label} {field.required && <span style={{ color: "#fb7185" }}>*</span>}
                      </p>
                      <p className="font-mono text-[11px]" style={{ color: "var(--text-3)" }}>{field.fieldName}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="secondary" onClick={() => setWalletField(field.fieldName)}>Wallet</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setNameField(field.fieldName)}>Name</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setNetworkField(field.fieldName)}>Network</Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setExtraFields((current) => `${current}${current.trim() ? "\n" : ""}${field.fieldName}=`)}
                      >
                        Extra
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_180px]">
            <label>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em]" style={{ color: "var(--text-3)" }}>Fixed extra fields</p>
              <Textarea
                value={extraFields}
                onChange={(event) => setExtraFields(event.target.value)}
                placeholder={"entry.111111=email@example.com\nentry.222222=@twitter\nentry.333333=discord_name"}
              />
            </label>
            <label>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em]" style={{ color: "var(--text-3)" }}>Delay per submit</p>
              <Input value={delayMs} onChange={(event) => setDelayMs(event.target.value)} inputMode="numeric" />
              <p className="mt-2 text-[11px] leading-5" style={{ color: "var(--text-3)" }}>Use a calm delay. Forms with CAPTCHA/login/CSRF may reject automated POSTs.</p>
            </label>
          </div>

          {message && <p className="mt-4 text-[12px]" style={{ color: "var(--text-2)" }}>{message}</p>}

          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" onClick={runSubmissions} disabled={running}>
              <Play size={14} /> Submit selected
            </Button>
            <Button type="button" variant="secondary" onClick={resetRun} disabled={running}>
              <RotateCcw size={14} /> Reset status
            </Button>
          </div>
        </Panel>

        <Panel>
          <div className="flex items-center justify-between gap-3 border-b px-5 py-3" style={{ borderColor: "var(--border)" }}>
            <div>
              <p className="text-[14px] font-semibold" style={{ color: "var(--text-1)" }}>Wallets</p>
              <p className="text-[12px]" style={{ color: "var(--text-3)" }}>{wallets.length} available</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setSelectedIds(selectedAll ? [] : wallets.map((wallet) => wallet.id))}
              disabled={running || wallets.length === 0}
            >
              {selectedAll ? "Clear all" : "Select all"}
            </Button>
          </div>

          {isLoading ? (
            <div className="empty-state">Loading wallets...</div>
          ) : wallets.length === 0 ? (
            <div className="empty-state">No wallets found.</div>
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--border)" }}>
              {wallets.map((wallet) => {
                const selected = selectedIds.includes(wallet.id);
                const status = statuses[wallet.id] ?? "idle";
                return (
                  <button
                    key={wallet.id}
                    type="button"
                    className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-graphite-800/50"
                    onClick={() => !running && toggleWallet(wallet.id)}
                    disabled={running}
                  >
                    <Checkbox checked={selected} readOnly />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[13px] font-semibold" style={{ color: "var(--text-1)" }}>{wallet.name}</p>
                        <Badge tone={wallet.network === "ETHEREUM" ? "blue" : "slate"}>{wallet.network}</Badge>
                      </div>
                      <p className="mt-1 font-mono text-[11px]" style={{ color: "var(--text-3)" }}>{wallet.address}</p>
                    </div>
                    <Badge tone={status === "submitted" ? "green" : status === "failed" ? "red" : status === "submitting" ? "yellow" : status === "queued" ? "blue" : "slate"}>
                      {status}
                    </Badge>
                  </button>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
