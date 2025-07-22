import { componentWrapper, forwardRefIfNeeded } from "@stackframe/stack-shared/dist/utils/react";

import { filterUndefined } from "@stackframe/stack-shared/dist/utils/objects";
import { cn } from "../../lib/utils";
import { PacificaSurface } from "./surface";

const PacificaCard = componentWrapper<
  typeof PacificaSurface,
  {
    title?: React.ReactNode,
    subtitle?: React.ReactNode,
    header?: React.ReactNode,
    footer?: React.ReactNode,
    innerProps?: Omit<React.ComponentPropsWithRef<"div">, "children">,
  }
>("PacificaCard", ({ className, title, subtitle, header, footer, children, innerProps, ...props }, ref) => {
  const fullHeader = (title || subtitle || header || footer) && <>
    {header}
    {title && (
      <h3
        ref={ref}
        className={cn("font-semibold leading-none tracking-tight capitalize", className)}
      >
        {title}
      </h3>
    )}
    {subtitle && (
      <h4
        ref={ref}
        className={cn("text-sm text-muted-foreground", className)}
      >
        {subtitle}
      </h4>
    )}
  </>;
  return (
    <PacificaSurface
      ref={ref}
      className={cn(
        "rounded-xl",
        className
      )}
      {...filterUndefined(props)}
    >
      <div
        className="p-6 overflow-y-auto rounded-[inherit] flex-grow-1"
        data-pacifica-border
      >
        {fullHeader && (
          <div className="flex flex-col space-y-0.5 pb-4">
            {fullHeader}
          </div>
        )}
        <div {...innerProps}>
          {children}
        </div>
      </div>
    </PacificaSurface>
  );
});
PacificaCard.displayName = "PacificaCard";

const PacificaCardHeader = forwardRefIfNeeded<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6 pb-0", className)}
    {...props}
  />
));
PacificaCardHeader.displayName = "PacificaCardHeader";

const PacificaCardTitle = forwardRefIfNeeded<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn("font-semibold leading-none tracking-tight capitalize", className)}
    {...props}
  />
));
PacificaCardTitle.displayName = "PacificaCardTitle";

const PacificaCardDescription = forwardRefIfNeeded<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
PacificaCardDescription.displayName = "PacificaCardDescription";

const PacificaCardContent = forwardRefIfNeeded<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6", className)} {...props} />
));
PacificaCardContent.displayName = "PacificaCardContent";

const PacificaCardSubtitle = forwardRefIfNeeded<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <h4
    ref={ref}
    className={cn("text-sm text-muted-foreground font-bold", className)}
    {...props}
  />
));

const PacificaCardFooter = forwardRefIfNeeded<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
));
PacificaCardFooter.displayName = "PacificaCardFooter";

export { PacificaCard, PacificaCardContent, PacificaCardDescription, PacificaCardFooter, PacificaCardHeader, PacificaCardSubtitle, PacificaCardTitle };

