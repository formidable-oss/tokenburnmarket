import type { ComponentPropsWithoutRef, ElementType } from "react";

/*
  Button and link-as-button share one visual contract.
  Variants: primary (yellow, one per view), secondary (outlined), ghost (text).
  Minimum target 40px; focus ring comes from the global :focus-visible style.
*/

type Variant = "primary" | "secondary" | "ghost";

const base =
  "inline-flex h-10 items-center justify-center gap-2 rounded-(--radius-control) px-4 text-sm font-medium " +
  "transition-[background-color,border-color,color,transform] duration-150 ease-(--ease-out-expo) " +
  "active:translate-y-px disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap";

const variants: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary:
    "border border-border-strong text-foreground hover:border-primary-border hover:bg-primary-subtle",
  ghost: "text-muted hover:text-foreground hover:bg-surface-raised",
};

export function buttonClass(variant: Variant = "primary", extra = "") {
  return `${base} ${variants[variant]} ${extra}`.trim();
}

type ButtonProps<T extends ElementType> = {
  as?: T;
  variant?: Variant;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "className">;

export function Button<T extends ElementType = "button">({
  as,
  variant = "primary",
  className = "",
  ...props
}: ButtonProps<T>) {
  const Tag: ElementType = as ?? "button";
  return <Tag className={buttonClass(variant, className)} {...props} />;
}
