'use client';


//===========================================
// THIS FILE IS AUTO-GENERATED FROM TEMPLATE. DO NOT EDIT IT DIRECTLY
//===========================================

import { cn } from "@stackframe/stack-ui";

type LinkProps = {
  href: string,
  children: React.ReactNode,
  className?: string,
  target?: string,
  onClick?: React.MouseEventHandler<HTMLAnchorElement>,
  prefetch?: boolean,
};

function Link(props: LinkProps) {
  return <a
    href={props.href}
    target={props.target}
    className={props.className}
    onClick={props.onClick}
  >
    {props.children}
  </a>;
}

function StyledLink(props: LinkProps) {
  return (
    <Link {...props} className={cn("underline font-medium", props.className)}>
      {props.children}
    </Link>
  );
}

export { Link, StyledLink };
