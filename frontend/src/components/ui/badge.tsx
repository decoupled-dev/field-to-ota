import { cn } from "@/lib/utils";

type Tone = "neutral" | "accent" | "ok" | "run" | "warn" | "bad" | "outline" | "info";
const tones: Record<Tone, string> = {
  neutral: "bg-subtle text-muted border-border",
  outline: "bg-transparent text-muted border-border",
  accent: "bg-accent/10 text-accent border-accent/30",
  ok: "bg-ok/10 text-ok border-ok/30",
  run: "bg-run/10 text-run border-run/30",
  warn: "bg-warn/10 text-warn border-warn/35",
  bad: "bg-bad/10 text-bad border-bad/30",
  info: "bg-info/10 text-info border-info/30",
};

/** Tag: mono, uppercase, square. Used for every state in the console. */
export function Badge({ tone = "neutral", className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-sm border px-1.5 font-mono text-2xs font-medium uppercase tracking-[0.06em]",
        tones[tone],
        className,
      )}
      {...p}
    />
  );
}
