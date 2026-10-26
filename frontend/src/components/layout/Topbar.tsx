import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/hooks";

const LABELS: Record<string, string> = { signals: "Signals", cases: "Cases", reports: "Reports", integrations: "Integrations" };

export function Topbar({ actions }: { actions?: React.ReactNode }) {
  const { pathname } = useLocation();
  const [dark, toggle] = useTheme();
  const parts = pathname.split("/").filter(Boolean);
  const crumbs = [{ to: "/", label: "Overview" }, ...parts.map((p, i) => ({ to: "/" + parts.slice(0, i + 1).join("/"), label: LABELS[p] ?? decodeURIComponent(p) }))];
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-6">
      <nav className="flex min-w-0 items-center gap-1 text-sm">
        {crumbs.map((c, i) => (
          <span key={c.to} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight size={14} className="shrink-0 text-muted" />}
            {i === crumbs.length - 1 ? (
              <span className="truncate font-medium">{c.label}</span>
            ) : (
              <Link to={c.to} className="truncate text-muted hover:text-fg">
                {c.label}
              </Link>
            )}
          </span>
        ))}
      </nav>
      <div className="flex items-center gap-2">
        {actions}
        <button onClick={toggle} className="rounded p-1.5 text-muted hover:bg-subtle hover:text-fg" aria-label="Toggle theme">
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  );
}
