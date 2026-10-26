import { cn } from "@/lib/utils";

const base = "w-full rounded border border-border bg-raised text-sm text-fg placeholder:text-faint transition-colors hover:border-strong focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/20";

export function Input({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, "h-8 px-2.5", className)} {...p} />;
}

export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(base, "min-h-[72px] px-2.5 py-2 leading-5", className)} {...p} />;
}

export function Select({ className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(base, "h-8 w-auto px-2", className)} {...p} />;
}

export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("label mb-1.5 block", className)} {...p} />;
}
