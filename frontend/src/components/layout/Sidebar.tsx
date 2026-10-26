import { NavLink } from "react-router-dom";
import { Activity, ExternalLink, FileText, FolderKanban, LayoutDashboard, Plug, Radar } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApp } from "@/lib/context";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/signals", label: "Signals", icon: Radar },
  { to: "/cases", label: "Cases", icon: FolderKanban },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/integrations", label: "Integrations", icon: Plug },
];

export function Wordmark() {
  return (
    <div className="flex items-center gap-2">
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
        <rect width="22" height="22" rx="5" className="fill-accent" />
        <path d="M5.5 6l5.5 10 5.5-10" stroke="white" strokeWidth="2" fill="none" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx="16.5" cy="6" r="1.6" fill="white" />
      </svg>
      <div className="leading-none">
        <div className="text-sm font-semibold tracking-tight">Field-to-Fix</div>
        <div className="mt-0.5 text-[11px] text-muted">Field signal → verified OTA</div>
      </div>
    </div>
  );
}

export function Sidebar() {
  const { health, healthError } = useApp();
  return (
    <aside className="flex w-[232px] shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-14 items-center border-b border-border px-4">
        <Wordmark />
      </div>
      <nav className="flex-1 space-y-0.5 p-2">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              cn(
                "flex h-8 items-center gap-2.5 rounded px-2.5 text-sm font-medium transition-colors",
                isActive ? "bg-subtle text-fg" : "text-muted hover:bg-subtle/70 hover:text-fg",
              )
            }
          >
            <n.icon size={16} strokeWidth={1.75} />
            {n.label}
          </NavLink>
        ))}
        <div className="px-2.5 pb-1 pt-5 text-[11px] font-medium uppercase tracking-wider text-muted">Demo</div>
        <a
          href="/forum"
          target="_blank"
          rel="noreferrer"
          className="flex h-8 items-center gap-2.5 rounded px-2.5 text-sm font-medium text-muted hover:bg-subtle/70 hover:text-fg"
        >
          <Activity size={16} strokeWidth={1.75} />
          Owners forum
          <ExternalLink size={12} className="ml-auto" />
        </a>
      </nav>
      <div className="space-y-2 border-t border-border p-3 text-xs">
        <EnvRow label="Environment" value={health?.mode} ok={!!health} error={!!healthError} />
        <EnvRow label="Reasoning" value={health ? (health.llm === "bedrock" ? "Amazon Bedrock" : "Offline rules") : undefined} ok={health?.llm === "bedrock"} error={!!healthError} />
        {health?.version && <div className="text-[11px] text-muted">v{health.version}</div>}
      </div>
    </aside>
  );
}

function EnvRow({ label, value, ok, error }: { label: string; value?: string; ok: boolean; error: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted">{label}</span>
      <span className="inline-flex items-center gap-1.5 font-medium">
        <span className={cn("h-1.5 w-1.5 rounded-full", error ? "bg-bad" : ok ? "bg-ok" : value ? "bg-warn" : "bg-border")} />
        {error ? "unreachable" : value ?? "…"}
      </span>
    </div>
  );
}
