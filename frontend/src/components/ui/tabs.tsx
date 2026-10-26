import * as T from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ className, ...p }: T.TabsListProps) {
  return <T.List className={cn("flex items-center gap-6 border-b border-border", className)} {...p} />;
}

export function TabsTrigger({ className, ...p }: T.TabsTriggerProps) {
  return (
    <T.Trigger
      className={cn(
        "-mb-px inline-flex items-center gap-1.5 border-b-2 border-transparent pb-2.5 pt-1 text-[13px] font-medium text-muted transition-colors hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg",
        className,
      )}
      {...p}
    />
  );
}

/** Count shown next to a tab label. */
export function TabCount({ n }: { n: number }) {
  return <span className="tnum rounded-sm bg-subtle px-1 font-mono text-2xs text-muted">{n}</span>;
}

/** Segmented control for compact view toggles. */
export function Segmented<V extends string>({ value, onChange, options }: { value: V; onChange: (v: V) => void; options: { value: V; label: string; icon?: React.ReactNode }[] }) {
  return (
    <div className="inline-flex rounded border border-border bg-bg p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-sm px-2.5 font-mono text-2xs uppercase tracking-[0.06em] transition-colors",
            value === o.value ? "bg-raised text-fg shadow-[inset_0_0_0_1px_hsl(var(--border))]" : "text-muted hover:text-fg",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
