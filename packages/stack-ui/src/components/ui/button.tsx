import { Slot } from "@radix-ui/react-slot";
import { forwardRefIfNeeded } from "@stackframe/stack-shared/dist/utils/react";
import { cva, type VariantProps } from "class-variance-authority";
import React from "react";

import { useAsyncCallback } from "@stackframe/stack-shared/dist/hooks/use-async-callback";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { cn } from "../../lib/utils";
import { Spinner } from "./spinner";

const buttonVariants = cva(
  "stack-scope inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        plain: "",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
        plain: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export type OriginalButtonProps = {
  asChild?: boolean,
} & React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>

const OriginalButton = forwardRefIfNeeded<HTMLButtonElement, OriginalButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
OriginalButton.displayName = "Button";

type ButtonProps = {
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>,
  loading?: boolean,
} & OriginalButtonProps

const Button = forwardRefIfNeeded<HTMLButtonElement, ButtonProps>(
  ({ onClick, loading: loadingProp, children, size, ...props }, ref) => {
    const [handleClick, isLoading] = useAsyncCallback(async (e: React.MouseEvent<HTMLButtonElement>) => {
      await onClick?.(e);
    }, [onClick]);

    const loading = loadingProp || isLoading;

    return (
      <OriginalButton
        {...props}
        ref={ref}
        disabled={props.disabled || loading}
        onClick={(e) => runAsynchronouslyWithAlert(handleClick(e))}
        size={size}
        className={cn("relative", loading && "[&>:not(.stack-button-do-not-hide-when-siblings-are)]:invisible", props.className)}
      >
        <Spinner className={cn("absolute inset-0 flex items-center justify-center stack-button-do-not-hide-when-siblings-are", !loading && "invisible")} />
        {typeof children === "string" ? <span>{children}</span> : children}
      </OriginalButton>
    );
  }
);
Button.displayName = "Button";

export { Button, ButtonProps, buttonVariants };

