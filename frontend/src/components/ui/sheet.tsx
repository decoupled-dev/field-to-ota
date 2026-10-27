import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const overlay = "fixed inset-0 z-40 bg-[hsl(218_54%_10%/0.45)]";

export function Sheet({ open, onOpenChange, title, description, eyebrow, children, width = "w-[560px]" }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlay} />
        <D.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn("fixed inset-y-0 right-0 z-50 flex max-w-full flex-col border-l border-border bg-surface shadow-overlay focus:outline-none", width)}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              {eyebrow && <div className="label mb-1">{eyebrow}</div>}
              <D.Title className="text-lg font-semibold leading-6">{title}</D.Title>
              {description ? <D.Description className="mt-1 font-mono text-xs text-faint">{description}</D.Description> : <D.Description className="sr-only">Details</D.Description>}
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
        <D.Overlay className={overlay} />
        <D.Content className="fixed left-1/2 top-1/2 z-50 w-[480px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-md bg-surface shadow-overlay focus:outline-none">
          <div className="px-6 pt-5">
            <D.Title className="text-lg font-semibold">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-xs leading-5 text-muted">{description}</D.Description> : <D.Description className="sr-only">Dialog</D.Description>}
          </div>
          <div className="px-6 pb-5 pt-4">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export const ModalClose = D.Close;
