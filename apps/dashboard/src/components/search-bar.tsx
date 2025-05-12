import React from "react";

import { Input } from "@stackframe/stack-ui";
import { Search } from "lucide-react";
import { forwardRefIfNeeded } from "@stackframe/stack-shared/dist/utils/react";

export const SearchBar = forwardRefIfNeeded<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>((props, ref) => (
  <div className="relative">
    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
    <Input ref={ref} className="pl-8" {...props} />
  </div>
));

SearchBar.displayName = "SearchBar";
