import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { ArrowUpRight, Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/hooks";
import { useApp } from "@/lib/context";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/signals", label: "Signals" },
  { to: "/cases", label: "Cases" },
  { to: "/reports", label: "Reports" },
  { to: "/integrations", label: "Integrations" },
];

/** The mark: a V whose right arm returns to the field, closing the loop. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect x="0.5" y="0.5" width="23" height="23" rx="3" className="fill-fg" />
      <path d="M5 7.5l7 11 7-11" className="stroke-bg" strokeWidth="2.2" fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M19 7.5C17 3.6 7 3.6 5 7.5" className="stroke-accent" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeDasharray="2 2.2" />
      <circle cx="19" cy="7.5" r="1.9" className="fill-accent" />
    </svg>
  );
}

export function Topbar() {
  const [dark, toggle] = useTheme();
  const { health, healthError } = useApp();
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-[52px] w-full max-w-[1560px] items-stretch gap-8 px-6">
        <Link to="/" className="flex shrink-0 items-center gap-2.5">
          <Mark />
          <span className="leading-none">
            <span className="block text-[14px] font-semibold tracking-tight">Field-to-Fix</span>
            <span className="mt-1 block font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">field signal → verified OTA</span>
          </span>
        </Link>
        <nav className="flex items-stretch gap-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn(
                  "relative flex items-center px-3 text-[13px] font-medium transition-colors",
                  isActive ? "text-fg after:absolute after:inset-x-3 after:-bottom-px after:h-[2px] after:bg-accent" : "text-muted hover:text-fg",
                )
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <a href="/forum" target="_blank" rel="noreferrer" className="hidden h-7 items-center gap-1 rounded px-2 font-mono text-2xs uppercase tracking-[0.08em] text-muted hover:bg-subtle hover:text-fg lg:inline-flex">
            Owners forum <ArrowUpRight size={12} />
          </a>
          <div className="hidden h-7 items-stretch divide-x divide-border overflow-hidden rounded border border-border bg-surface md:flex">
            <Telemetry k="Env" v={healthError ? "offline" : health?.mode ?? "…"} state={healthError ? "bad" : health ? "ok" : "idle"} />
            <Telemetry
              k="Reasoning"
              v={healthError ? "—" : health ? (health.llm === "bedrock" ? "Bedrock" : "Rules") : "…"}
              state={healthError ? "bad" : health?.llm === "bedrock" ? "ok" : health ? "warn" : "idle"}
            />
            <Clock />
          </div>
          <button onClick={toggle} className="flex h-7 w-7 items-center justify-center rounded border border-border bg-surface text-muted hover:border-strong hover:text-fg" aria-label="Toggle theme">
            {dark ? <Sun size={13} /> : <Moon size={13} />}
          </button>
        </div>
      </div>
    </header>
  );
}

function Telemetry({ k, v, state }: { k: string; v: string; state: "ok" | "warn" | "bad" | "idle" }) {
  return (
    <span className="flex items-center gap-2 px-2.5 font-mono text-2xs uppercase tracking-[0.06em]">
      <span className="text-faint">{k}</span>
      <span className={cn("h-1.5 w-1.5 rounded-full", state === "ok" ? "bg-ok" : state === "warn" ? "bg-warn" : state === "bad" ? "bg-bad" : "bg-strong")} />
      <span className="text-fg">{v}</span>
    </span>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="tnum flex items-center gap-2 px-2.5 font-mono text-2xs tracking-[0.06em]">
      <span className="uppercase text-faint">UTC</span>
      <span className="text-fg">{now.toISOString().slice(11, 19)}</span>
    </span>
  );
}
