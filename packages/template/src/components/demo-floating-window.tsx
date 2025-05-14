"use client";

import { Typography, buttonVariants, cn } from "@stackframe/stack-ui";
import { GripHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { UserAvatar, useStackApp, useUser } from "..";
import { Link } from "./link";

type Position = {
  x: number,
  y: number,
};

export function DemoFloatingWindow() {
  const [position, setPosition] = useState<Position>({ x: 20, y: 20 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState<Position>({ x: 0, y: 0 });
  const windowRef = useRef<HTMLDivElement>(null);
  const user = useUser();
  const app = useStackApp();
  const buttonClass = cn("w-full", buttonVariants({ variant: "outline" }));

  const handleMouseDown = (e: React.MouseEvent) => {
    if (windowRef.current) {
      const rect = windowRef.current.getBoundingClientRect();
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
      setIsDragging(true);
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragOffset.x,
          y: e.clientY - dragOffset.y,
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  return (
    <div
      ref={windowRef}
      className={cn(
        "stack-scope fixed flex flex-col gap-3 p-5 rounded-lg shadow-lg bg-background/50 backdrop-blur-sm border border-border w-64 select-none",
        isDragging && "cursor-grabbing"
      )}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        zIndex: 1000,
      }}
    >
      <div
        className="absolute top-0 left-0 right-0 h-6 bg-muted/70 rounded-t-lg cursor-grab flex items-center justify-center"
        onMouseDown={handleMouseDown}
      >
        <GripHorizontal className="w-4 h-4" />
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {user ? (
          <>
            <div className="flex items-center gap-2 mb-2">
              <UserAvatar />
              <div className="flex flex-col">
                <p className="text-sm font-medium">{user.displayName}</p>
                <p className="text-xs text-muted-foreground">{user.primaryEmail}</p>
              </div>
            </div>

            <Link
              className={buttonClass}
              href={app.urls.accountSettings}
            >
              Account Settings
            </Link>
            <Link
              className={buttonClass}
              href={app.urls.signOut}
            >
              Sign Out
            </Link>
          </>
        ) : (
          <>
            <Link
              className={buttonClass}
              href={app.urls.signIn}
            >
              Sign In
            </Link>
            <Link
              className={buttonClass}
              href={app.urls.signUp}
            >
              Sign Up
            </Link>
          </>
        )}
      </div>

      <div className="flex justify-center text-center">
        <Typography type='footnote' variant='secondary'>
          You can remove this window in the layout.tsx file.
        </Typography>
      </div>
    </div>
  );
}
