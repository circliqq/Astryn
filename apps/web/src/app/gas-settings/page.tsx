"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Fuel, RotateCcw, Save } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Input, Panel, Select } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import {
  GAS_PRESETS,
  buildGasRecommendation,
  gweiFromWei,
  loadSavedGasSettings,
  saveGasSettings,
  type GasMode,
  type GasQuote,
  type GasSettings,
} from "@/lib/gas-settings";

interface Wallet {
  id: string;
  name: string;
  network: "BASE" | "ETHEREUM" | "ROBINHOOD";
}

const MODE_TONE: Record<GasMode, "green" | "blue" | "yellow"> = {
  safe: "green",
  balanced: "blue",
  aggressive: "yellow",
};

export default function GasSettingsPage() {
  const [settings, setSettings] = useState<GasSettings>(GAS_PRESETS.balanced);
  const [network, setNetwork] = useState<"base" | "ethereum" | "robinhood">("base");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSettings(loadSavedGasSettings());
  }, []);

  const { data: gas } = useQuery<GasQuote>({
    queryKey: ["gas-current", network],
    queryFn: () => apiFetch<GasQuote>(`/gas/current?network=${network}`),
    refetchInterval: 15_000,
  });

  const { data: wallets = [] } = useQuery<Wallet[]>({
    queryKey: ["wallets"],
    queryFn: () => apiFetch<Wallet[]>("/wallets"),
  });

  const recommendation = useMemo(() => {
    if (!gas) return null;
    return buildGasRecommendation({
      gas,
      network,
      mode: settings.mode,
      estimatedGasUnits: 350_000,
      walletCount: Math.max(1, wallets.length),
    });
  }, [gas, network, settings.mode, wallets.length]);

  const baseGwei = gweiFromWei(gas?.baseFeePerGas);
  const priorityGwei = gweiFromWei(gas?.maxPriorityFeePerGas);
  const maxGwei = gweiFromWei(gas?.maxFeePerGas);

  function applyPreset(mode: GasMode) {
    setSettings(GAS_PRESETS[mode]);
    setSaved(false);
  }

  function updateNumber(key: keyof Pick<GasSettings, "maxFeeGwei" | "priorityFeeGwei" | "maxTotalGasCostEth" | "maxBumpAttempts">, value: string) {
    setSettings((current) => ({ ...current, [key]: Number(value) }));
    setSaved(false);
  }

  function handleSave() {
    saveGasSettings(settings);
    setSaved(true);
  }

  return (
    <AppShell title="Gas Settings">
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-4">
          <div className="metric-card">
            <p className="label-caps">Mode</p>
            <div className="mt-3 flex items-center justify-between">
              <p className="text-[18px] font-semibold capitalize" style={{ color: "var(--text-1)" }}>{settings.mode}</p>
              <Badge tone={MODE_TONE[settings.mode]}>{settings.mode}</Badge>
            </div>
          </div>
          <div className="metric-card"><p className="label-caps">Base fee</p><p className="metric-value">{baseGwei != null ? baseGwei.toFixed(2) : "-"}</p></div>
          <div className="metric-card"><p className="label-caps">Priority</p><p className="metric-value">{priorityGwei != null ? priorityGwei.toFixed(3) : "-"}</p></div>
          <div className="metric-card"><p className="label-caps">Max fee</p><p className="metric-value">{maxGwei != null ? maxGwei.toFixed(2) : "-"}</p></div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <Panel>
            <div className="panel-header">
              <div>
                <p className="text-[14px] font-semibold" style={{ color: "var(--text-1)" }}>Execution Gas Profile</p>
                <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-3)" }}>Flat, explicit controls for mint and wallet execution.</p>
              </div>
              <Fuel size={18} style={{ color: "var(--text-3)" }} />
            </div>
            <div className="space-y-5 p-5">
              <div className="segmented-control">
                {(["safe", "balanced", "aggressive"] as GasMode[]).map((mode) => (
                  <button key={mode} type="button" data-active={settings.mode === mode} onClick={() => applyPreset(mode)}>
                    {mode[0].toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label>
                  <span className="mb-1 block text-[11px] font-medium" style={{ color: "var(--text-3)" }}>Max fee (gwei)</span>
                  <Input type="number" min="0" value={settings.maxFeeGwei} onChange={(event) => updateNumber("maxFeeGwei", event.target.value)} />
                </label>
                <label>
                  <span className="mb-1 block text-[11px] font-medium" style={{ color: "var(--text-3)" }}>Priority fee (gwei)</span>
                  <Input type="number" min="0" value={settings.priorityFeeGwei} onChange={(event) => updateNumber("priorityFeeGwei", event.target.value)} />
                </label>
                <label>
                  <span className="mb-1 block text-[11px] font-medium" style={{ color: "var(--text-3)" }}>Gas cap per wallet (ETH)</span>
                  <Input type="number" min="0" step="any" value={settings.maxTotalGasCostEth} onChange={(event) => updateNumber("maxTotalGasCostEth", event.target.value)} />
                </label>
                <label>
                  <span className="mb-1 block text-[11px] font-medium" style={{ color: "var(--text-3)" }}>Max bump attempts</span>
                  <Input type="number" min="1" value={settings.maxBumpAttempts} onChange={(event) => updateNumber("maxBumpAttempts", event.target.value)} />
                </label>
              </div>

              <label
                className="flex items-center justify-between rounded-md px-3 py-3"
                style={{ border: "1px solid var(--border)", background: "var(--surface-2)" }}
              >
                <span>
                  <span className="block text-[13px] font-medium" style={{ color: "var(--text-1)" }}>Gas bump</span>
                  <span className="block text-[12px]" style={{ color: "var(--text-3)" }}>Raise fees when transactions stall.</span>
                </span>
                <input
                  type="checkbox"
                  checked={settings.gasBumpEnabled}
                  onChange={(event) => setSettings((current) => ({ ...current, gasBumpEnabled: event.target.checked }))}
                />
              </label>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button type="button" variant="secondary" onClick={() => applyPreset("balanced")}><RotateCcw size={14} /> Reset</Button>
                <Button type="button" onClick={handleSave}><Save size={14} /> {saved ? "Saved" : "Save Settings"}</Button>
              </div>
            </div>
          </Panel>

          <div className="space-y-5">
            <Panel>
              <div className="panel-header">
                <p className="text-[14px] font-semibold" style={{ color: "var(--text-1)" }}>Live Network</p>
              </div>
              <div className="space-y-4 p-5">
                <label>
                  <span className="mb-1 block text-[11px] font-medium" style={{ color: "var(--text-3)" }}>Network</span>
                  <Select value={network} onChange={(event) => setNetwork(event.target.value as "base" | "ethereum" | "robinhood")}>
                    <option value="base">Base</option>
                    <option value="ethereum">Ethereum</option>
                    <option value="robinhood">Robinhood</option>
                  </Select>
                </label>
                <div className="notice text-[12px]">
                  {recommendation ? recommendation.detail : "Waiting for live gas data."}
                </div>
              </div>
            </Panel>

            <Panel>
              <div className="panel-header">
                <p className="text-[14px] font-semibold" style={{ color: "var(--text-1)" }}>Cost Estimate</p>
              </div>
              <div className="space-y-3 p-5 text-[13px]">
                <div className="flex justify-between"><span style={{ color: "var(--text-3)" }}>Estimated gas</span><span>{recommendation ? recommendation.estimatedGasCostEth.toFixed(6) : "-"} ETH</span></div>
                <div className="flex justify-between"><span style={{ color: "var(--text-3)" }}>Max per wallet</span><span>{settings.maxTotalGasCostEth} ETH</span></div>
                <div className="flex justify-between"><span style={{ color: "var(--text-3)" }}>Wallet count</span><span>{wallets.length}</span></div>
                <div className="pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                  <div className="flex justify-between font-semibold" style={{ color: "var(--text-1)" }}>
                    <span>Total estimate</span>
                    <span>{recommendation ? recommendation.totalGasCostEth.toFixed(6) : "-"} ETH</span>
                  </div>
                </div>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
