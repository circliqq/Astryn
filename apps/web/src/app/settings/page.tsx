"use client";

import { useEffect, useState } from "react";
import { Save, Settings2, Shield } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Input, Panel, Select } from "@/components/ui";
import {
  DEFAULT_APP_SETTINGS,
  readAppSettings,
  writeAppSettings,
  type AppSettings,
  type ThemeMode,
} from "@/lib/app-settings";

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSettings(readAppSettings());
  }, []);

  function updateSection<K extends keyof AppSettings>(section: K, value: Partial<AppSettings[K]>) {
    setSettings((current) => ({
      ...current,
      [section]: { ...current[section], ...value },
    }));
    setSaved(false);
  }

  function handleSave() {
    writeAppSettings(settings);
    setSaved(true);
  }

  return (
    <AppShell title="Settings">
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="metric-card"><p className="label-caps">Theme</p><p className="metric-value text-[20px] capitalize">{settings.appearance.themeMode}</p></div>
          <div className="metric-card"><p className="label-caps">Privacy</p><p className="metric-value">{settings.privacy.hideWalletAddresses ? "On" : "Off"}</p></div>
          <div className="metric-card"><p className="label-caps">Digest</p><p className="metric-value">{settings.notifications.weeklyDigest ? "On" : "Off"}</p></div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <div className="space-y-5">
            <Panel>
              <div className="panel-header">
                <div>
                  <p className="text-[14px] font-semibold text-graphite-100">Profile</p>
                  <p className="mt-0.5 text-[12px] text-graphite-500">Local console identity and display preferences.</p>
                </div>
                <Settings2 size={17} className="text-graphite-500" />
              </div>
              <div className="grid gap-4 p-5 md:grid-cols-2">
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-graphite-400">Display name</span>
                  <Input value={settings.profile.displayName} onChange={(event) => updateSection("profile", { displayName: event.target.value })} />
                </label>
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-graphite-400">Theme</span>
                  <Select value={settings.appearance.themeMode} onChange={(event) => updateSection("appearance", { themeMode: event.target.value as ThemeMode })}>
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                    <option value="system">System</option>
                  </Select>
                </label>
                <ToggleRow
                  label="Compact mode"
                  detail="Use tighter spacing for dense monitoring."
                  checked={settings.appearance.compactMode}
                  onChange={(checked) => updateSection("appearance", { compactMode: checked })}
                />
              </div>
            </Panel>

            <Panel>
              <div className="panel-header">
                <div>
                  <p className="text-[14px] font-semibold text-graphite-100">Notification Defaults</p>
                  <p className="mt-0.5 text-[12px] text-graphite-500">Local preferences for console-level alert surfaces.</p>
                </div>
                <Badge tone="neutral">Local</Badge>
              </div>
              <div className="grid gap-3 p-5 md:grid-cols-2">
                <ToggleRow label="Mint status" detail="Surface task state changes." checked={settings.notifications.mintStatus} onChange={(checked) => updateSection("notifications", { mintStatus: checked })} />
                <ToggleRow label="Gas alerts" detail="Warn when gas moves beyond normal bands." checked={settings.notifications.gasAlerts} onChange={(checked) => updateSection("notifications", { gasAlerts: checked })} />
                <ToggleRow label="Security alerts" detail="Flag wallet and signing risks." checked={settings.notifications.securityAlerts} onChange={(checked) => updateSection("notifications", { securityAlerts: checked })} />
                <ToggleRow label="Weekly digest" detail="Summarize portfolio and mint activity." checked={settings.notifications.weeklyDigest} onChange={(checked) => updateSection("notifications", { weeklyDigest: checked })} />
              </div>
            </Panel>
          </div>

          <div className="space-y-5">
            <Panel>
              <div className="panel-header">
                <div>
                  <p className="text-[14px] font-semibold text-graphite-100">Auto-Consolidation</p>
                  <p className="mt-0.5 text-[12px] text-graphite-500">Default sweep behavior for newly minted NFTs.</p>
                </div>
              </div>
              <div className="space-y-4 p-5">
                <ToggleRow label="Enable by default" detail="Prefer cold-wallet sweeps after mints." checked={settings.autoConsolidation.enabled} onChange={(checked) => updateSection("autoConsolidation", { enabled: checked })} />
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-graphite-400">Cold wallet address</span>
                  <Input value={settings.autoConsolidation.coldWalletAddress} onChange={(event) => updateSection("autoConsolidation", { coldWalletAddress: event.target.value })} placeholder="0x..." />
                </label>
                <ToggleRow label="Only after confirmed mint" detail="Wait for transaction confirmation." checked={settings.autoConsolidation.onlyAfterConfirmedMint} onChange={(checked) => updateSection("autoConsolidation", { onlyAfterConfirmedMint: checked })} />
              </div>
            </Panel>

            <Panel>
              <div className="panel-header">
                <div>
                  <p className="text-[14px] font-semibold text-graphite-100">Privacy</p>
                  <p className="mt-0.5 text-[12px] text-graphite-500">Reduce sensitive details on shared screens.</p>
                </div>
                <Shield size={17} className="text-graphite-500" />
              </div>
              <div className="space-y-3 p-5">
                <ToggleRow label="Hide wallet addresses" detail="Mask full addresses by default." checked={settings.privacy.hideWalletAddresses} onChange={(checked) => updateSection("privacy", { hideWalletAddresses: checked })} />
                <ToggleRow label="Blur balances" detail="Conceal wallet and portfolio balances." checked={settings.privacy.blurBalances} onChange={(checked) => updateSection("privacy", { blurBalances: checked })} />
                <ToggleRow label="Opt out analytics" detail="Disable local analytics preferences." checked={settings.privacy.analyticsOptOut} onChange={(checked) => updateSection("privacy", { analyticsOptOut: checked })} />
              </div>
            </Panel>

            <div className="flex justify-end">
              <Button type="button" onClick={handleSave}><Save size={14} /> {saved ? "Saved" : "Save Settings"}</Button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function ToggleRow({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-md border border-graphite-700 bg-graphite-800 px-3 py-3">
      <span>
        <span className="block text-[13px] font-medium text-graphite-100">{label}</span>
        <span className="block text-[12px] text-graphite-500">{detail}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}
