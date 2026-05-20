"use client";
import { cn } from "@/lib/utils";

// ── Button ─────────────────────────────────────────────────────────────────

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
        "focus-ring inline-flex items-center justify-center gap-1.5 font-medium rounded-[7px] transition-colors select-none",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        size === "md" && "h-8 px-3.5 text-[13px]",
        size === "sm" && "h-6 px-2.5 text-[11px]",
        variant === "primary" && [
          "bg-brand text-white border border-brand",
          "hover:bg-brand-hover hover:border-brand-hover",
        ],
        variant === "secondary" && [
          "border border-graphite-700 bg-transparent text-graphite-100",
          "hover:bg-graphite-800",
        ],
        variant === "ghost" && [
          "border border-transparent bg-transparent text-graphite-400",
          "hover:bg-graphite-800 hover:text-graphite-100",
        ],
        variant === "danger" && [
          "border border-status-red-border/60 bg-transparent text-status-red-text",
          "hover:bg-status-red-bg",
        ],
        className
      )}
      {...props}
    />
  );
}

// ── Panel ──────────────────────────────────────────────────────────────────

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("panel", className)} {...props} />;
}

// ── Badge ──────────────────────────────────────────────────────────────────

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
        tone === "green"   && "bg-status-green-bg text-status-green-text",
        tone === "blue"    && "bg-status-blue-bg text-status-blue-text",
        tone === "yellow"  && "bg-status-yellow-bg text-status-yellow-text",
        tone === "red"     && "bg-status-red-bg text-status-red-text",
        tone === "neutral" && "bg-status-neutral-bg text-status-neutral-text",
        tone === "slate"   && "bg-graphite-800 text-graphite-400",
        className
      )}
      {...props}
    />
  );
}

// ── Input ──────────────────────────────────────────────────────────────────

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-8 w-full rounded-[7px] border border-graphite-700 bg-graphite-800",
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

// ── Select ─────────────────────────────────────────────────────────────────

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-8 rounded-[7px] border border-graphite-700 bg-graphite-800",
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

// ── Textarea ───────────────────────────────────────────────────────────────

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-[7px] border border-graphite-700 bg-graphite-800",
        "px-3 py-2 text-[13px] text-graphite-100 placeholder:text-graphite-500",
        "transition-colors",
        "focus:border-brand focus:outline-none focus:shadow-focus-brand",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "resize-vertical min-h-[100px]",
        className
      )}
      {...props}
    />
  );
}

// ── Divider ────────────────────────────────────────────────────────────────

export function Divider({ className }: { className?: string }) {
  return (
    <hr
      className={cn("divider", className)}
    />
  );
}

// ── Checkbox ───────────────────────────────────────────────────────────────

export function Checkbox({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={cn(
        "h-4 w-4 rounded-[4px] border border-graphite-600 bg-graphite-800",
        "accent-brand cursor-pointer",
        "focus:outline-none focus:shadow-focus-brand",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}
