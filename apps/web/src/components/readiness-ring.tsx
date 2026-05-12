"use client";

import { cn } from "@/lib/utils";

interface ReadinessRingProps {
  score?: number;
  size?: number;
  onClick?: () => void;
}

export function ReadinessRing({ score = 0, size = 176, onClick }: ReadinessRingProps) {
  const r = 48;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const arcColor = score >= 80 ? "#3FB950" : score >= 50 ? "#D29922" : "#F85149";

  return (
    <div
      className={cn("relative grid place-items-center", onClick && "cursor-pointer")}
      style={{ width: size, height: size }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={`Readiness ${score}%${onClick ? ". Click to inspect." : ""}`}
      onKeyDown={onClick ? (event) => { if (event.key === "Enter" || event.key === " ") onClick(); } : undefined}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 120 120"
        className={cn(onClick && "transition-opacity hover:opacity-75")}
      >
        <circle cx="60" cy="60" r={r} fill="none" stroke="#1E2028" strokeWidth="7" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={arcColor}
          strokeLinecap="round"
          strokeWidth="7"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform="rotate(-90 60 60)"
          style={{ transition: "stroke-dashoffset 0.5s ease, stroke 0.3s ease" }}
        />
      </svg>

      <div className="absolute text-center">
        <div className="text-[32px] font-semibold tabular-nums leading-none text-graphite-100">
          {score}
        </div>
        <div className="mt-1 text-[12px] text-graphite-500">
          readiness
        </div>
      </div>

      {onClick && (
        <div className="absolute bottom-3 select-none text-[10px] text-graphite-500">
          inspect -&gt;
        </div>
      )}
    </div>
  );
}
