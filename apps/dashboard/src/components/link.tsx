'use client';

import { cn } from "../lib/utils";
// eslint-disable-next-line
import NextLink from 'next/link';
import React from "react";
import { useRouter, useRouterConfirm } from "./router";

type LinkProps = {
  href: string,
  children: React.ReactNode,
  className?: string,
  target?: string,
  onClick?: () => void,
  style?: React.CSSProperties,
  prefetch?: boolean,
};

export const Link = React.forwardRef<HTMLAnchorElement, LinkProps>((props, ref) => {
  const router = useRouter();
  const { needConfirm } = useRouterConfirm();

  return <NextLink
    ref={ref}
    href={props.href}
    target={props.target}
    className={props.className}
    prefetch={props.prefetch}
    style={props.style}
    onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
      if (needConfirm) {
        e.preventDefault();
        props.onClick?.();
        router.push(props.href);
      }
      props.onClick?.();
    }}
  >
    {props.children}
  </NextLink>;

});
Link.displayName = 'Link';

export function StyledLink(props: LinkProps) {
  return (
    <Link {...props} className={cn("text-blue-500 underline", props.className)}>
      {props.children}
    </Link>
  );
}
