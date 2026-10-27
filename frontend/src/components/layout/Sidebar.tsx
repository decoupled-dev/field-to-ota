import { NavLink } from "react-router-dom";
import { ArrowUpRight, FileText, FolderKanban, LayoutDashboard, Plug, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { Mark } from "./Topbar";

export const NAV = [
  { to: "/", label: "Overview", end: true, icon: LayoutDashboard, group: "Operations" },
  { to: "/signals", label: "Signals", icon: Radio, group: "Operations" },
  { to: "/cases", label: "Cases", icon: FolderKanban, group: "Operations" },
  { to: "/reports", label: "Reports", icon: FileText, group: "Delivery" },
  { to: "/integrations", label: "Integrations", icon: Plug, group: "Delivery" },
];

const GROUPS = ["Operations", "Delivery"];

/** Project sidebar: project identity at the top, grouped navigation below. */
export function Sidebar() {
  return (
    <aside className="sticky top-12 hidden h-[calc(100vh-48px)] w-[240px] shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex items-center gap-3 px-4 pb-3 pt-5">
        <Mark size={32} />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold">Loopback</div>
          <div className="truncate text-xs text-faint">Field signal → verified OTA</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {GROUPS.map((g) => (
          <div key={g} className="mt-4">
            <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-[0.04em] text-faint">{g}</div>
            {NAV.filter((n) => n.group === g).map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cn(
                    "relative flex h-9 items-center gap-3 rounded px-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-accent/10 text-accent before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r before:bg-accent"
                      : "text-muted hover:bg-fg/[0.06] hover:text-fg",
                  )
                }
              >
                <n.icon size={16} strokeWidth={2} />
                {n.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="border-t border-border px-2 py-2">
        <a href="/forum" target="_blank" rel="noreferrer" className="flex h-9 items-center gap-3 rounded px-2 text-sm text-muted hover:bg-fg/[0.06] hover:text-fg">
          <ArrowUpRight size={16} />
          Owners forum
        </a>
      </div>
    </aside>
  );
}

/** Below md the sidebar collapses into a horizontal tab row. */
export function MobileNav() {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border bg-surface px-3 md:hidden">
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          className={({ isActive }) =>
            cn("-mb-px flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-2 text-sm font-medium", isActive ? "border-accent text-accent" : "border-transparent text-muted")
          }
        >
          <n.icon size={14} />
          {n.label}
        </NavLink>
      ))}
    </nav>
  );
}
