"use client";

import { AppShell } from "@/components/app-shell";
import { MintAlertsSection } from "@/components/mint-alerts-section";

export default function MintAlertsPage() {
  return (
    <AppShell title="Mint Alerts">
      <MintAlertsSection />
    </AppShell>
  );
}
