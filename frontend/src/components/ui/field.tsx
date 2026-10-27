import { cn } from "@/lib/utils";

const base = "w-full rounded border-2 border-border bg-raised text-sm text-fg placeholder:text-faint transition-colors hover:bg-subtle/60 focus:border-accent focus:bg-raised focus:outline-none";

export function Input({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, "h-8 px-2", className)} {...p} />;
}

export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(base, "min-h-[72px] px-2 py-1.5 leading-5", className)} {...p} />;
}

export function Select({ className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(base, "h-8 w-auto px-1.5", className)} {...p} />;
}

export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("label mb-1 block", className)} {...p} />;
}
