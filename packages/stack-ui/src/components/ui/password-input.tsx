"use client";

import { useState } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { Button } from "./button";
import { Input, InputProps } from "./input";
import { cn } from "../../lib/utils";
import { forwardRefIfNeeded } from "@stackframe/stack-shared/dist/utils/react";

const PasswordInput = forwardRefIfNeeded<HTMLInputElement, InputProps>(
	({ className, ...props }, ref) => {
	  const [showPassword, setShowPassword] = useState(false);

	  return (
	    <div className="relative">
	      <Input
	        type={showPassword ? "text" : "password"}
	        className={cn("stack-scope hide-password-toggle pr-10", className)}
	        ref={ref}
	        {...props}
	      />
	      <Button
	        type="button"
	        variant="ghost"
	        size="sm"
	        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
	        onClick={() => setShowPassword((prev) => !prev)}
	        disabled={props.disabled}
	        aria-label={showPassword ? "Hide password" : "Show password"}
	        tabIndex={-1}
	      >
	        {showPassword ? (
	          <EyeIcon
	            className="h-4 w-4"
	            aria-hidden="true"
	          />
	        ) : (
	          <EyeOffIcon
	            className="h-4 w-4"
	            aria-hidden="true"
	          />
	        )}
	      </Button>
	    </div>
	  );
	},
);
PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
