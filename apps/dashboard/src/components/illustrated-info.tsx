import { Typography } from "@stackframe/stack-ui";
import React from "react";

export function IllustratedInfo(options: {
  illustration: React.ReactNode,
  title: React.ReactNode,
  description: React.ReactNode[],
}) {
  return (
    <div className="flex flex-col items-center justify-center mx-auto">
      {/* Pricing Table Illustration */}
      <div className="w-full max-w-md mb-8">
        {options.illustration}
      </div>

      {/* Title */}
      <Typography type="h2" className="mb-4 text-center">
        {options.title}
      </Typography>

      {/* Subtitle */}
      <div className="text-muted-foreground text-center space-y-4 mb-8 max-w-2xl">
        {options.description.map((description, index) => (
          <Typography key={index} type="p" className="text-muted-foreground">
            {description}
          </Typography>
        ))}
      </div>
    </div>
  );
}
