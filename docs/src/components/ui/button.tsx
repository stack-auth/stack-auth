import { cva, type VariantProps } from 'class-variance-authority';

export const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors duration-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fd-primary disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      color: {
        primary:
          'bg-fd-primary text-fd-primary-foreground hover:bg-fd-primary/80',
        default:
          'bg-fd-primary text-fd-primary-foreground hover:bg-fd-primary/90',
        outline: 'border border-fd-border bg-fd-background hover:bg-fd-accent hover:text-fd-accent-foreground',
        ghost: 'hover:bg-fd-accent hover:text-fd-accent-foreground',
        secondary:
          'border bg-fd-secondary text-fd-secondary-foreground hover:bg-fd-accent hover:text-fd-accent-foreground',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 gap-1 px-3 py-1.5 text-xs rounded-md',
        lg: 'h-10 px-8 rounded-md',
        icon: 'h-9 w-9 p-1.5 [&_svg]:size-5',
        'icon-sm': 'p-1.5 [&_svg]:size-4.5',
      },
    },
    defaultVariants: {
      color: 'primary',
      size: 'default',
    },
  },
);

export type ButtonProps = VariantProps<typeof buttonVariants>;
