'use client';

import NextLink from 'next/link'; // eslint-disable-line no-restricted-imports

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
};

export function Link(props: LinkProps) {
  const router = useRouter();
  const { needConfirm } = useRouterConfirm();

  return <NextLink
    href={props.href}
    target={props.target}
    className={props.className}
    prefetch={props.prefetch}
    style={props.style}
    onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
      if (needConfirm) {
        e.preventDefault();
        props.onClick?.();
        router.push(props.href.toString());
      }
      props.onClick?.();
    }}
  >
    <UrlPrefetcher href={props.href} />
    {props.children}
  </NextLink>;

}

export function StyledLink(props: LinkProps) {
  return (
    <Link {...props} className={cn("text-blue-500 underline", props.className)}>
      {props.children}
    </Link>
  );
}
