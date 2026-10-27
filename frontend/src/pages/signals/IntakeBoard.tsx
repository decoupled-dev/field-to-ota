import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowDownToLine, Bot, Clock, FlaskConical, FolderPlus, Inbox, Layers, Loader2, MinusCircle, Radio, ScanSearch, Sparkles, Timer, Wifi, type LucideIcon } from "lucide-react";
import { api, type F2FEvent, type Intake, type IntakeActivity, type IntakeSource, type Signal } from "@/lib/api";
import { useApp } from "@/lib/context";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/states";
import { SOURCE_META } from "@/components/domain";
import { cn, timeAgo } from "@/lib/utils";

// A check takes milliseconds; keep it visible long enough to read.
const CHECK_VISIBLE_MS = 1600;

/** Live intake state: snapshot on mount, then patched from the event stream. */
export function useIntake() {
  const [data, setData] = useState<Intake>();
  const [error, setError] = useState<Error>();
  const [checkingUntil, setCheckingUntil] = useState<Record<string, number>>({});

  const load = useCallback(() => api.intake().then((d) => { setData(d); setError(undefined); }, setError), []);
  useEffect(() => { load(); }, [load]);

  const onEvent = useCallback((e: F2FEvent) => {
    if (e.type === "demo.reset") return void load();
    if (e.type === "intake.source") {
      const s = e.data.source as IntakeSource;
      if (s.status === "checking") setCheckingUntil((m) => ({ ...m, [s.source]: Date.now() + CHECK_VISIBLE_MS }));
      setData((d) => d && { ...d, sources: d.sources.map((x) => (x.source === s.source ? { ...x, ...s } : x)) });
    } else if (e.type === "intake.activity") {
      const a = e.data.entry as IntakeActivity;
      setData((d) => d && { ...d, activity: [a, ...d.activity.filter((x) => x.id !== a.id)].slice(0, 80) });
    } else if (e.type === "signal.created") {
      const sig = e.data.signal as Signal;
      setData((d) => d && {
        ...d,
        sources: d.sources.map((x) =>
          x.source === sig.source ? { ...x, total: (x.total ?? 0) + 1, last_24h: (x.last_24h ?? 0) + 1, last_signal_at: sig.created_at } : x,
        ),
      });
    }
  }, [load]);

  return { data, error, checkingUntil, onEvent, reload: load };
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const MODE: Record<IntakeSource["mode"], { label: string; tone: "ok" | "neutral" | "info"; icon: LucideIcon }> = {
  live: { label: "Live", tone: "ok", icon: Wifi },
  simulated: { label: "Simulated", tone: "neutral", icon: FlaskConical },
  push: { label: "Push", tone: "info", icon: ArrowDownToLine },
};

/** One card per intake channel. Clicking a card filters the signal list. */
export function SourceBoard({ sources, checkingUntil, selected, onSelect }: {
  sources?: IntakeSource[];
  checkingUntil: Record<string, number>;
  selected: string;
  onSelect: (s: string) => void;
}) {
  const now = useNow();
  if (!sources) return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-[148px]" />)}</div>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      {sources.map((s) => (
        <SourceCard key={s.source} s={s} now={now} checking={s.status === "checking" || (checkingUntil[s.source] ?? 0) > now} selected={selected === s.source} onClick={() => onSelect(selected === s.source ? "" : s.source)} />
      ))}
    </div>
  );
}

