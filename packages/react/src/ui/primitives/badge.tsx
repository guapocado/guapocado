import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";

import { cn } from "./cn";

/** Class variance config for Guapocado badge styles. */
export const badgeVariants = cva(
	"inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full border border-transparent px-2 py-0.5 text-xs font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg]:size-3",
	{
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground",
				secondary: "bg-secondary text-secondary-foreground",
				destructive: "bg-destructive text-destructive-foreground",
				outline: "border-border text-foreground",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

/** Props accepted by the Badge primitive. */
export type BadgeProps = React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

/**
 * Renders a small pill-shaped status or label element styled with Guapocado
 * design tokens and the selected visual variant.
 *
 * @param props - Standard `span` props plus a `variant`
 *   (`default`, `secondary`, `destructive`, or `outline`) and `className`.
 * @example
 * ```tsx
 * <Badge variant="secondary">Trial</Badge>
 * ```
 */
export function Badge({ className, variant, ...props }: BadgeProps) {
	return (
		<span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
	);
}
