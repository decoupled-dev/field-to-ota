import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Moon, Search, Sun } from "lucide-react";
import { api, type Case } from "@/lib/api";
import { useTheme } from "@/lib/hooks";
import { useApp } from "@/lib/context";
import { cn } from "@/lib/utils";
import { NAV } from "./Sidebar";

/** The mark: a V whose right arm returns to the field, closing the loop. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect x="0" y="0" width="24" height="24" rx="5" fill="#0C66E4" />
      <path d="M5 7.5l7 11 7-11" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M19 7.5C17 3.6 7 3.6 5 7.5" stroke="#9DD9EE" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeDasharray="2 2.2" />
      <circle cx="19" cy="7.5" r="1.9" fill="#9DD9EE" />
    </svg>
  );
}

/** Global navigation bar: fixed navy across both themes, like a cloud console header. */
export function Topbar() {
  const [dark, toggle] = useTheme();
  const { health, healthError } = useApp();
  return (
    <header className="sticky top-0 z-30 bg-nav text-nav-fg">
      <div className="flex h-12 items-center gap-4 px-4">
        <Link to="/" className="flex shrink-0 items-center gap-2 rounded px-1 py-1 hover:bg-nav-hover">
          <Mark />
          <span className="text-[15px] font-bold tracking-tight">Loopback</span>
        </Link>
        <QuickSearch />
        <div className="ml-auto flex items-center gap-1">
          <Status
            env={healthError ? "Offline" : health?.mode ?? "…"}
            llm={healthError ? "—" : health ? (health.llm === "bedrock" ? "Bedrock" : "Rules") : "…"}
            state={healthError ? "bad" : health?.llm === "bedrock" ? "ok" : health ? "warn" : "idle"}
          />
          <button onClick={toggle} className="flex h-8 w-8 items-center justify-center rounded text-nav-muted hover:bg-nav-hover hover:text-nav-fg" aria-label="Toggle theme">
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </div>
    </header>
  );
}

/** Jump to a page or a case by id/title. Cases are fetched on first focus. */
function QuickSearch() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cases, setCases] = useState<Case[] | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    const pages = NAV.filter((n) => !t || n.label.toLowerCase().includes(t)).map((n) => ({ to: n.to, label: n.label, hint: "Page" }));
    const cs = (cases ?? [])
      .filter((c) => t && (c.id.toLowerCase().includes(t) || c.title.toLowerCase().includes(t) || (c.component ?? "").toLowerCase().includes(t)))
      .slice(0, 6)
      .map((c) => ({ to: `/cases/${c.id}`, label: c.title, hint: c.id }));
    return [...cs, ...pages];
  }, [q, cases]);

  const go = (to: string) => {
    nav(to);
    setQ("");
    setOpen(false);
    input.current?.blur();
  };

  return (
    <div className="relative hidden w-full max-w-[420px] md:block">
      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-nav-muted" />
      <input
        ref={input}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onFocus={() => {
          setOpen(true);
          if (!cases) api.cases().then(setCases, () => setCases([]));
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else if (e.key === "Enter" && results[active]) go(results[active].to);
          else if (e.key === "Escape") input.current?.blur();
        }}
        placeholder="Search cases, components, pages"
        className="h-8 w-full rounded border border-nav-muted/30 bg-nav-hover/60 pl-8 pr-14 text-sm text-nav-fg placeholder:text-nav-muted focus:border-[#579DFF] focus:bg-nav focus:outline-none"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-nav-muted/30 px-1.5 text-[11px] text-nav-muted">/</kbd>
      {open && results.length > 0 && (
        <ul className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 overflow-hidden rounded-md border border-border bg-raised py-1 text-fg shadow-overlay">
          {results.map((r, i) => (
            <li key={r.to}>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(r.to)}
                onMouseEnter={() => setActive(i)}
                className={cn("flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm", i === active && "bg-accent/10")}
              >
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
                <span className={cn("shrink-0 text-xs text-faint", r.hint !== "Page" && "font-mono")}>{r.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Environment and reasoning backend in one pill; the dot turns amber when running on rules only. */
function Status({ env, llm, state }: { env: string; llm: string; state: "ok" | "warn" | "bad" | "idle" }) {
  return (
    <span className="hidden h-8 items-center gap-2 rounded px-2 text-sm md:flex" title={`Environment: ${env} · Reasoning: ${llm}`}>
      <span className={cn("h-2 w-2 rounded-full", state === "ok" ? "bg-[#4BCE97]" : state === "warn" ? "bg-[#F5CD47]" : state === "bad" ? "bg-[#F87168]" : "bg-nav-muted")} />
      <span className="capitalize">{env}</span>
      <span className="text-nav-muted">·</span>
      <span className="text-nav-muted">{llm}</span>
    </span>
  );
}
