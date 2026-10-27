import { Fragment } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type Crumb = { label: React.ReactNode; to?: string };

/** Breadcrumb trail rooted at the project. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const all: Crumb[] = [{ label: "Loopback", to: "/" }, ...items];
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm text-faint">
      {all.map((c, i) => (
        <Fragment key={i}>
          {i > 0 && <ChevronRight size={14} className="shrink-0 text-strong" />}
          {c.to && i < all.length - 1 ? (
            <Link to={c.to} className="truncate hover:text-accent hover:underline">{c.label}</Link>
          ) : (
            <span className="truncate text-muted">{c.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}

export function PageHeader({ title, description, actions, crumbs }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; crumbs?: Crumb[] }) {
  return (
    <div className="mb-6">
      <Breadcrumbs items={crumbs ?? [{ label: title }]} />
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-8 text-fg">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function PageBody({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mx-auto w-full max-w-[1600px] px-6 pb-16 pt-5", className)} {...p} />;
}
