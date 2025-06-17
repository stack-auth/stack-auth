import { forwardRef } from 'react';
import { cn } from '../../lib/cn';

type ButtonProps = {
  variant?: 'default' | 'outline' | 'ghost' | 'secondary',
  size?: 'default' | 'sm' | 'lg' | 'icon',
} & React.ButtonHTMLAttributes<HTMLButtonElement>

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    const baseClasses = 'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fd-primary disabled:pointer-events-none disabled:opacity-50';

    const variants = {
      default: 'bg-fd-primary text-fd-primary-foreground hover:bg-fd-primary/90',
      outline: 'border border-fd-border bg-fd-background hover:bg-fd-accent hover:text-fd-accent-foreground',
      ghost: 'hover:bg-fd-accent hover:text-fd-accent-foreground',
      secondary: 'bg-fd-secondary text-fd-secondary-foreground hover:bg-fd-secondary/80',
    };

    const sizes = {
      default: 'h-9 px-4 py-2 text-sm',
      sm: 'h-8 rounded-md px-3 text-xs',
      lg: 'h-10 rounded-md px-8',
      icon: 'h-9 w-9',
    };

    return (
      <button
        className={cn(
          baseClasses,
          variants[variant],
          sizes[size],
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';

export { Button };
export type { ButtonProps };

