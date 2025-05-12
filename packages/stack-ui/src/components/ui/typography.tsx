import { cn } from "../../lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import React from "react";
import { forwardRefIfNeeded } from "@stackframe/stack-shared/dist/utils/react";

const typographyVariants = cva("stack-scope text-md", {
  variants: {
    type: {
      h1: "text-3xl font-bold",
      h2: "text-2xl font-semibold",
      h3: "text-xl font-medium",
      h4: "text-lg font-medium",
      p: "text-md",
      label: "text-sm",
      footnote: "text-xs",
    },
    variant: {
      primary: "text-black dark:text-white",
      secondary: "text-zinc-600 dark:text-zinc-400",
      destructive: "text-destructive",
      success: "text-green-500",
    },
  },
  defaultVariants: {
    type: "p",
    variant: "primary",
  },
});

type TypographyProps = {} & React.HTMLAttributes<HTMLHeadingElement> & VariantProps<typeof typographyVariants>

const Typography = forwardRefIfNeeded<HTMLHeadingElement, TypographyProps>(
  ({ className, type, variant, ...props }, ref) => {
    const Comp = (type === 'footnote' || type === 'label' ? 'p' : type) || 'p';
    return (
      <Comp
        className={cn(typographyVariants({ type, variant, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Typography.displayName = "Typography";

export { Typography };
