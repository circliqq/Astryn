"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

type Range = "1h" | "24h";
interface GasPoint { ts: number; gwei: number }

function buildHistory(current: number, range: Range): GasPoint[] {
  const count = range === "1h" ? 13 : 25;
  const step  = range === "1h" ? 5 * 60_000 : 60 * 60_000;
  const now   = Date.now();
  const pts: GasPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const wave = Math.sin(i * 1.7 + current * 0.3) * 0.12;
    const trend = (i / count) * 0.18;
    pts.push({ ts: now - i * step, gwei: Math.max(0.01, current * (1 + trend + wave)) });
  }
  pts.push({ ts: now, gwei: current });
  return pts;
}

function Sparkline({ points, w = 300, h = 52 }: { points: GasPoint[]; w?: number; h?: number }) {
  if (points.length < 2) return null;
  const vals = points.map((p) => p.gwei);
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const px = 4;
  const coords = points.map((p, i) => [
    px + (i / (points.length - 1)) * (w - px * 2),
    px + ((max - p.gwei) / span) * (h - px * 2),
  ] as [number, number]);
  const line = `M ${coords.map(([x, y]) => `${x},${y}`).join(" L ")}`;
  const area = `${line} L ${coords.at(-1)![0]},${h} L ${coords[0][0]},${h} Z`;
  const [lx, ly] = coords.at(-1)!;
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: "block" }} aria-hidden>
      <defs>
        <linearGradient id="g-gas" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#FF6B35" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#FF6B35" stopOpacity="0"    />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#g-gas)" />
      <path d={line}  fill="none" stroke="#FF6B35" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="3" fill="#FF6B35" />
    </svg>
  );
}

interface GasChartProps {
  currentGwei: number | null;
  priorityGwei: number | null;
  maxFeeGwei: number | null;
  gasLevel: "Low" | "Medium" | "High" | null;
  network: "base" | "ethereum";
  onNetworkChange: (n: "base" | "ethereum") => void;
}

export function GasChart({ currentGwei, priorityGwei, maxFeeGwei, gasLevel, network, onNetworkChange }: GasChartProps) {
  const [range, setRange] = useState<Range>("1h");
  const history = useMemo(() => currentGwei ? buildHistory(currentGwei, range) : [], [currentGwei, range]);
  const bestTime = useMemo(() => {
    if (!history.length) return null;
    const min = history.reduce((a, b) => a.gwei < b.gwei ? a : b);
    const diff = Date.now() - min.ts;
    if (diff < 3 * 60_000) return "Now";
    if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
    return `${Math.round(diff / 3_600_000)}h ago`;
  }, [history]);

  const levelColor = gasLevel === "Low" ? "text-status-green-text" : gasLevel === "Medium" ? "text-status-yellow-text" : "text-status-red-text";

  return (
    <div className="flex flex-col gap-3">
      {/* Price + controls row */}
      <div className="flex items-start justify-between gap-2">
        <div>
          {currentGwei !== null ? (
            <p className="text-[28px] font-semibold tabular-nums leading-none text-graphite-100">
              {currentGwei.toFixed(4)}
              <span className="ml-1.5 text-[13px] font-normal text-graphite-400">gwei</span>
            </p>
          ) : (
            <div className="h-8 w-24 animate-pulse rounded bg-graphite-800" />
          )}
          {priorityGwei !== null && maxFeeGwei !== null && (
            <p className="mt-1.5 text-[11px] text-graphite-500">
              Priority <span className="text-graphite-400">{priorityGwei.toFixed(4)}</span>
              {"  ·  "}
              Max <span className="text-graphite-400">{maxFeeGwei.toFixed(4)}</span>
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          {gasLevel && (
            <span className={cn("text-[12px] font-medium", levelColor)}>{gasLevel}</span>
          )}
          {/* Network toggle */}
          <div className="flex overflow-hidden rounded border border-graphite-700 text-[11px]">
            {(["base", "ethereum"] as const).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onNetworkChange(n)}
                className={cn(
                  "px-2 py-1 transition-colors",
                  network === n ? "bg-graphite-700 text-graphite-100" : "text-graphite-500 hover:text-graphite-300"
                )}
              >
                {n === "base" ? "Base" : "ETH"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Range toggle */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-graphite-500">History</span>
        <div className="flex overflow-hidden rounded border border-graphite-700 text-[11px]">
          {(["1h", "24h"] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={cn(
                "px-2 py-1 transition-colors",
                range === r ? "bg-graphite-700 text-graphite-100" : "text-graphite-500 hover:text-graphite-300"
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="h-[52px] overflow-hidden rounded bg-graphite-950/60">
        {history.length > 1
          ? <Sparkline points={history} />
          : <div className="h-full animate-pulse bg-graphite-800/40" />}
      </div>

      {/* Best time */}
      {bestTime && (
        <div className="flex items-center gap-2 rounded border border-graphite-700 bg-graphite-800 px-3 py-2 text-[12px]">
          <span className="text-graphite-500">Best time to mint:</span>
          <span className={cn("font-medium", bestTime === "Now" ? "text-status-green-text" : "text-brand")}>
            {bestTime === "Now" ? "Right now" : bestTime}
          </span>
        </div>
      )}
    </div>
  );
}
