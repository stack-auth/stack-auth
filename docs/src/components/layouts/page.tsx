'use client';

import type { TableOfContents } from 'fumadocs-core/server';
import { AnchorProvider, type AnchorProviderProps } from 'fumadocs-core/toc';
import { I18nLabel } from 'fumadocs-ui/contexts/i18n';
import { Edit, Text } from 'lucide-react';
import { type ComponentProps, forwardRef, lazy, type ReactNode, useEffect } from 'react';
import { cn } from '../../lib/cn';
import {
  Toc,
  TOCItems,
  type TOCProps,
  TOCScrollArea,
} from '../layout/toc';
import {
  Breadcrumb,
  type BreadcrumbProps,
  Footer,
  type FooterProps,
  LastUpdate,
  PageArticle,
  PageBody
} from '../page-client';
import { BackToTop } from '../ui/back-to-top';
import { buttonVariants } from '../ui/button';
import { slot } from './shared';
import { useSidebar } from './sidebar-context';

const ClerkTOCItems = lazy(() => import('@/components/layout/toc-clerk'));

type TableOfContentOptions = Omit<TOCProps, 'items' | 'children'> &
  Pick<AnchorProviderProps, 'single'> & {
    enabled: boolean,
    component: ReactNode,

    /**
     * @defaultValue 'normal'
     */
    style?: 'normal' | 'clerk',
  };

type TableOfContentPopoverOptions = Omit<TableOfContentOptions, 'single'>;

type EditOnGitHubOptions = {
  owner: string,
  repo: string,

  /**
   * SHA or ref (branch or tag) name.
   *
   * @defaultValue main
   */
  sha?: string,

  /**
   * File path in the repo
   */
  path: string,
} & Omit<ComponentProps<'a'>, 'href' | 'children'>

type BreadcrumbOptions = {
  enabled: boolean,
  component: ReactNode,

  /**
   * Show the full path to the current page
   *
   * @defaultValue false
   * @deprecated use `includePage` instead
   */
  full?: boolean,
} & BreadcrumbProps

type FooterOptions = {
  enabled: boolean,
  component: ReactNode,
} & FooterProps

export type DocsPageProps = {
  toc?: TableOfContents,

  /**
   * Extend the page to fill all available space
   *
   * @defaultValue false
   */
  full?: boolean,

  tableOfContent?: Partial<TableOfContentOptions>,
  tableOfContentPopover?: Partial<TableOfContentPopoverOptions>,

  /**
   * Replace or disable breadcrumb
   */
  breadcrumb?: Partial<BreadcrumbOptions>,

  /**
   * Footer navigation, you can disable it by passing `false`
   */
  footer?: Partial<FooterOptions>,

  editOnGithub?: EditOnGitHubOptions,
  lastUpdate?: Date | string | number,

  container?: ComponentProps<'div'>,
  article?: ComponentProps<'article'>,
  children: ReactNode,
}

export function DocsPage({
  toc = [],
  full = false,
  editOnGithub,
  tableOfContent: {
    enabled: tocEnabled,
    component: tocReplace,
    ...tocOptions
  } = {},
  ...props
}: DocsPageProps) {
  const sidebarContext = useSidebar();
  const { setIsFullPage } = sidebarContext || {
    setIsFullPage: () => {},
  };

  // Update the full page state in the context
  useEffect(() => {
    setIsFullPage(full);

    // Cleanup: reset to false when component unmounts
    return () => setIsFullPage(false);
  }, [full, setIsFullPage]);

  const isTocRequired =
    toc.length > 0 ||
    tocOptions.footer !== undefined ||
    tocOptions.header !== undefined;

  // disable TOC on full mode, you can still enable it with `enabled` option.
  tocEnabled ??= !full && isTocRequired;

  return (
    <AnchorProvider toc={toc} single={tocOptions.single}>
      <PageBody
        {...props.container}
        className={cn('custom-scrollbar', props.container?.className)}
        style={
          {
            '--fd-tocnav-height': '0px',
            ...props.container?.style,
          } as object
        }
      >
        <PageArticle
          {...props.article}
          className={cn('relative', props.article?.className)}
        >
          {slot(props.breadcrumb, <Breadcrumb {...props.breadcrumb} />)}
          <div className="mb-12">
            {props.children}
          </div>
          <div role="none" className="flex-1" />
          <div className="flex flex-row flex-wrap items-center justify-between gap-4 empty:hidden mt-16 pt-4 border-t border-dashed border-fd-border/20">
            {editOnGithub && (
              <EditOnGitHub
                href={`https://github.com/${editOnGithub.owner}/${editOnGithub.repo}/blob/${editOnGithub.sha}/${editOnGithub.path.startsWith('/') ? editOnGithub.path.slice(1) : editOnGithub.path}`}
              />
            )}
            {props.lastUpdate && (
              <LastUpdate date={new Date(props.lastUpdate)} />
            )}
          </div>
          {slot(props.footer, <Footer items={props.footer?.items} />)}
        </PageArticle>
      </PageBody>
      {slot(
        { enabled: tocEnabled, component: tocReplace },
        <Toc>
          {tocOptions.header}
          <h3 className="inline-flex items-center gap-1.5 text-sm text-fd-muted-foreground font-semibold mb-2">
            <Text className="size-4" />
            <I18nLabel label="toc" />
          </h3>
          <TOCScrollArea className="custom-scrollbar">
            {tocOptions.style === 'clerk' ? (
              <ClerkTOCItems items={toc} />
            ) : (
              <TOCItems items={toc} />
            )}
          </TOCScrollArea>
          {tocOptions.footer}
        </Toc>,
        {
          items: toc,
          ...tocOptions,
        },
      )}
      <BackToTop />
    </AnchorProvider>
  );
}

export function EditOnGitHub(props: ComponentProps<'a'>) {
  return (
    <a
      target="_blank"
      rel="noreferrer noopener"
      {...props}
      className={cn(
        buttonVariants({
          color: 'secondary',
          size: 'sm',
          className: 'gap-1.5 not-prose',
        }),
        props.className,
      )}
    >
      {props.children ?? (
        <>
          <Edit className="size-3.5" />
          <I18nLabel label="editOnGithub" />
        </>
      )}
    </a>
  );
}

/**
 * Add typography styles
 */
export const DocsBody = forwardRef<HTMLDivElement, ComponentProps<'div'>>(
  (props, ref) => (
    <div ref={ref} {...props} className={cn('prose prose-neutral dark:prose-invert max-w-none', props.className)}>
      {props.children}
    </div>
  ),
);

DocsBody.displayName = 'DocsBody';

export const DocsDescription = forwardRef<
  HTMLParagraphElement,
  ComponentProps<'p'>
>((props, ref) => {
  // don't render if no description provided
  if (props.children === undefined) return null;

  return (
    <p
      ref={ref}
      {...props}
      className={cn('mb-6 text-base text-fd-muted-foreground leading-relaxed', props.className)}
    >
      {props.children}
    </p>
  );
});

DocsDescription.displayName = 'DocsDescription';

export const DocsTitle = forwardRef<HTMLHeadingElement, ComponentProps<'h1'>>(
  (props, ref) => {
    return (
      <h1
        ref={ref}
        {...props}
        className={cn('text-4xl font-bold mb-4', props.className)}
      >
        {props.children}
      </h1>
    );
  },
);

DocsTitle.displayName = 'DocsTitle';

/**
 * For separate MDX page
 */
export function withArticle(props: ComponentProps<'main'>): ReactNode {
  return (
    <main {...props} className={cn('container py-12', props.className)}>
      <article className="prose">{props.children}</article>
    </main>
  );
}
