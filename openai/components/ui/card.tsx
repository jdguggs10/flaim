import * as React from "react"

import { cn } from "@/lib/utils"

type CardProps = React.ComponentPropsWithoutRef<"div">

const Card = React.forwardRef<
  HTMLDivElement,
  CardProps
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-lg border bg-card text-card-foreground shadow-sm",
      className
    )}
    {...props}
  />
))
Card.displayName = "Card"

type CardHeaderProps = React.ComponentPropsWithoutRef<"div">

const CardHeader = React.forwardRef<
  HTMLDivElement,
  CardHeaderProps
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

type CardTitleProps = React.ComponentPropsWithoutRef<"h3">

const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  CardTitleProps
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "text-2xl font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

type CardDescriptionProps = React.ComponentPropsWithoutRef<"p">

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  CardDescriptionProps
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

type CardContentProps = React.ComponentPropsWithoutRef<"div">

const CardContent = React.forwardRef<
  HTMLDivElement,
  CardContentProps
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

type CardFooterProps = React.ComponentPropsWithoutRef<"div">

const CardFooter = React.forwardRef<
  HTMLDivElement,
  CardFooterProps
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }