"use client";
import * as React from "react";
import { cn } from "../../lib/cn";
import { buttonVariants } from "../ui/button";

type ColorVariant = 'primary' | 'default' | 'secondary' | 'outline' | 'ghost';
type SizeVariant = 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm';

type BaseButtonProps = {
  /** @deprecated Use `variant` instead */
  color?: ColorVariant,
  /** Alias for `color` - preferred prop name */
  variant?: ColorVariant,
  size?: SizeVariant,
  icon?: React.ReactNode,
  children: React.ReactNode,
}

type ButtonAsButton = BaseButtonProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'color'> & {
    href?: never,
  };

type ButtonAsLink = BaseButtonProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'color'> & {
    href: string,
  };

type ButtonProps = ButtonAsButton | ButtonAsLink;

export const Button = React.forwardRef<
  HTMLButtonElement | HTMLAnchorElement,
  ButtonProps
>(({ className, color, variant, size = 'sm', icon, href, children, ...props }, ref) => {
  // Support both `variant` and `color` props (variant takes precedence)
  const resolvedColor = variant ?? color ?? 'secondary';

  const buttonContent = (
    <>
      {icon && <span className="inline-flex items-center justify-center w-3.5 h-3.5">{icon}</span>}
      {children}
    </>
  );

  const buttonClasses = cn(
    buttonVariants({
      color: resolvedColor,
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

export type { ButtonProps };
