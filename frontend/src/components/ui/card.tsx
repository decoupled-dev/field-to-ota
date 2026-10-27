import { cn } from "@/lib/utils";

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("panel", className)} {...p} />;
}

/** Container header: a bold title and a right-aligned action. The description is shown on hover only. */
export function CardHeader({ title, description, action, index, className }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; index?: string; className?: string }) {
  return (
    <div className={cn("flex min-h-[48px] items-center justify-between gap-4 border-b border-border px-4 py-2.5", className)}>
      <div className="min-w-0">
        <h3 title={typeof description === "string" ? description : undefined} className="flex items-center gap-2 text-[15px] font-semibold leading-5 text-fg">
          {index && <span className="font-mono text-xs font-normal text-faint">{index}</span>}
          {title}
        </h3>
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...p} />;
}
