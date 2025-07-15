import { componentWrapper } from "@stackframe/stack-shared/dist/utils/react";
import { cn } from "../../../../../packages/stack-ui/dist/lib/utils";

export const PacificaSurface = componentWrapper<
  "div",
  {}
>("PacificaSurface", ({ children, className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      data-pacifica-children-flex-grow
      className={cn("relative flex flex-col stretch min-h-0", className)}
      {...props}
    >
      <div
        className="absolute inset-0 rounded-[inherit]"
        style={{
          zIndex: -9999999,
        }}
        inert
        data-pacifica-surface
      />
      {children}
    </div>
  );
});
