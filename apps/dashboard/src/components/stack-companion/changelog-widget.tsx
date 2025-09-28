'use client';

import { runAsynchronously } from '@stackframe/stack-shared/dist/utils/promises';
import { Button } from '@stackframe/stack-ui';
import { Calendar, ChevronDown, ChevronUp } from 'lucide-react';
import Image from 'next/image';
import Script from 'next/script';
import { useEffect, useState } from 'react';

type ChangelogWidgetProps = {
  isActive: boolean,
};

type ChangelogItem = {
  id: string,
  title: string,
  content: string,
  date: string,
  featuredImage?: string,
  isNew?: boolean,
  expanded?: boolean,
};

export function ChangelogWidget({ isActive }: ChangelogWidgetProps) {
  const [changelogs, setChangelogs] = useState<ChangelogItem[]>([]);
  const [loading, setLoading] = useState(true);

  const toggleExpanded = (id: string) => {
    setChangelogs(prev => prev.map(changelog =>
      changelog.id === id
        ? { ...changelog, expanded: !changelog.expanded }
        : changelog
    ));
  };

  // Helper function to determine if content should be collapsible
  const shouldCollapseContent = (content: string) => {
    const textContent = content.replace(/<[^>]*>/g, '');
    return textContent.length > 200; // Collapse if text is longer than 200 characters
  };

  useEffect(() => {
    if (!isActive) return;

    const win = window as any;
    if (typeof win.Featurebase !== "function") {
      win.Featurebase = function () {
        // eslint-disable-next-line prefer-rest-params
        (win.Featurebase.q = win.Featurebase.q || []).push(arguments);
      };
    }

    // Initialize the widget but disable popup since we're showing inline
    win.Featurebase("init_changelog_widget", {
      organization: "stackauth",
      dropdown: {
        enabled: false, // Disable since we're showing inline
      },
      popup: {
        enabled: false, // Disable popup since we're showing inline
        autoOpenForNewUpdates: false,
      },
      theme: "light",
      locale: "en",
    });

    // Fetch changelog data directly from Featurebase API
    const fetchChangelogs = async () => {
      try {
        setLoading(true);
        const response = await fetch('https://stackauth.featurebase.app/api/v1/changelog', {
          headers: {
            'Accept': 'application/json',
          },
        });

        if (response.ok) {
          const data = await response.json();
          // Transform the data to our format - API returns { results: [...] }
          const transformedData = data.results?.slice(0, 10).map((item: any) => ({
            id: item.id,
            title: item.title,
            content: item.content || 'No content available',
            date: new Date(item.date).toLocaleDateString(),
            featuredImage: item.featuredImage,
            isNew: new Date(item.date) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Consider new if within last 7 days
            expanded: false, // Start collapsed
          })) || [];
          setChangelogs(transformedData);
        } else {
          console.error('Failed to fetch changelogs:', response.status, response.statusText);
          setChangelogs([]);
        }
      } catch (error) {
        console.error('Failed to fetch changelogs:', error);
        setChangelogs([]);
      } finally {
        setLoading(false);
      }
    };

    runAsynchronously(fetchChangelogs());
  }, [isActive]);

  if (loading) {
    return (
      <>
        <Script src="https://do.featurebase.app/js/sdk.js" id="featurebase-sdk" />
        <div className="space-y-4">
          <div className="bg-muted/30 rounded-lg p-4">
            <div className="animate-pulse space-y-3">
              <div className="h-4 bg-muted rounded w-3/4"></div>
              <div className="h-3 bg-muted rounded w-1/2"></div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Script src="https://do.featurebase.app/js/sdk.js" id="featurebase-sdk" />
      <div className="space-y-4">
        {/* Header section */}
        <div className="bg-muted/30 rounded-lg p-4">
          <h3 className="text-sm font-semibold mb-2">Latest Updates</h3>
          <p className="text-xs text-muted-foreground">
            Recent features and improvements
          </p>
        </div>

        {/* Changelog Items */}
        <div className="space-y-4">
          {changelogs.length > 0 ? (
            changelogs.map((changelog) => {
              const shouldCollapse = shouldCollapseContent(changelog.content);

              return (
                <div
                  key={changelog.id}
                  className="bg-card rounded-lg border border-border overflow-hidden"
                >
                  {/* Featured Image with Title Overlay - Always Visible */}
                  {changelog.featuredImage ? (
                    <div className="relative">
                      <Image
                        src={changelog.featuredImage}
                        alt={changelog.title}
                        width={320}
                        height={128}
                        className="w-full h-32 object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                      {/* Dark overlay for better text readability */}
                      <div className="absolute inset-0 bg-black/40"></div>

                      {/* Title and metadata overlay */}
                      <div className="absolute inset-0 p-3 flex flex-col justify-end">
                        <div className="flex items-start justify-between mb-1">
                          <h4 className="text-sm font-semibold text-white line-clamp-2 flex-1">
                            {changelog.title}
                          </h4>
                          {changelog.isNew && (
                            <span className="bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded-full flex-shrink-0 ml-2">
                              New
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-xs text-white/80">
                          <Calendar className="h-3 w-3" />
                          <span>{changelog.date}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Fallback header when no image */
                    <div className="p-3 border-b border-border bg-muted/20">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2 flex-1">
                          <h4 className="text-sm font-medium line-clamp-2">
                            {changelog.title}
                          </h4>
                          {changelog.isNew && (
                            <span className="bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded-full flex-shrink-0">
                              New
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        <span>{changelog.date}</span>
                      </div>
                    </div>
                  )}

                  {/* Content Section */}
                  <div className="p-3">
                    {shouldCollapse ? (
                      /* Collapsible content for long text */
                      <>
                        {!changelog.expanded && (
                          <div>
                            <p className="text-xs text-muted-foreground line-clamp-3 mb-2">
                              {changelog.content.replace(/<[^>]*>/g, '')}
                            </p>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs p-0 text-primary hover:text-primary/80"
                              onClick={() => toggleExpanded(changelog.id)}
                            >
                              <ChevronDown className="h-3 w-3 mr-1" />
                              Read more
                            </Button>
                          </div>
                        )}

                        {changelog.expanded && (
                          <div>
                            <div
                              className="prose prose-sm max-w-none text-xs mb-3 whitespace-pre-wrap"
                              style={{
                                fontSize: '12px',
                                lineHeight: '1.4',
                              }}
                            >
                              {changelog.content.replace(/<[^>]*>/g, '')}
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs p-0 text-primary hover:text-primary/80"
                              onClick={() => toggleExpanded(changelog.id)}
                            >
                              <ChevronUp className="h-3 w-3 mr-1" />
                              Show less
                            </Button>
                          </div>
                        )}
                      </>
                    ) : (
                      /* Always visible content for short text */
                      <div
                        className="prose prose-sm max-w-none text-xs whitespace-pre-wrap"
                        style={{
                          fontSize: '12px',
                          lineHeight: '1.4',
                        }}
                      >
                        {changelog.content.replace(/<[^>]*>/g, '')}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="bg-muted/30 rounded-lg p-4 text-center">
              <Calendar className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-xs text-muted-foreground font-medium">
                No changelog updates available
              </p>
              <p className="text-xs text-muted-foreground/80 mt-1">
                Check back later for new updates
              </p>
            </div>
          )}
        </div>

        {/* Hidden Featurebase trigger for advanced features */}
        <div className="hidden">
          <button data-featurebase-changelog>
            <span id="fb-update-badge"></span>
          </button>
        </div>
      </div>
    </>
  );
}
