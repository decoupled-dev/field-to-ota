import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded bg-subtle", className)}>
      <div className="absolute inset-0 animate-sweep bg-gradient-to-r from-transparent via-fg/[0.05] to-transparent" />
    </div>
  );
}

export function Empty({ title, hint, icon, className }: { title: string; hint?: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2.5 px-6 py-12 text-center", className)}>
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-subtle text-faint">
        {icon ?? <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      </div>
      <div className="text-sm font-semibold text-fg">{title}</div>
      {hint && <div className="max-w-sm text-xs leading-5 text-faint">{hint}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded border-l-4 border-bad bg-bad/[0.08] px-4 py-3 text-sm">
      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-bad" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">Could not load data</div>
        <div className="mt-0.5 break-words text-xs text-muted">{error.message || "The console API is unreachable."}</div>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="text-sm font-medium text-accent hover:underline">
          Retry
        </button>
      )}
    </div>
  );
}
