'use client';

import { cn } from "@stackframe/stack-ui";
import NextLink from 'next/link'; // THIS_LINE_PLATFORM next

type LinkProps = {
  href: string,
  children: React.ReactNode,
  className?: string,
  target?: string,
  onClick?: React.MouseEventHandler<HTMLAnchorElement>,
  prefetch?: boolean,
};

function Link(props: LinkProps) {
  // IF_PLATFORM next
  return <NextLink
    href={props.href}
    target={props.target}
    className={props.className}
    prefetch={props.prefetch}
    onClick={props.onClick}
  >
    {props.children}
  </NextLink>;
  // ELSE_PLATFORM
  return <a
    href={props.href}
    target={props.target}
    className={props.className}
    onClick={props.onClick}
  >
    {props.children}
  </a>;
  // END_PLATFORM
}

function StyledLink(props: LinkProps) {
  return (
    <Link {...props} className={cn("underline font-medium", props.className)}>
      {props.children}
    </Link>
  );
}

export { Link, StyledLink };
