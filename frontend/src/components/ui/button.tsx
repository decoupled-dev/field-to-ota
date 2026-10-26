import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg border border-accent hover:brightness-110 shadow-[0_0_0_1px_hsl(var(--accent)/0.15),0_6px_18px_-8px_hsl(var(--accent)/0.6)]",
  secondary: "bg-raised text-fg border border-border hover:border-strong",
  ghost: "text-muted hover:text-fg hover:bg-subtle border border-transparent",
  danger: "bg-raised text-bad border border-border hover:border-bad/50 hover:bg-bad/5",
};
const sizes: Record<Size, string> = { sm: "h-7 px-2.5 text-xs gap-1.5", md: "h-8 px-3 text-sm gap-2" };

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant = "secondary", size = "md", ...p }, ref) => (
  <button
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center rounded font-medium transition-[color,background-color,border-color,filter] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-bg",
      variants[variant],
      sizes[size],
      className,
    )}
    {...p}
  />
));
Button.displayName = "Button";
