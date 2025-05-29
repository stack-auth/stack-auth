import Link from 'fumadocs-core/link';
import type { PageTree } from 'fumadocs-core/server';
import {
  NavProvider,
  type PageStyles,
  StylesProvider,
} from 'fumadocs-ui/contexts/layout';
import { TreeContextProvider } from 'fumadocs-ui/contexts/tree';
import { Languages, Sidebar as SidebarIcon } from 'lucide-react';
import { type HTMLAttributes, type ReactNode, useMemo } from 'react';
import { cn } from '../../lib/cn';
import {
  LanguageToggle,
  LanguageToggleText,
} from '../layout/language-toggle';
import { RootToggle } from '../layout/root-toggle';
import {
  LargeSearchToggle,
  SearchToggle,
} from '../layout/search-toggle';
import {
  Sidebar,
  SidebarCollapseTrigger,
  SidebarFooter,
  SidebarHeader,
  SidebarPageTree,
  SidebarViewport,
} from '../layout/sidebar';
import { ThemeToggle } from '../layout/theme-toggle';
import { buttonVariants } from '../ui/button';
import { HideIfEmpty } from '../ui/hide-if-empty';
import {
  CollapsibleControl,
  Navbar,
  NavbarSidebarTrigger,
} from './docs-client';
import {
  getSidebarTabsFromOptions,
  layoutVariables,
  SidebarLinkItem,
  type SidebarOptions,
} from './docs/shared';
import {
  BaseLinkItem,
  type IconItemType,
  type LinkItemType,
} from './links';
import { type BaseLayoutProps, getLinks, omit, slot, slots } from './shared';

export interface DocsLayoutProps extends BaseLayoutProps {
  tree: PageTree.Root;

  sidebar?: Partial<SidebarOptions> & {
    enabled?: boolean;
    component?: ReactNode;
  };

  /**
   * Props for the `div` container
   */
  containerProps?: HTMLAttributes<HTMLDivElement>;
}

export function DocsLayout({
  nav: { transparentMode, ...nav } = {},
  sidebar = {},
  searchToggle,
  disableThemeSwitch = false,
  themeSwitch = { enabled: !disableThemeSwitch },
  i18n = false,
  children,
  ...props
}: DocsLayoutProps): ReactNode {
  const tabs = useMemo(
    () => getSidebarTabsFromOptions(sidebar.tabs, props.tree) ?? [],
    [sidebar.tabs, props.tree],
  );
  const links = getLinks(props.links ?? [], props.githubUrl);

  const variables = cn(
    '[--fd-tocnav-height:36px] md:[--fd-sidebar-width:268px] lg:[--fd-sidebar-width:290px] xl:[--fd-toc-width:290px] xl:[--fd-tocnav-height:0px]',
    !nav.component && nav.enabled !== false
      ? '[--fd-nav-height:56px] md:[--fd-nav-height:0px]'
      : undefined,
  );

  const pageStyles: PageStyles = {
    tocNav: cn('xl:hidden'),
    toc: cn('max-xl:hidden'),
  };

  return (
    <TreeContextProvider tree={props.tree}>
      <NavProvider transparentMode={transparentMode}>
        {slot(
          nav,
          <Navbar className="h-14 md:hidden">
            <Link
              href={nav.url ?? '/'}
              className="inline-flex items-center gap-2.5 font-semibold"
            >
              {nav.title}
            </Link>
            <div className="flex-1">{nav.children}</div>
            {slots('sm', searchToggle, <SearchToggle hideIfDisabled />)}
            <NavbarSidebarTrigger className="-me-2 md:hidden" />
          </Navbar>,
        )}
        <main
          id="nd-docs-layout"
          {...props.containerProps}
          className={cn(
            'flex flex-1 flex-row pe-(--fd-layout-offset)',
            variables,
            props.containerProps?.className,
          )}
          style={{
            ...layoutVariables,
            ...props.containerProps?.style,
          }}
        >
          {slot(
            sidebar,
            <DocsLayoutSidebar
              {...omit(sidebar, 'enabled', 'component', 'tabs')}
              links={links}
              nav={
                <>
                  <Link
                    href={nav.url ?? '/'}
                    className="inline-flex text-[15px] items-center gap-2.5 font-medium"
                  >
                    {nav.title}
                  </Link>
                  {nav.children}
                </>
              }
              banner={
                <>
                  {tabs.length > 0 ? <RootToggle options={tabs} /> : null}
                  {slots(
                    'lg',
                    searchToggle,
                    <LargeSearchToggle
                      hideIfDisabled
                      className="max-md:hidden"
                    />,
                  )}
                  {sidebar.banner}
                </>
              }
              footer={
                <>
                  <DocsLayoutSidebarFooter
                    links={links.filter((item) => item.type === 'icon')}
                    i18n={i18n}
                    themeSwitch={themeSwitch}
                  />
                  {sidebar.footer}
                </>
              }
            />,
          )}
          <StylesProvider {...pageStyles}>{children}</StylesProvider>
        </main>
      </NavProvider>
    </TreeContextProvider>
  );
}

