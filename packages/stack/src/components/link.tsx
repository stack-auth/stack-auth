'use client';


//===========================================
// THIS FILE IS AUTO-GENERATED FROM TEMPLATE. DO NOT EDIT IT DIRECTLY, INSTEAD EDIT THE CORRESPONDING FILE IN packages/template
//===========================================

import { cn } from "@hexclave/ui";
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
  return <NextLink
    href={props.href}
    target={props.target}
    className={props.className}
    prefetch={props.prefetch}
    onClick={props.onClick}
  >
    {props.children}
  </NextLink>;
}

function StyledLink(props: LinkProps) {
  return (
    <Link {...props} className={cn("underline font-medium", props.className)}>
      {props.children}
    </Link>
  );
}

export { Link, StyledLink };
