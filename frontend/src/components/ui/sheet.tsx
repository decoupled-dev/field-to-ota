import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Sheet({ open, onOpenChange, title, description, children, width = "w-[560px]" }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/20 dark:bg-black/50" />
        <D.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn("fixed inset-y-0 right-0 z-50 flex max-w-full flex-col border-l border-border bg-surface shadow-xl focus:outline-none", width)}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <D.Title className="text-base font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-0.5 text-xs text-muted">{description}</D.Description> : <D.Description className="sr-only">Details</D.Description>}
            </div>
            <D.Close className="rounded p-1 text-muted hover:bg-subtle hover:text-fg" aria-label="Close">
              <X size={16} />
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function Modal({ open, onOpenChange, title, description, children }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/20 dark:bg-black/50" />
        <D.Content className="fixed left-1/2 top-1/2 z-50 w-[480px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-surface shadow-xl focus:outline-none">
          <div className="border-b border-border px-5 py-4">
            <D.Title className="text-base font-semibold">{title}</D.Title>
            {description ? <D.Description className="mt-0.5 text-xs text-muted">{description}</D.Description> : <D.Description className="sr-only">Dialog</D.Description>}
          </div>
          <div className="p-5">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export const ModalClose = D.Close;
