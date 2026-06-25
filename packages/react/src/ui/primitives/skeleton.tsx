import type * as React from "react";

import { cn } from "./cn";

/**
 * Renders an animated pulsing placeholder block used to indicate loading state
 * before billing data has resolved.
 *
 * @param props - Standard `div` props including `className` to size the
 *   placeholder to match the eventual content.
 * @example
 * ```tsx
 * {loading ? <Skeleton className="h-4 w-24" /> : <span>{balance}</span>}
 * ```
 */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="skeleton"
			className={cn("animate-pulse rounded-md bg-muted", className)}
			{...props}
		/>
	);
}
