import type * as React from "react";

import { cn } from "./cn";

/** Props accepted by the Separator primitive. */
export type SeparatorProps = React.ComponentProps<"div"> & {
	decorative?: boolean;
	orientation?: "horizontal" | "vertical";
};

/**
 * Renders a thin horizontal or vertical divider line, optionally exposed to
 * assistive technology as a semantic separator.
 *
 * @param props - Standard `div` props plus `orientation`
 *   (`horizontal` or `vertical`) and `decorative` (whether it is purely
 *   visual or an accessible separator).
 * @example
 * ```tsx
 * <Separator orientation="vertical" decorative={false} />
 * ```
 */
export function Separator({
	className,
	decorative = true,
	orientation = "horizontal",
	...props
}: SeparatorProps) {
	return (
		<div
			data-orientation={orientation}
			data-slot="separator"
			role={decorative ? "none" : "separator"}
			aria-orientation={decorative ? undefined : orientation}
			className={cn(
				"shrink-0 bg-border",
				orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
				className,
			)}
			{...props}
		/>
	);
}
