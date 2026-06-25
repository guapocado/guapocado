import type * as React from "react";

import { cn } from "./cn";

/**
 * Renders the outer container for a card, providing the bordered, padded
 * surface that groups related billing UI content.
 *
 * @param props - Standard `div` props including `className` and `children`.
 * @example
 * ```tsx
 * <Card>
 *   <CardHeader>
 *     <CardTitle>Pro plan</CardTitle>
 *   </CardHeader>
 *   <CardContent>Everything in Free, plus more.</CardContent>
 * </Card>
 * ```
 */
export function Card({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card"
			className={cn(
				"flex flex-col gap-6 rounded-lg border border-border bg-card py-6 text-card-foreground shadow-sm",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * Renders the header region of a {@link Card}, laying out the title,
 * description, and an optional action in a responsive grid.
 *
 * @param props - Standard `div` props including `className` and `children`.
 * @example
 * ```tsx
 * <CardHeader>
 *   <CardTitle>Usage</CardTitle>
 *   <CardDescription>Current billing period</CardDescription>
 * </CardHeader>
 * ```
 */
export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-header"
			className={cn(
				"grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto]",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * Renders the prominent title text within a {@link CardHeader} using the
 * card's emphasized typography styles.
 *
 * @param props - Standard `div` props including `className` and `children`.
 * @example
 * ```tsx
 * <CardTitle>Pro plan</CardTitle>
 * ```
 */
export function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-title"
			className={cn("font-semibold leading-none", className)}
			{...props}
		/>
	);
}

/**
 * Renders muted secondary description text within a {@link CardHeader},
 * typically explaining or qualifying the card title.
 *
 * @param props - Standard `div` props including `className` and `children`.
 * @example
 * ```tsx
 * <CardDescription>Billed monthly, cancel anytime.</CardDescription>
 * ```
 */
export function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-description"
			className={cn("text-sm text-muted-foreground", className)}
			{...props}
		/>
	);
}

/**
 * Renders a right-aligned action slot within a {@link CardHeader}, suited to
 * buttons or menus positioned beside the title.
 *
 * @param props - Standard `div` props including `className` and `children`.
 * @example
 * ```tsx
 * <CardHeader>
 *   <CardTitle>Pro plan</CardTitle>
 *   <CardAction>
 *     <Button size="sm">Manage</Button>
 *   </CardAction>
 * </CardHeader>
 * ```
 */
export function CardAction({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-action"
			className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
			{...props}
		/>
	);
}

/**
 * Renders the main body region of a {@link Card}, applying the card's
 * horizontal padding to whatever content it wraps.
 *
 * @param props - Standard `div` props including `className` and `children`.
 * @example
 * ```tsx
 * <CardContent>You have used 80% of your monthly quota.</CardContent>
 * ```
 */
export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="card-content" className={cn("px-6", className)} {...props} />;
}

/**
 * Renders the footer region of a {@link Card}, aligning trailing content such
 * as actions or summaries along a single row.
 *
 * @param props - Standard `div` props including `className` and `children`.
 * @example
 * ```tsx
 * <CardFooter>
 *   <Button className="w-full">Upgrade</Button>
 * </CardFooter>
 * ```
 */
export function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div data-slot="card-footer" className={cn("flex items-center px-6", className)} {...props} />
	);
}
