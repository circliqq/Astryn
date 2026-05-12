"use client";

import { useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import { Badge, Button, Input, Panel, Select } from "@/components/ui";
import { GAS_PRESETS, type GasMode, type GasSettings } from "@/lib/gas-settings";

interface WalletGasOverrideProps {
  walletId: string;
  walletName: string;
  walletAddress: string;
  value?: GasSettings | null;
  onSave?: (walletId: string, settings: GasSettings) => void;
  onReset?: (walletId: string) => void;
}

const MODE_TONE: Record<GasMode, "green" | "blue" | "yellow"> = {
  safe: "green",
  balanced: "blue",
  aggressive: "yellow",
};

export function WalletGasOverride({
  walletId,
  walletName,
  walletAddress,
  value,
  onSave,
  onReset,
}: WalletGasOverrideProps) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<GasSettings>(value ?? GAS_PRESETS.balanced);
  const hasOverride = Boolean(value);

  function updateMode(mode: GasMode) {
    setSettings(GAS_PRESETS[mode]);
  }

  function updateNumber(key: keyof Pick<GasSettings, "maxFeeGwei" | "priorityFeeGwei" | "maxTotalGasCostEth" | "maxBumpAttempts">, raw: string) {
    setSettings((current) => ({ ...current, [key]: Number(raw) }));
  }

  return (
    <Panel className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-[13px] font-semibold text-graphite-100">{walletName}</p>
            <Badge tone={hasOverride ? MODE_TONE[settings.mode] : "slate"}>{hasOverride ? settings.mode : "Inherited"}</Badge>
          </div>
          <p className="mt-1 truncate font-mono text-[11px] text-graphite-500">{walletAddress}</p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen((current) => !current)}>
          {open ? "Close" : "Override"}
        </Button>
      </div>

      {open && (
        <div className="mt-4 grid gap-3 border-t border-graphite-700 pt-4 md:grid-cols-2">
          <label>
            <span className="mb-1 block text-[11px] font-medium text-graphite-400">Mode</span>
            <Select value={settings.mode} onChange={(event) => updateMode(event.target.value as GasMode)}>
              <option value="safe">Safe</option>
              <option value="balanced">Balanced</option>
              <option value="aggressive">Aggressive</option>
            </Select>
          </label>
          <label>
            <span className="mb-1 block text-[11px] font-medium text-graphite-400">Max fee</span>
            <Input type="number" value={settings.maxFeeGwei} onChange={(event) => updateNumber("maxFeeGwei", event.target.value)} />
          </label>
          <label>
            <span className="mb-1 block text-[11px] font-medium text-graphite-400">Priority fee</span>
            <Input type="number" value={settings.priorityFeeGwei} onChange={(event) => updateNumber("priorityFeeGwei", event.target.value)} />
          </label>
          <label>
            <span className="mb-1 block text-[11px] font-medium text-graphite-400">Gas cap ETH</span>
            <Input type="number" value={settings.maxTotalGasCostEth} onChange={(event) => updateNumber("maxTotalGasCostEth", event.target.value)} />
          </label>
          <div className="flex items-center gap-2 md:col-span-2">
            <Button type="button" size="sm" onClick={() => onSave?.(walletId, settings)}><Save size={13} /> Save</Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => onReset?.(walletId)}><RotateCcw size={13} /> Reset</Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
