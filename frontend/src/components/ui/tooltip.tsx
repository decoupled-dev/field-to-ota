import * as T from "@radix-ui/react-tooltip";

export const TooltipProvider = T.Provider;

export function Tip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  return (
    <T.Root delayDuration={150}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content sideOffset={6} className="z-50 max-w-xs rounded-sm border border-strong bg-raised px-2 py-1 font-mono text-2xs text-fg shadow-xl">
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
