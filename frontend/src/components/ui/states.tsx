import { AlertCircle, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-subtle", className)} />;
}

export function Empty({ title, hint, icon, className }: { title: string; hint?: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)}>
      <div className="text-muted">{icon ?? <Inbox size={20} strokeWidth={1.5} />}</div>
      <div className="text-sm font-medium">{title}</div>
      {hint && <div className="max-w-sm text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm">
      <AlertCircle size={16} className="mt-0.5 shrink-0 text-bad" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">Could not load data</div>
        <div className="mt-0.5 break-words text-xs text-muted">{error.message || "The console API is unreachable."}</div>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="text-xs font-medium text-accent hover:underline">
          Retry
        </button>
      )}
    </div>
  );
}
