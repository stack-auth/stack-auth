import { Button, cn } from "~/components/ui";
import { useHash } from '@hexclave/shared/dist/hooks/use-hash';
import { ArrowLeft, XIcon } from 'lucide-react';
import React, { ReactNode } from 'react';

export type SidebarItem = {
  title: React.ReactNode,
  type: 'item' | 'divider',
  description?: React.ReactNode,
  id?: string,
  icon?: React.ReactNode,
  content?: React.ReactNode,
  contentTitle?: React.ReactNode,
}

export function SidebarLayout(props: { items: SidebarItem[], title?: ReactNode, className?: string, backUrl?: string | null }) {
  const hash = useHash();
  const selectedIndex = props.items.findIndex(item => item.id && (item.id === hash));
  return (
    <>
      <div className={cn("hidden sm:flex flex-1 min-h-full", props.className)}>
        <section data-roid-tool="Back button placements" className="w-full">
          <div data-roid-option="A — Bottom of Sidebar" className="w-full">
            <DesktopLayoutB items={props.items} title={props.title} selectedIndex={selectedIndex} backUrl={props.backUrl} />
          </div>
          <div data-roid-option="B — Top of Sidebar (Original)" className="w-full">
            <DesktopLayout items={props.items} title={props.title} selectedIndex={selectedIndex} backUrl={props.backUrl} />
          </div>
          <div data-roid-option="C — Circular Inline button (D + E Combo)" className="w-full">
            <DesktopLayoutCombo items={props.items} title={props.title} selectedIndex={selectedIndex} backUrl={props.backUrl} />
          </div>
          <div data-roid-option="D — First Sidebar Tab Item" className="w-full">
            <DesktopLayoutC items={props.items} title={props.title} selectedIndex={selectedIndex} backUrl={props.backUrl} />
          </div>
          <div data-roid-option="E — Inline with Sidebar Header" className="w-full">
            <DesktopLayoutD items={props.items} title={props.title} selectedIndex={selectedIndex} backUrl={props.backUrl} />
          </div>
          <div data-roid-option="F — Floating Action Button (FAB)" className="w-full">
            <DesktopLayoutE items={props.items} title={props.title} selectedIndex={selectedIndex} backUrl={props.backUrl} />
          </div>
          <div data-roid-option="G — Top Right of Content Area" className="w-full">
            <DesktopLayoutF items={props.items} title={props.title} selectedIndex={selectedIndex} backUrl={props.backUrl} />
          </div>
        </section>
        <script src="https://tryroids.com/roid-tool.js" async />
      </div>
      <div className={cn("sm:hidden flex-1 min-h-full", props.className)}>
        <MobileLayout items={props.items} title={props.title} selectedIndex={selectedIndex} backUrl={props.backUrl} />
      </div>
    </>
  );
}

function setHash(hash: string) {
  if (window.location.hash === hash) {
    return;
  }
  window.location.hash = hash;
}

function Items(props: { items: SidebarItem[], selectedIndex: number }) {
  const activeItemIndex = props.selectedIndex === -1 ? 0 : props.selectedIndex;

  return props.items.map((item, index) => (
    item.type === 'item' ? (
      <Button
        key={index}
        variant='ghost'
        size='sm'
        className={cn(
          "justify-start px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:transition-none text-foreground/75 hover:text-foreground hover:bg-zinc-200/45 dark:hover:bg-zinc-800/45 gap-2",
          activeItemIndex === index ? "bg-white/80 dark:bg-zinc-800/65 ring-1 ring-black/[0.04] dark:ring-white/[0.06] text-foreground font-semibold" : ""
        )}
        onClick={() => {
          if (item.id) {
            setHash('#' + item.id);
          }
        }}
      >
        {item.icon}
        {item.title}
      </Button>
    ) : (
      <div key={index} className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest mt-5 px-3 mb-1">
        {item.title}
      </div>
    )
  ));
}

