import { cn } from "@/lib/utils";

export function Table({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)} {...p} />
    </div>
  );
}
export function Th({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("h-9 border-b border-border px-3 text-left text-xs font-medium text-muted whitespace-nowrap", className)} {...p} />;
}
export function Td({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("h-10 border-b border-border px-3 align-middle", className)} {...p} />;
}
export function Tr({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("transition-colors hover:bg-subtle/60", className)} {...p} />;
}
