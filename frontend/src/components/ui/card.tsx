import { cn } from "@/lib/utils";

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("panel", className)} {...p} />;
}

/** Panel header: a mono label as the title, an optional sentence of context and a right-aligned action. */
export function CardHeader({ title, description, action, index, className }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; index?: string; className?: string }) {
  return (
    <div className={cn("flex min-h-[44px] items-center justify-between gap-4 border-b border-border px-4 py-2.5", className)}>
      <div className="flex min-w-0 items-baseline gap-3">
        {index && <span className="font-mono text-2xs text-faint">{index}</span>}
        <h3 className="shrink-0 font-mono text-2xs font-medium uppercase tracking-[0.09em] text-fg">{title}</h3>
        {description && <p className="hidden min-w-0 truncate text-xs text-muted md:block">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...p} />;
}
