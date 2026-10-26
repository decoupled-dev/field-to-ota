import { cn } from "@/lib/utils";

type Tone = "neutral" | "accent" | "ok" | "run" | "warn" | "bad" | "outline";
const tones: Record<Tone, string> = {
  neutral: "bg-subtle text-muted border-border",
  outline: "bg-transparent text-muted border-border",
  accent: "bg-accent/10 text-accent border-accent/20",
  ok: "bg-ok/10 text-ok border-ok/20",
  run: "bg-run/10 text-run border-run/20",
  warn: "bg-warn/10 text-warn border-warn/25",
  bad: "bg-bad/10 text-bad border-bad/20",
};

export function Badge({ tone = "neutral", className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded border px-1.5 text-xs font-medium", tones[tone], className)}
      {...p}
    />
  );
}
