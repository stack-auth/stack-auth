'use client';

import NextLink from 'next/link'; // eslint-disable-line no-restricted-imports

import { UrlPrefetcher } from '@/lib/prefetch/url-prefetcher';
import React from "react";
import { cn } from "../lib/utils";
import { useRouter, useRouterConfirm } from "./router";

type LinkProps = {
  href: string | URL,
  children: React.ReactNode,
  className?: string,
  target?: string,
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void,
  style?: React.CSSProperties,
  scroll?: boolean,
  prefetch?: boolean | "auto",
  title?: string,
};

export const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(({ onClick, href, children, ...rest }, ref) => {
  const router = useRouter();
  const { needConfirm } = useRouterConfirm();

  return <NextLink
    ref={ref}
    href={href}
    {...rest}
    onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
      if (needConfirm) {
        // use our own router, which has a confirm dialog
        e.preventDefault();
        onClick?.(e);
        router.push(href.toString());
      } else {
        onClick?.(e);
      }
    }}
  >
    <UrlPrefetcher href={href} />
    {children}
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
