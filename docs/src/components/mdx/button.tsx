"use client";
import * as React from "react";
import { cn } from "../../lib/cn";
import { buttonVariants } from "../ui/button";

type BaseButtonProps = {
  color?: 'primary' | 'secondary' | 'outline' | 'ghost',
  size?: 'sm' | 'icon' | 'icon-sm',
  icon?: React.ReactNode,
  children: React.ReactNode,
}

type ButtonAsButton = BaseButtonProps &
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    href?: never,
  };

type ButtonAsLink = BaseButtonProps &
  React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string,
  };

type ButtonProps = ButtonAsButton | ButtonAsLink;

export const Button = React.forwardRef<
  HTMLButtonElement | HTMLAnchorElement,
  ButtonProps
>(({ className, color = 'secondary', size = 'sm', icon, href, children, ...props }, ref) => {
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
        role="button"
        href={href}
        className={buttonClasses}
        ref={ref as React.Ref<HTMLAnchorElement>}
        {...(props as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
      >
        {buttonContent}
      </a>
    );
  }

  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      className={buttonClasses}
      {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}
    >
      {buttonContent}
    </button>
  );
});

Button.displayName = "Button";
