import React from "react";

import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { forwardRefIfNeeded } from "@stackframe/stack-shared/dist/utils/react";
import { Input } from "@stackframe/stack-ui";

export const SearchBar = forwardRefIfNeeded<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>((props, ref) => (
  <div className="relative">
    <Input ref={ref} className="pl-8" {...props} />
    <MagnifyingGlassIcon className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
  </div>
));

SearchBar.displayName = "SearchBar";
