import { cn } from "@/lib/utils";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
      <div className="min-w-0">
        {eyebrow && <div className="label mb-2 flex items-center gap-2">{eyebrow}</div>}
        <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.025em]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[13px] leading-5 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageBody({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mx-auto w-full max-w-[1560px] px-6 pb-16 pt-7", className)} {...p} />;
}
