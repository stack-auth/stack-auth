'use client';
import { usePathname } from 'fumadocs-core/framework';
import Link from 'fumadocs-core/link';
import {
  type AnchorHTMLAttributes,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { isActive } from '../../lib/is-active';

type BaseItem = {
  /**
   * Restrict where the item is displayed
   *
   * @defaultValue 'all'
   */
  on?: 'menu' | 'nav' | 'all',
}

export type BaseLinkType = {
  url: string,
  /**
   * When the item is marked as active
   *
   * @defaultValue 'url'
   */
  active?: 'url' | 'nested-url' | 'none',
  external?: boolean,
} & BaseItem

export type MainItemType = {
  type?: 'main',
  icon?: ReactNode,
  text: ReactNode,
  description?: ReactNode,
} & BaseLinkType

export type IconItemType = {
  type: 'icon',
  /**
   * `aria-label` of icon button
   */
  label?: string,
  icon: ReactNode,
  text: ReactNode,
  /**
   * @defaultValue true
   */
  secondary?: boolean,
} & BaseLinkType
type ButtonItem = {
  type: 'button',
  icon?: ReactNode,
  text: ReactNode,
  /**
   * @defaultValue false
   */
  secondary?: boolean,
} & BaseLinkType

export type MenuItemType = {
  type: 'menu',
  icon?: ReactNode,
  text: ReactNode,

  url?: string,
  items: (
    | (MainItemType & {
        /**
         * Options when displayed on navigation menu
         */
        menu?: HTMLAttributes<HTMLElement> & {
          banner?: ReactNode,
        },
      })
    | CustomItem
  )[],

  /**
   * @defaultValue false
   */
  secondary?: boolean,
} & BaseItem

type CustomItem = {
  type: 'custom',
  /**
   * @defaultValue false
   */
  secondary?: boolean,
  children: ReactNode,
} & BaseItem

export type LinkItemType =
  | MainItemType
  | IconItemType
  | ButtonItem
  | MenuItemType
  | CustomItem;

export const BaseLinkItem = forwardRef<
  HTMLAnchorElement,
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { item: BaseLinkType }
>(({ item, ...props }, ref) => {
  const pathname = usePathname();
  const activeType = item.active ?? 'url';
  const active =
    activeType !== 'none' &&
    isActive(item.url, pathname, activeType === 'nested-url');

  return (
    <Link
      ref={ref}
      href={item.url}
      external={item.external}
      {...props}
      data-active={active}
    >
      {props.children}
    </Link>
  );
});

BaseLinkItem.displayName = 'BaseLinkItem';
