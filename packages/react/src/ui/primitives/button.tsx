import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";

import { cn } from "./cn";

/** Class variance config for Guapocado button styles. */
export const buttonVariants = cva(
	"inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground hover:bg-primary/90",
				destructive:
					"bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/20",
				outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
				secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
				ghost: "hover:bg-accent hover:text-accent-foreground",
				link: "text-primary underline-offset-4 hover:underline",
			},
			size: {
				default: "h-9 px-4 py-2",
				sm: "h-8 px-3 text-xs",
				lg: "h-10 px-6",
				icon: "size-9",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

/** Props accepted by the Button primitive. */
export type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

/**
 * Renders a button element styled with Guapocado design tokens, supporting the
 * standard set of visual variants and sizes.
 *
 * @param props - Standard `button` props plus a `variant`
 *   (`default`, `destructive`, `outline`, `secondary`, `ghost`, or `link`),
 *   a `size` (`default`, `sm`, `lg`, or `icon`), and `className`.
 * @example
 * ```tsx
 * <Button variant="outline" size="sm" onClick={onUpgrade}>
 *   Upgrade
 * </Button>
 * ```
 */
export function Button({ className, variant, size, ...props }: ButtonProps) {
	return (
		<button
			data-slot="button"
			className={cn(buttonVariants({ variant, size }), className)}
			{...props}
		/>
	);
}