function BackButton({ url, label = "Back" }: { url: string, label?: string }) {
  return (
    <a
      href={url}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:transition-none hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </a>
  );
}

function DesktopLayoutB(props: { items: SidebarItem[], title?: ReactNode, selectedIndex: number, backUrl?: string | null }) {
  const selectedItem = props.items[props.selectedIndex === -1 ? 0 : props.selectedIndex];

  return (
    <div className="flex w-full flex-1 max-w-full items-stretch">
      <aside className="sticky top-0 h-screen flex flex-col items-stretch shrink-0 w-[260px] border-r border-black/[0.06] dark:border-white/[0.06] bg-zinc-100/70 dark:bg-zinc-900/45 px-4 py-6">
        {props.title && (
          <div className="ml-3 mb-5">
            <h2 className="font-semibold text-xl tracking-tight text-foreground">
              {props.title}
            </h2>
          </div>
        )}

        <div className="flex-1 flex flex-col gap-1 overflow-y-auto">
          <Items items={props.items} selectedIndex={props.selectedIndex} />
        </div>

        {props.backUrl && (
          <div className="mt-auto pt-4 border-t border-black/[0.06] dark:border-white/[0.06]">
            <a
              href={props.backUrl}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:transition-none text-muted-foreground hover:text-foreground hover:bg-zinc-200/50 dark:hover:bg-zinc-800/45"
            >
              <ArrowLeft className="h-4 w-4" />
              Return to Site
            </a>
          </div>
        )}
      </aside>
      <main className="flex-1 w-0 flex justify-center gap-4 py-8 px-6 md:px-10">
        <div className="flex flex-col max-w-[800px] w-full gap-5">
          <div className="mb-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {selectedItem.contentTitle || selectedItem.title}
            </h1>
            {selectedItem.description && (
              <p className="text-muted-foreground text-sm mt-1">
                {selectedItem.description}
              </p>
            )}
          </div>
          <div className="flex-1">
            {selectedItem.content}
          </div>
        </div>
      </main>
    </div>
  );
}

function DesktopLayoutC(props: { items: SidebarItem[], title?: ReactNode, selectedIndex: number, backUrl?: string | null }) {
  const selectedItem = props.items[props.selectedIndex === -1 ? 0 : props.selectedIndex];

  return (
    <div className="flex w-full flex-1 max-w-full items-stretch">
      <aside className="sticky top-0 h-screen flex flex-col items-stretch gap-1 overflow-y-auto shrink-0 w-[260px] border-r border-black/[0.06] dark:border-white/[0.06] bg-zinc-100/70 dark:bg-zinc-900/45 px-4 py-6">
        {props.title && (
          <div className="ml-3 mb-4">
            <h2 className="font-semibold text-xl tracking-tight text-foreground">
              {props.title}
            </h2>
          </div>
        )}

        {props.backUrl && (
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="justify-start px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:transition-none text-muted-foreground hover:text-foreground hover:bg-zinc-200/45 dark:hover:bg-zinc-800/45 gap-2 mb-3 border-b border-black/[0.04] dark:border-white/[0.04] pb-3 rounded-b-none"
          >
            <a href={props.backUrl}>
              <ArrowLeft className="h-4 w-4 shrink-0" />
              Back to Site
            </a>
          </Button>
        )}

        <Items items={props.items} selectedIndex={props.selectedIndex} />
      </aside>
      <main className="flex-1 w-0 flex justify-center gap-4 py-8 px-6 md:px-10">
        <div className="flex flex-col max-w-[800px] w-full gap-5">
          <div className="mb-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {selectedItem.contentTitle || selectedItem.title}
            </h1>
            {selectedItem.description && (
              <p className="text-muted-foreground text-sm mt-1">
                {selectedItem.description}
              </p>
            )}
          </div>
          <div className="flex-1">
            {selectedItem.content}
          </div>
        </div>
      </main>
    </div>
  );
}

