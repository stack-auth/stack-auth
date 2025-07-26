'use client';

import { cn } from "../lib/utils";
// eslint-disable-next-line
import NextLink from 'next/link';
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
        router.push(props.href);
      }
      props.onClick?.();
    }}
  >
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
