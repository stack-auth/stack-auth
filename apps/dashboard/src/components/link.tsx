'use client';

import NextLink from 'next/link'; // eslint-disable-line no-restricted-imports
import React from "react";

import { UrlPrefetcher } from '@/lib/prefetch/url-prefetcher';
import { cn } from "../lib/utils";
import { useRouter, useRouterConfirm } from "./router";

type LinkProps = {
  href: string | URL,
  children: React.ReactNode,
  className?: string,
  target?: string,
  onClick?: () => void,
  style?: React.CSSProperties,
  prefetch?: boolean,
  scroll?: boolean,
};

export const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(({ onClick, href, ...rest }, ref) => {
  const router = useRouter();
  const { needConfirm } = useRouterConfirm();

  return <NextLink
    ref={ref}
    href={href}
    {...rest}
    onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
      if (needConfirm) {
        e.preventDefault();
        onClick?.();
        router.push(href.toString());
      }
      onClick?.();
    }}
  >
    <UrlPrefetcher href={href} />
    {rest.children}
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
