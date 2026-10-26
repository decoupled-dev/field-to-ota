import * as T from "@radix-ui/react-tooltip";

export const TooltipProvider = T.Provider;

export function Tip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  return (
    <T.Root delayDuration={200}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content sideOffset={6} className="z-50 max-w-xs rounded border border-border bg-fg px-2 py-1 text-xs text-bg shadow">
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
