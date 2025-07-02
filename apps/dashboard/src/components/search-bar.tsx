import React from "react";

import { forwardRefIfNeeded } from "@stackframe/stack-shared/dist/utils/react";
import { Input } from "@stackframe/stack-ui";
import { Search } from "lucide-react";

export const SearchBar = forwardRefIfNeeded<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>((props, ref) => (
  <div className="relative">
    <Input ref={ref} className="pl-8" {...props} />
    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
  </div>
));

SearchBar.displayName = "SearchBar";
