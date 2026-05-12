import { cn } from "@/lib/utils";

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
}) {
  return (
    <button
      className={cn(
        "focus-ring inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors select-none",
        "disabled:cursor-not-allowed disabled:opacity-45",
        size === "md" && "h-8 px-3.5 text-[13px]",
        size === "sm" && "h-6 px-2 text-[11px]",
        variant === "primary" && [
          "border border-brand bg-brand text-white",
          "hover:border-brand-dim hover:bg-brand-dim",
        ],
        variant === "secondary" && [
          "border border-graphite-600 bg-transparent text-graphite-100",
          "hover:bg-graphite-800 hover:border-graphite-600",
        ],
        variant === "danger" && [
          "border border-status-red-border/70 bg-transparent text-status-red-text",
          "hover:bg-status-red-bg",
        ],
        variant === "ghost" && [
          "border border-transparent bg-transparent text-graphite-400",
          "hover:bg-graphite-800 hover:text-graphite-100",
        ],
        className
      )}
      {...props}
    />
  );
}

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("panel", className)} {...props} />;
}

export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "green" | "blue" | "yellow" | "red" | "neutral" | "slate";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded font-medium",
        "px-1.5 py-[1px] text-[11px] leading-[16px]",
        tone === "green" && "bg-status-green-bg text-status-green-text",
        tone === "blue" && "bg-status-blue-bg text-status-blue-text",
        tone === "yellow" && "bg-status-yellow-bg text-status-yellow-text",
        tone === "red" && "bg-status-red-bg text-status-red-text",
        tone === "neutral" && "bg-status-neutral-bg text-status-neutral-text",
        tone === "slate" && "bg-graphite-800 text-graphite-400",
        className
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-8 w-full rounded-md border border-graphite-700 bg-graphite-800",
        "px-3 text-[13px] text-graphite-100 placeholder:text-graphite-500",
        "transition-colors",
        "focus:border-brand focus:outline-none focus:shadow-focus-brand",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-8 rounded-md border border-graphite-700 bg-graphite-800",
        "px-3 text-[13px] text-graphite-100",
        "transition-colors",
        "focus:border-brand focus:outline-none focus:shadow-focus-brand",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px bg-graphite-700", className)} />;
}