function SourceCard({ s, now, checking, selected, onClick }: { s: IntakeSource; now: number; checking: boolean; selected: boolean; onClick: () => void }) {
  const meta = SOURCE_META[s.source];
  const Icon = meta?.icon ?? Radio;
  const ModeIcon = MODE[s.mode].icon;
  const color = meta?.color ?? "#888";
  const nextIn = s.next_check ? Math.max(0, Math.ceil(s.next_check - now / 1000)) : null;
  const progress = s.interval && nextIn != null ? 1 - nextIn / s.interval : 0;
  const recent = s.last_signal_at != null && now / 1000 - s.last_signal_at < 60;

  let status: React.ReactNode;
  if (s.status === "error") status = <span className="flex items-center gap-1.5 text-bad"><AlertTriangle size={12} />Check failed</span>;
  else if (checking) status = <span className="flex items-center gap-1.5 text-accent"><ScanSearch size={12} className="animate-pulseSoft" />Checking now…<Loader2 size={11} className="animate-spin" /></span>;
  else if (s.kind === "push")
    status = (
      <span className="flex items-center gap-1.5 text-info">
        <Radio size={12} className="animate-pulseSoft" />
        Listening for uploads
      </span>
    );
  else status = <span className="tnum flex items-center gap-1.5 text-muted"><Timer size={12} className="text-ok" />{nextIn != null ? `Next check in ${fmtSecs(nextIn)}` : "Waiting for first check"}</span>;

  return (
    <button
      type="button"
      onClick={onClick}
      title={s.error ?? s.target}
      className={cn(
        "panel relative flex flex-col overflow-hidden p-4 text-left transition-[box-shadow,border-color] hover:border-strong",
        selected && "border-accent ring-2 ring-accent/30",
        checking && "border-accent/50",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md" style={{ background: `${color}1f`, color }}>
          <Icon size={18} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold">{s.label}</span>
            <Badge tone={MODE[s.mode].tone}><ModeIcon size={11} strokeWidth={2.5} />{MODE[s.mode].label}</Badge>
          </div>
          <div className="mt-0.5 truncate text-xs text-faint">{s.target}</div>
        </div>
      </div>
      <div className="mt-4 flex items-end justify-between gap-2">
        <div>
          <div className="tnum flex items-center gap-1.5 text-2xl font-semibold leading-7"><Inbox size={16} className="text-faint" />{s.total ?? 0}</div>
          <div className="tnum mt-0.5 text-xs text-faint">{s.last_24h ?? 0} in 24h</div>
        </div>
        <div className={cn("flex items-center gap-1 text-xs", recent ? "font-medium text-accent" : "text-faint")} title="Last report">
          <Clock size={12} />
          {s.last_signal_at ? timeAgo(s.last_signal_at) : "No reports yet"}
        </div>
      </div>
      <div className="mt-3 border-t border-border pt-2.5 text-xs">{status}</div>
      {s.kind === "poll" && (
        <span className="absolute inset-x-0 bottom-0 h-[3px] bg-subtle">
          <span className={cn("block h-full transition-[width] duration-1000 ease-linear", checking ? "w-full animate-pulseSoft bg-accent" : "bg-accent/40")} style={checking ? undefined : { width: `${Math.round(progress * 100)}%` }} />
        </span>
      )}
    </button>
  );
}

function fmtSecs(s: number) {
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

const KIND: Record<IntakeActivity["kind"], { icon: LucideIcon; cls: string; label: string }> = {
  check: { icon: ScanSearch, cls: "bg-subtle text-faint", label: "Checked" },
  found: { icon: Inbox, cls: "bg-accent/10 text-accent", label: "New report" },
  triage: { icon: Sparkles, cls: "bg-info/10 text-info", label: "Triaged" },
  cluster: { icon: Layers, cls: "bg-info/10 text-info", label: "Clustered" },
  case: { icon: FolderPlus, cls: "bg-ok/15 text-ok", label: "Case opened" },
  skip: { icon: MinusCircle, cls: "bg-subtle text-faint", label: "Not a defect" },
  error: { icon: AlertTriangle, cls: "bg-bad/10 text-bad", label: "Error" },
};

/** The intake agent's running log: checks, finds, triage and clustering decisions as they happen. */
export function AgentFeed({ intake, checkingUntil, live }: { intake?: Intake; checkingUntil: Record<string, number>; live: boolean }) {
  const now = useNow();
  const { health } = useApp();
  const seen = useRef<Set<number> | null>(null);
  const current = intake?.sources.find((s) => s.status === "checking" || (checkingUntil[s.source] ?? 0) > now);
  const polled = intake?.sources.filter((s) => s.kind === "poll").length ?? 0;

  // Rows present on first render don't animate; later arrivals slide in.
  const fresh = useMemo(() => {
    const ids = new Set((intake?.activity ?? []).map((a) => a.id));
    if (!seen.current) {
      seen.current = ids;
      return new Set<number>();
    }
    const out = new Set([...ids].filter((id) => !seen.current!.has(id)));
    out.forEach((id) => seen.current!.add(id));
    return out;
  }, [intake?.activity]);

  return (
    <Card className="flex h-fit flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Bot size={16} />
            {live && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-ok" />}
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold leading-5">Intake agent</div>
            <div className="truncate text-xs text-faint">
              {current ? <span className="text-accent">Checking {current.label}…</span> : `Watching ${polled} feeds and the device channel`}
              {health && <> · triage by {health.llm === "bedrock" ? "Bedrock" : "rules"}</>}
            </div>
          </div>
        </div>
        <Badge tone={live ? "ok" : "warn"}>{live ? "Live" : "Polling"}</Badge>
      </div>
      {!intake ? (
        <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : !intake.activity.length ? (
        <div className="px-4 py-10 text-center text-sm text-faint">Waiting for the first sweep…</div>
      ) : (
        <ol className="max-h-[460px] overflow-y-auto py-2">
          {intake.activity.map((a) => {
            const k = KIND[a.kind] ?? KIND.check;
            const meta = a.source ? SOURCE_META[a.source] : undefined;
            return (
              <li key={a.id} className={cn("relative flex gap-3 px-4 py-2 before:absolute before:bottom-0 before:left-[27px] before:top-0 before:w-px before:bg-border first:before:top-4 last:before:bottom-auto last:before:h-4", fresh.has(a.id) && "animate-enter")}>
                <span title={k.label} className={cn("relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-4 ring-surface", k.cls)}>
                  <k.icon size={13} strokeWidth={2.25} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className={cn("pt-0.5 text-[13px] leading-5", a.kind === "check" || a.kind === "skip" ? "text-muted" : "text-fg")}>
                    {a.case_id ? <>{a.text.split(a.case_id)[0]}<Link to={`/cases/${a.case_id}`} className="text-accent hover:underline">{a.case_id}</Link>{a.text.split(a.case_id).slice(1).join(a.case_id)}</> : a.text}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-faint">
                    {meta && <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />{meta.label}</span>}
                    <span className="tnum inline-flex items-center gap-1"><Clock size={10} />{timeAgo(a.ts)}</span>
                    {a.count > 1 && <span className="tnum">· {a.count} checks</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