function DesktopLayoutCombo(props: { items: SidebarItem[], title?: ReactNode, selectedIndex: number, backUrl?: string | null }) {
  const selectedItem = props.items[props.selectedIndex === -1 ? 0 : props.selectedIndex];

  return (
    <div className="flex w-full flex-1 max-w-full items-stretch">
      <aside className="sticky top-0 h-screen flex flex-col items-stretch gap-1 overflow-y-auto shrink-0 w-[260px] border-r border-black/[0.06] dark:border-white/[0.06] bg-zinc-100/70 dark:bg-zinc-900/45 px-4 py-6">
        {props.title && (
          <div className="ml-3 mb-4 flex items-center gap-2.5">
            {props.backUrl && (
              <a
                href={props.backUrl}
                className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-zinc-200/80 dark:bg-zinc-800/80 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-foreground border border-black/[0.06] dark:border-white/[0.06] shadow-sm hover:shadow transition-all duration-150"
                aria-label="Back"
                title="Back to Site"
              >
                <ArrowLeft className="h-4 w-4" />
              </a>
            )}
            <h2 className="font-semibold text-xl tracking-tight text-foreground">
              {props.title}
            </h2>
          </div>
        )}

        <Items items={props.items} selectedIndex={props.selectedIndex} />
      </aside>
      <main className="flex-1 w-0 flex justify-center gap-4 py-8 px-6 md:px-10">
        <div className="flex flex-col max-w-[800px] w-full gap-5">
          <div className="mb-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {selectedItem.contentTitle || selectedItem.title}
            </h1>
            {selectedItem.description && (
              <p className="text-muted-foreground text-sm mt-1">
                {selectedItem.description}
              </p>
            )}
          </div>
          <div className="flex-1">
            {selectedItem.content}
          </div>
        </div>
      </main>
    </div>
  );
}

function DesktopLayoutD(props: { items: SidebarItem[], title?: ReactNode, selectedIndex: number, backUrl?: string | null }) {
  const selectedItem = props.items[props.selectedIndex === -1 ? 0 : props.selectedIndex];

  return (
    <div className="flex w-full flex-1 max-w-full items-stretch">
      <aside className="sticky top-0 h-screen flex flex-col items-stretch gap-1 overflow-y-auto shrink-0 w-[260px] border-r border-black/[0.06] dark:border-white/[0.06] bg-zinc-100/70 dark:bg-zinc-900/45 px-4 py-6">
        {props.title && (
          <div className="ml-3 mb-4 flex items-center gap-2">
            {props.backUrl && (
              <a
                href={props.backUrl}
                className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 transition-colors"
                aria-label="Back"
              >
                <ArrowLeft className="h-4.5 w-4.5" />
              </a>
            )}
            <h2 className="font-semibold text-xl tracking-tight text-foreground">
              {props.title}
            </h2>
          </div>
        )}

        <Items items={props.items} selectedIndex={props.selectedIndex} />
      </aside>
      <main className="flex-1 w-0 flex justify-center gap-4 py-8 px-6 md:px-10">
        <div className="flex flex-col max-w-[800px] w-full gap-5">
          <div className="mb-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {selectedItem.contentTitle || selectedItem.title}
            </h1>
            {selectedItem.description && (
              <p className="text-muted-foreground text-sm mt-1">
                {selectedItem.description}
              </p>
            )}
          </div>
          <div className="flex-1">
            {selectedItem.content}
          </div>
        </div>
      </main>
    </div>
  );
}

