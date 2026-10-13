import Link from "next/link";
import type { ComponentProps } from "react";
import type { VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";

type LinkButtonProps = ComponentProps<typeof Link> & VariantProps<typeof buttonVariants>;

/**
 * A link that looks like a button.
 *
 * Base UI's `Button` expects a real `<button>`, so navigation uses this
 * instead of rendering an anchor through the button primitive — the element
 * then matches what it actually does, which keeps keyboard and screen-reader
 * behaviour correct.
 */
export function LinkButton({ className, variant, size, ...props }: LinkButtonProps) {
  return (
    <Link
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
