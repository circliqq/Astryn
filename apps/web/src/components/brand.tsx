export function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span
        className="grid size-7 shrink-0 place-items-center rounded-[6px] text-[13px] font-bold leading-none text-white"
        style={{ background: "var(--brand)" }}
      >
        A
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
