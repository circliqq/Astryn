import { Flame } from "lucide-react";

export function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span
        className="grid size-7 shrink-0 place-items-center rounded-[6px] leading-none text-white"
        style={{ background: "var(--brand)" }}
      >
        <Flame size={13} strokeWidth={2.2} />
      </span>
      <span
        className="text-[14px] font-semibold tracking-tight"
        style={{ color: "var(--text-1)" }}
      >
        Astryn
      </span>
    </div>
  );
}
