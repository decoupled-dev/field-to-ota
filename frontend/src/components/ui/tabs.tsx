import * as T from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ className, ...p }: T.TabsListProps) {
  return <T.List className={cn("flex items-center gap-4 border-b border-border", className)} {...p} />;
}

export function TabsTrigger({ className, ...p }: T.TabsTriggerProps) {
  return (
    <T.Trigger
      className={cn(
        "-mb-px border-b-2 border-transparent pb-2 pt-1 text-sm font-medium text-muted transition-colors hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg",
        className,
      )}
      {...p}
    />
  );
}

/** Segmented control for compact view toggles. */
export function Segmented<V extends string>({ value, onChange, options }: { value: V; onChange: (v: V) => void; options: { value: V; label: string; icon?: React.ReactNode }[] }) {
  return (
    <div className="inline-flex rounded border border-border bg-subtle p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-[4px] px-2.5 text-xs font-medium transition-colors",
            value === o.value ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
