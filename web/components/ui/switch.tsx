"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

interface SwitchProps
  extends Omit<React.ComponentPropsWithoutRef<"button">, "onChange" | "value"> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

// Hand-rolled switch: @radix-ui/react-switch is not a dependency of `web`,
// so this mirrors the shadcn/ui Switch API (checked / onCheckedChange) with
// a plain <button role="switch"> instead of pulling in a new package.
const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, checked, onCheckedChange, disabled, ...props }, ref) => {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        ref={ref}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-primary" : "bg-input",
          className
        )}
        {...props}
      >
        <span
          className={cn(
            "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform",
            checked ? "translate-x-5" : "translate-x-0"
          )}
        />
      </button>
    )
  }
)
Switch.displayName = "Switch"

export { Switch }
