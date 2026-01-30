'use client';

import { Button } from '@/components/ui';
import { getPublicEnvVar } from '@/lib/env';
import { CalendarIcon, CaretDownIcon, CaretUpIcon, InfoIcon, XIcon } from '@phosphor-icons/react';
import { captureError } from '@stackframe/stack-shared/dist/utils/errors';
import { runAsynchronously } from '@stackframe/stack-shared/dist/utils/promises';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type ChangeType = 'major' | 'minor' | 'patch';

type ApiChangelogEntry = {
  version: string,
  type: ChangeType,
  markdown: string,
  bulletCount: number,
  releasedAt?: string,
  isUnreleased?: boolean,
};

type ChangelogItem = ApiChangelogEntry & {
  id: string,
  expanded: boolean,
};

type ChangelogWidgetProps = {
  isActive: boolean,
  initialData?: ApiChangelogEntry[],
};

function toChangelogItems(entries: ApiChangelogEntry[]): ChangelogItem[] {
  return entries.map((entry, index) => ({
    ...entry,
    id: `${entry.version}-${entry.releasedAt ?? 'unreleased'}`,
    expanded: index === 0,
  }));
}

function markLatestVersionSeen(entries: ApiChangelogEntry[]) {
  // Find the first released version (skip unreleased to avoid breaking version comparison)
  const latestReleasedEntry = entries.find(entry => !entry.isUnreleased);
  if (latestReleasedEntry) {
    document.cookie = `stack-last-seen-changelog-version=${encodeURIComponent(latestReleasedEntry.version)}; path=/; max-age=31536000`;
  }
}


const formatVersion = (version: string) => {
  // Version is already in US date format (M/D/YY), return as-is
  return version;
};

export function ChangelogWidget({ isActive, initialData }: ChangelogWidgetProps) {
  const [changelog, setChangelog] = useState<ChangelogItem[]>([]);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);
  const hasFetchedRef = useRef(false);
  const [previewImage, setPreviewImage] = useState<{ src: string, alt: string } | null>(null);

  // Markdown component overrides for changelog rendering
  const markdownComponents = useMemo(() => ({
    h3: ({ children }: { children?: React.ReactNode }) => (
      <h3 className="text-sm font-semibold text-foreground mt-4 mb-2 first:mt-0">
        {children}
      </h3>
    ),
    p: ({ children }: { children?: React.ReactNode }) => (
      <p className="text-muted-foreground leading-relaxed mb-2 last:mb-0">
        {children}
      </p>
    ),
    ul: ({ children }: { children?: React.ReactNode }) => (
      <ul className="list-disc list-outside ml-4 space-y-1 text-muted-foreground">
        {children}
      </ul>
    ),
    li: ({ children }: { children?: React.ReactNode }) => (
      <li className="leading-relaxed">
        {children}
      </li>
    ),
    code: ({ children }: { children?: React.ReactNode }) => (
      <code className="px-1.5 py-0.5 rounded bg-muted text-foreground text-xs font-mono">
        {children}
      </code>
    ),
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 my-3 rounded-md">
        <div className="flex items-start gap-2">
          <InfoIcon className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-800 dark:text-blue-200 leading-relaxed [&>p]:mb-0">
            {children}
          </div>
        </div>
      </div>
    ),
    img: ({ src, alt }: { src?: string, alt?: string }) => {
      if (!src) return null;
      return (
        <button
          type="button"
          onClick={() => setPreviewImage({ src, alt: alt || '' })}
          className="block w-full cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-lg"
        >
          <Image
            src={src}
            alt={alt || ''}
            width={800}
            height={600}
            className="rounded-lg border border-border max-w-full h-auto my-4 transition-opacity hover:opacity-90"
          />
        </button>
      );
    },
  }), []);

  const fetchChangelog = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setError(null);

      const baseUrl = getPublicEnvVar('NEXT_PUBLIC_STACK_API_URL') || '';
      const response = await fetch(`${baseUrl}/api/latest/internal/changelog`, { signal });

      if (!response.ok) {
        throw new Error(`Failed to fetch changelog: ${response.status}`);
      }

      const payload = await response.json();
      const entries: ApiChangelogEntry[] = payload.entries || [];

      setChangelog(toChangelogItems(entries));
      markLatestVersionSeen(entries);
    } catch (cause) {
      if (signal?.aborted) {
        return;
      }
      captureError('changelog-fetching', cause);
      setError('Unable to load the changelog right now.');
      setChangelog([]);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isActive || hasFetchedRef.current) {
      return;
    }

    hasFetchedRef.current = true;

    if (initialData !== undefined) {
      setChangelog(toChangelogItems(initialData));
      setLoading(false);
      markLatestVersionSeen(initialData);
    } else {
      const abortController = new AbortController();
      runAsynchronously(fetchChangelog(abortController.signal));
      return () => abortController.abort();
    }
  }, [fetchChangelog, isActive, initialData]);

  const toggleExpanded = (id: string) => {
    setChangelog((prev) => prev.map((entry) =>
      entry.id === id ? { ...entry, expanded: !entry.expanded } : entry,
    ));
  };

  // Handle Escape key to close the image preview
  useEffect(() => {
    if (!previewImage) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPreviewImage(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [previewImage]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="bg-muted/30 rounded-lg p-4">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-muted rounded w-3/4" />
            <div className="h-3 bg-muted rounded w-1/2" />
          </div>
        </div>
        <div className="space-y-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="bg-card rounded-lg border border-border p-4">
              <div className="animate-pulse space-y-3">
                <div className="h-3 bg-muted rounded w-1/3" />
                <div className="h-4 bg-muted rounded w-2/3" />
                <div className="h-24 bg-muted rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <div className="bg-muted/30 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Stack Auth releases</h3>
            </div>
          </div>
          {error && (
            <p className="text-xs text-destructive mt-2">
              {error}
            </p>
          )}
        </div>

        <div className="space-y-4">
          {changelog.length === 0 && !error && (
            <div className="bg-muted/30 rounded-lg p-4 text-center">
              <CalendarIcon className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-xs text-muted-foreground font-medium">
                No changelog entries found
              </p>
            </div>
          )}

          {changelog.map((entry) => (
            <div key={entry.id} className="bg-card rounded-lg border border-border">
              <div className="px-4 py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <h4 className="text-base font-semibold">{formatVersion(entry.version)}</h4>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => toggleExpanded(entry.id)}
                >
                  {entry.expanded ? (
                    <CaretUpIcon className="h-3 w-3" />
                  ) : (
                    <CaretDownIcon className="h-3 w-3" />
                  )}
                </Button>
              </div>

              {entry.expanded && (
                <div className="px-4 pb-4">
                  <div className="text-sm leading-relaxed space-y-3">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={markdownComponents}
                    >
                      {entry.markdown}
                    </ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Image preview lightbox - rendered via portal to escape container constraints */}
      {previewImage && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setPreviewImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
        >
          <button
            type="button"
            onClick={() => setPreviewImage(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
            aria-label="Close preview"
          >
            <XIcon className="h-6 w-6" />
          </button>
          <div
            className="relative max-w-[90vw] max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={previewImage.src}
              alt={previewImage.alt}
              width={1600}
              height={1200}
              className="rounded-lg max-w-full max-h-[90vh] w-auto h-auto object-contain"
            />
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
