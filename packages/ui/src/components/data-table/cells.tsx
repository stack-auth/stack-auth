
'use client';
import { DotsHorizontalIcon } from "@radix-ui/react-icons";
import React, { useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage, Badge, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, SimpleTooltip, cn } from "../..";

export function TextCell(props: { children: React.ReactNode, size?: number, icon?: React.ReactNode }) {
  const textRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const overflowStyle = "text-ellipsis text-nowrap overflow-x-hidden";

  useEffect(() => {
    const checkOverflow = () => {
      if (textRef.current) {
        const isOverflowing = textRef.current.scrollWidth > textRef.current.clientWidth;
        setIsOverflowing(isOverflowing);
      }
    };

    checkOverflow();
    window.addEventListener('resize', checkOverflow);
    return () => {
      window.removeEventListener('resize', checkOverflow);
    };
  }, []);

  return (
    <div className="relative" style={{ minWidth: props.size }}>
      <div className="flex items-center gap-2 absolute inset-0">
        <div className={overflowStyle} ref={textRef}>
          {isOverflowing ? (
            <SimpleTooltip tooltip={props.children}>
              <div className={overflowStyle}>
                {props.children}
              </div>
            </SimpleTooltip>
          ) : props.children}
        </div>
        {props.icon && <div>{props.icon}</div>}
      </div>
    </div>
  );
}

export function AvatarCell(props: { src?: string, fallback?: string }) {
  return (
    <Avatar className="h-6 w-6">
      <AvatarImage src={props.src} />
      <AvatarFallback>{props.fallback}</AvatarFallback>
    </Avatar>
  );
}

export function DateCell(props: { date: Date, ignoreAfterYears?: number }) {
  const ignore = !!props.ignoreAfterYears && new Date(new Date().setFullYear(new Date().getFullYear() + props.ignoreAfterYears)) < props.date;
  const timeString = props.date.toLocaleTimeString([], { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <TextCell size={140}>
      {ignore ? 'Never' : timeString}
    </TextCell>
  );
}

type ActionItem = '-' | {
  item: React.ReactNode,
  onClick: (e: React.MouseEvent) => void | Promise<void>,
  danger?: boolean,
  disabled?: boolean,
  disabledTooltip?: string,
}

export function ActionCell(props: {
  items?: ActionItem[],
  invisible?: boolean,
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "flex h-8 w-8 p-0 data-[state=open]:bg-muted",
            props.invisible && "invisible",
          )}
        >
          <DotsHorizontalIcon className="h-4 w-4" />
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[150px] max-w-[300px] stack-scope">
        {props.items?.map((item, index) => {
          if (item === '-') {
            return <DropdownMenuSeparator key={index} />;
          }

          const menuItemProps = {
            onClick: item.onClick,
            className: cn(item.danger ? "text-destructive" : ""),
            disabled: item.disabled
          };

          const menuItem = (
            <DropdownMenuItem {...menuItemProps} key={index}>
              {item.item}
            </DropdownMenuItem>
          );

          if (item.disabled && item.disabledTooltip) {
            return (
              <SimpleTooltip tooltip={item.disabledTooltip} key={index}>
                {React.cloneElement(menuItem, {
                  className: cn(menuItemProps.className, "opacity-50 cursor-not-allowed")
                })}
              </SimpleTooltip>
            );
          }

          return menuItem;
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BadgeCell(props: { badges: string[], size?: number }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {props.badges.map((badge, index) => (
        <Badge key={index} variant="secondary">{badge}</Badge>
      ))}
    </div>
  );
}