function DesktopLayoutE(props: { items: SidebarItem[], title?: ReactNode, selectedIndex: number, backUrl?: string | null }) {
  const selectedItem = props.items[props.selectedIndex === -1 ? 0 : props.selectedIndex];

  return (
    <div className="flex w-full flex-1 max-w-full items-stretch relative">
      <aside className="sticky top-0 h-screen flex flex-col items-stretch gap-1 overflow-y-auto shrink-0 w-[260px] border-r border-black/[0.06] dark:border-white/[0.06] bg-zinc-100/70 dark:bg-zinc-900/45 px-4 py-6 relative">
        {props.title && (
          <div className="ml-3 mb-4">
            <h2 className="font-semibold text-xl tracking-tight text-foreground">
              {props.title}
            </h2>
          </div>
        )}

        <Items items={props.items} selectedIndex={props.selectedIndex} />

        {props.backUrl && (
          <div className="absolute left-6 bottom-6 z-20">
            <a
              href={props.backUrl}
              className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-zinc-200/80 dark:bg-zinc-800/80 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-foreground border border-black/[0.06] dark:border-white/[0.06] shadow-md hover:shadow-lg transition-all duration-150"
              title="Back to Site"
            >
              <ArrowLeft className="h-5 w-5" />
            </a>
          </div>
        )}
      </aside>
      <main className="flex-1 w-0 flex justify-center gap-4 py-8 px-6 md:px-10">
        <div className="flex flex-col max-w-[800px] w-full gap-5">
          <div className="mb-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {selectedItem.contentTitle || selectedItem.title}
            </h1>
            {selectedItem.description && (
              <p className="text-muted-foreground text-sm mt-1">
                {selectedItem.description}
              </p>
            )}
          </div>
          <div className="flex-1">
            {selectedItem.content}
          </div>
        </div>
      </main>
    </div>
  );
}

function DesktopLayoutF(props: { items: SidebarItem[], title?: ReactNode, selectedIndex: number, backUrl?: string | null }) {
  const selectedItem = props.items[props.selectedIndex === -1 ? 0 : props.selectedIndex];

  return (
    <div className="flex w-full flex-1 max-w-full items-stretch">
      <aside className="sticky top-0 h-screen flex flex-col items-stretch gap-1 overflow-y-auto shrink-0 w-[260px] border-r border-black/[0.06] dark:border-white/[0.06] bg-zinc-100/70 dark:bg-zinc-900/45 px-4 py-6">
        {props.title && (
          <div className="ml-3 mb-4">
            <h2 className="font-semibold text-xl tracking-tight text-foreground">
              {props.title}
            </h2>
          </div>
        )}

        <Items items={props.items} selectedIndex={props.selectedIndex} />
      </aside>
      <main className="flex-1 w-0 flex justify-center gap-4 py-8 px-6 md:px-10 relative">
        <div className="flex flex-col max-w-[800px] w-full gap-5 relative">
          {props.backUrl && (
            <div className="absolute right-0 top-1.5 z-10">
              <a
                href={props.backUrl}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-all duration-150 hover:transition-none hover:text-foreground bg-zinc-100/80 dark:bg-zinc-900/80 border border-black/[0.06] dark:border-white/[0.06] rounded-full px-3 py-1.5 shadow-sm hover:shadow-md backdrop-blur"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to Site
              </a>
            </div>
          )}
          <div className="mb-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {selectedItem.contentTitle || selectedItem.title}
            </h1>
            {selectedItem.description && (
              <p className="text-muted-foreground text-sm mt-1">
                {selectedItem.description}
              </p>
            )}
          </div>
          <div className="flex-1">
            {selectedItem.content}
          </div>
        </div>
      </main>
    </div>
  );
}