export function DocsLayoutSidebar({
  collapsible = true,
  components,
  nav,
  links = [],
  footer,
  banner,
  ...props
}: Omit<SidebarOptions, 'tabs'> & {
  links?: LinkItemType[];
  nav?: ReactNode;
}) {
  return (
    <>
      {collapsible ? <CollapsibleControl /> : null}
      <Sidebar
        {...props}
        collapsible={collapsible}
        className={cn(
          'data-[collapsed=false]:w-[calc(var(--fd-sidebar-width)+var(--fd-layout-offset))] data-[collapsed=true]:me-[calc(var(--fd-layout-offset)-var(--fd-sidebar-width))]',
          props.className,
        )}
      >
        <HideIfEmpty>
          <SidebarHeader>
            <div className="flex max-md:hidden">
              {nav}
              {collapsible && (
                <SidebarCollapseTrigger
                  className={cn(
                    buttonVariants({
                      color: 'ghost',
                      size: 'icon-sm',
                    }),
                    'ms-auto mb-auto text-fd-muted-foreground max-md:hidden',
                  )}
                >
                  <SidebarIcon />
                </SidebarCollapseTrigger>
              )}
            </div>
            {banner}
          </SidebarHeader>
        </HideIfEmpty>
        <SidebarViewport>
          {links
            .filter((v) => v.type !== 'icon')
            .map((item, i, list) => (
              <SidebarLinkItem
                key={i}
                item={item}
                className={cn(i === list.length - 1 && 'mb-4')}
              />
            ))}
          <SidebarPageTree components={components} />
        </SidebarViewport>
        <HideIfEmpty>
          <SidebarFooter>{footer}</SidebarFooter>
        </HideIfEmpty>
      </Sidebar>
    </>
  );
}

export function DocsLayoutSidebarFooter({
  i18n,
  themeSwitch,
  links = [],
}: {
  i18n?: DocsLayoutProps['i18n'];
  links?: IconItemType[];
  themeSwitch?: DocsLayoutProps['themeSwitch'];
}) {
  return (
    <HideIfEmpty>
      <div className="flex items-center justify-end">
        <div className="flex items-center flex-1 empty:hidden">
          {links.map((item, i) => (
            <BaseLinkItem
              key={i}
              item={item}
              className={cn(
                buttonVariants({ size: 'icon', color: 'ghost' }),
                'text-fd-muted-foreground md:[&_svg]:size-4.5',
              )}
              aria-label={item.label}
            >
              {item.icon}
            </BaseLinkItem>
          ))}
        </div>
        {i18n ? (
          <LanguageToggle className="me-1.5">
            <Languages className="size-4.5" />
            <LanguageToggleText className="md:hidden" />
          </LanguageToggle>
        ) : null}
        {slot(
          themeSwitch,
          <ThemeToggle className="p-0" mode={themeSwitch?.mode} />,
        )}
      </div>
    </HideIfEmpty>
  );
}

export { getSidebarTabsFromOptions } from './docs/shared';
export { CollapsibleControl, Navbar, NavbarSidebarTrigger, type LinkItemType };

