import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combines conditional class name values with `clsx` and resolves conflicting
 * Tailwind utility classes via `tailwind-merge`.
 *
 * @param inputs - Class name values (strings, arrays, or conditional objects)
 *   to merge into a single deduplicated class string.
 * @example
 * ```ts
 * cn("px-2 py-1", isActive && "bg-primary", "px-4");
 * // => "py-1 bg-primary px-4" (later px-4 wins over px-2)
 * ```
 */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