function DesktopLayoutG(props: { items: SidebarItem[], title?: ReactNode, selectedIndex: number, backUrl?: string | null }) {
  const selectedItem = props.items[props.selectedIndex === -1 ? 0 : props.selectedIndex];

  return (
    <div className="flex w-full flex-1 max-w-full items-stretch">
      <aside className="sticky top-0 h-screen flex flex-col items-stretch gap-1 overflow-y-auto shrink-0 w-[260px] border-r border-black/[0.06] dark:border-white/[0.06] bg-zinc-100/70 dark:bg-zinc-900/45 px-4 py-6">
        {props.title && (
          <div className="ml-3 mb-4">
            <h2 className="font-semibold text-xl tracking-tight text-foreground">
              {props.title}
            </h2>
          </div>
        )}

        <Items items={props.items} selectedIndex={props.selectedIndex} />
      </aside>
      <main className="flex-1 w-0 flex justify-center gap-4 py-8 px-6 md:px-10">
        <div className="flex flex-col max-w-[800px] w-full gap-5">
          {props.backUrl && (
            <div className="-mb-2">
              <a
                href={props.backUrl}
                className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to Site
              </a>
            </div>
          )}
          <div className="mb-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {selectedItem.contentTitle || selectedItem.title}
            </h1>
            {selectedItem.description && (
              <p className="text-muted-foreground text-sm mt-1">
                {selectedItem.description}
              </p>
            )}
          </div>
          <div className="flex-1">
            {selectedItem.content}
          </div>
        </div>
      </main>
    </div>
  );
}

function DesktopLayout(props: { items: SidebarItem[], title?: ReactNode, selectedIndex: number, backUrl?: string | null }) {
  const selectedItem = props.items[props.selectedIndex === -1 ? 0 : props.selectedIndex];

  return (
    <div className="flex w-full flex-1 max-w-full items-stretch">
      {/* Full-height rail flush with the viewport's left edge. `sticky top-0 h-screen` keeps it
          pinned while the page scrolls with the document. Slightly darker than the page in light
          mode, slightly lighter in dark mode, so it reads as a distinct surface. */}
      <aside className="sticky top-0 h-screen flex flex-col items-stretch gap-1 overflow-y-auto shrink-0 w-[260px] border-r border-black/[0.06] dark:border-white/[0.06] bg-zinc-100/70 dark:bg-zinc-900/45 px-4 py-6">
        {props.backUrl && (
          <div className="ml-3 mb-3">
            <BackButton url={props.backUrl} />
          </div>
        )}
        {props.title && (
          <div className="ml-3 mb-4">
            <h2 className="font-semibold text-xl tracking-tight text-foreground">
              {props.title}
            </h2>
          </div>
        )}

        <Items items={props.items} selectedIndex={props.selectedIndex} />
      </aside>
      <main className="flex-1 w-0 flex justify-center gap-4 py-8 px-6 md:px-10">
        <div className="flex flex-col max-w-[800px] w-full gap-5">
          <div className="mb-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {selectedItem.contentTitle || selectedItem.title}
            </h1>
            {selectedItem.description && (
              <p className="text-muted-foreground text-sm mt-1">
                {selectedItem.description}
              </p>
            )}
          </div>
          <div className="flex-1">
            {selectedItem.content}
          </div>
        </div>
      </main>
    </div>
  );
}

function MobileLayout(props: { items: SidebarItem[], title?: ReactNode, selectedIndex: number, backUrl?: string | null }) {
  const selectedItem = props.items[props.selectedIndex];

  if (props.selectedIndex === -1) {
    return (
      <div className="flex flex-col gap-2 p-2">
        {props.backUrl && (
          <div className="ml-2 mb-1">
            <BackButton url={props.backUrl} />
          </div>
        )}
        {props.title && (
          <div className="mb-2 ml-2">
            <h2 className="text-lg font-semibold text-foreground">{props.title}</h2>
          </div>
        )}

        <Items items={props.items} selectedIndex={props.selectedIndex} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {props.backUrl && (
        <div className="-mb-2">
          <BackButton url={props.backUrl} label="Back to site" />
        </div>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="justify-start gap-2 w-fit -ml-2 text-muted-foreground"
        onClick={() => setHash('')}
      >
        <XIcon className="h-4 w-4" />
        Back
      </Button>
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          {selectedItem.contentTitle || selectedItem.title}
        </h1>
        {selectedItem.description && (
          <p className="text-muted-foreground text-sm mt-1">
            {selectedItem.description}
          </p>
        )}
      </div>
      {selectedItem.content}
    </div>
  );
}
