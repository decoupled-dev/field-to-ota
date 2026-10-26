import { cn } from "@/lib/utils";

export function Input({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn("h-8 w-full rounded border border-border bg-surface px-2.5 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20", className)}
      {...p}
    />
  );
}

export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn("min-h-[64px] w-full rounded border border-border bg-surface px-2.5 py-1.5 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20", className)}
      {...p}
    />
  );
}

export function Select({ className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn("h-8 rounded border border-border bg-surface px-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20", className)}
      {...p}
    />
  );
}

export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1 block text-xs font-medium text-muted", className)} {...p} />;
}
