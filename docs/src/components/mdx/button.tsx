"use client";
import * as React from "react";
import { cn } from "../../lib/cn";
import { buttonVariants } from "../ui/button";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  color?: 'primary' | 'secondary' | 'outline' | 'ghost',
  size?: 'sm' | 'icon' | 'icon-sm',
  icon?: React.ReactNode,
  href?: string,
  children: React.ReactNode,
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, color = 'secondary', size = 'sm', icon, href, children, ...props }, ref) => {
    const buttonContent = (
      <>
        {icon && <span className="inline-flex items-center justify-center w-3.5 h-3.5">{icon}</span>}
        {children}
      </>
    );

    const buttonClasses = cn(
      buttonVariants({
        color,
        size,
        className: 'gap-2 no-underline hover:no-underline'
      }),
      className
    );

    if (href) {
      return (
        <a
          href={href}
          className={buttonClasses}
          {...(props as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
        >
          {buttonContent}
        </a>
      );
    }

    return (
      <button
        ref={ref}
        className={buttonClasses}
        {...props}
      >
        {buttonContent}
      </button>
    );
  }
);

Button.displayName = "Button";
