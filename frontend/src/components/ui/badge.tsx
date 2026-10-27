import { cn } from "@/lib/utils";

type Tone = "neutral" | "accent" | "ok" | "run" | "warn" | "bad" | "outline" | "info";
const tones: Record<Tone, string> = {
  neutral: "bg-subtle text-muted",
  outline: "bg-transparent text-muted shadow-[inset_0_0_0_1px_hsl(var(--border))]",
  accent: "bg-accent/[0.12] text-accent",
  ok: "bg-ok/[0.14] text-ok",
  run: "bg-run/[0.12] text-run",
  warn: "bg-warn/[0.14] text-warn",
  bad: "bg-bad/[0.12] text-bad",
  info: "bg-info/[0.12] text-info",
};

/** Lozenge: bold, uppercase, tinted. Used for every state in the console. */
export function Badge({ tone = "neutral", className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-sm px-1.5 text-[11px] font-bold uppercase leading-none tracking-[0.02em]",
        tones[tone],
        className,
      )}
      {...p}
    />
  );
}
