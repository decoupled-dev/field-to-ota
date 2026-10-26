import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent/90 border border-accent",
  secondary: "bg-surface text-fg border border-border hover:bg-subtle",
  ghost: "text-muted hover:text-fg hover:bg-subtle border border-transparent",
  danger: "bg-surface text-bad border border-border hover:bg-bad/5 hover:border-bad/40",
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
      "inline-flex items-center justify-center rounded font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
      variants[variant],
      sizes[size],
      className,
    )}
    {...p}
  />
));
Button.displayName = "Button";
