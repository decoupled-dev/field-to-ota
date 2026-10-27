import * as T from "@radix-ui/react-tooltip";

export const TooltipProvider = T.Provider;

export function Tip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  return (
    <T.Root delayDuration={150}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content sideOffset={6} className="z-50 max-w-xs rounded-sm bg-[hsl(218_54%_20%)] px-2 py-1 text-xs text-white shadow-overlay dark:bg-[hsl(210_24%_87%)] dark:text-[hsl(210_12%_13%)]">
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
