import { Badge } from "./ui";

const STATUS_TONE: Record<string, "green" | "blue" | "yellow" | "red" | "neutral"> = {
  // green — healthy / done
  Ready:     "green",
  Confirmed: "green",
  Completed: "green",
  Success:   "green",
  Healthy:   "green",
  // blue — active / in motion
  Running:   "blue",
  Scheduled: "blue",
  Active:    "blue",
  // yellow — needs attention / degraded
  Canceled:       "yellow",
  Paused:         "yellow",
  "Low Balance":  "yellow",
  "Need Funding": "yellow",
  Pending:        "yellow",
  Waiting:        "yellow",
  Warning:        "yellow",
  // red — error / failed
  Failed:         "red",
  Error:          "red",
  "Nonce Issue":  "red",
  "Not Eligible": "red",
  Degraded:       "red",
  // neutral — unstarted / unknown
  Draft:    "neutral",
  Inactive: "neutral",
};

export function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? "neutral";
  return <Badge tone={tone}>{status}</Badge>;
}
