'use client';

import { cn } from '@/lib/utils';
import { useUser } from '@stackframe/stack';
import { Button } from '@stackframe/stack-ui';
import { ChevronUp, Loader2, Send, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

type FeatureRequestBoardProps = {
  isActive: boolean,
};

export function FeatureRequestBoard({ isActive }: FeatureRequestBoardProps) {
  const user = useUser({ or: 'redirect', projectIdMustMatch: "internal" });

  // Feature request form state
  const [featureTitle, setFeatureTitle] = useState('');
  const [featureContent, setFeatureContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // Existing feature requests state
  const [existingRequests, setExistingRequests] = useState<any[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);

  // Track which posts the current user has upvoted
  const [userUpvotes, setUserUpvotes] = useState<Set<string>>(new Set());

  // Upvote state
  const [upvotingIds, setUpvotingIds] = useState<Set<string>>(new Set());

  // Check if current user has upvoted specific posts
  const checkUserUpvotes = useCallback(async (posts: any[]) => {
    if (!user.primaryEmail || posts.length === 0) return;

    try {
      // Get all post IDs and make a single batch request
      const postIds = posts.map(post => post.id).join(',');
      const response = await fetch(`/api/feature-request?batchCheckUpvotes=${postIds}&email=${encodeURIComponent(user.primaryEmail || '')}`);

      if (response.ok) {
        const data = await response.json();
        const upvotedPosts = new Set<string>();

        // Add posts that the user has upvoted to the set
        Object.entries(data.upvoteResults).forEach(([postId, hasUpvoted]) => {
          if (hasUpvoted) {
            upvotedPosts.add(postId);
          }
        });

        setUserUpvotes(upvotedPosts);
      }
    } catch (error) {
      console.error('Error checking upvote status:', error);
    }
  }, [user.primaryEmail]);

  // Fetch existing feature requests
  const fetchFeatureRequests = useCallback(async () => {
    setIsLoadingRequests(true);
    try {
      const response = await fetch('/api/feature-request');
      if (response.ok) {
        const data = await response.json();
        const posts = data.posts || [];
        setExistingRequests(posts);

        // Check which posts the current user has upvoted
        await checkUserUpvotes(posts);
      } else {
        console.error('Failed to fetch feature requests');
      }
    } catch (error) {
      console.error('Error fetching feature requests:', error);
    } finally {
      setIsLoadingRequests(false);
    }
  }, [checkUserUpvotes]);

  // Load feature requests when component becomes active
  useEffect(() => {
    if (isActive) {
      fetchFeatureRequests().then(() => {
        // Successfully loaded feature requests
      }).catch((error) => {
        console.error('Failed to load feature requests:', error);
      });
    }
  }, [isActive, fetchFeatureRequests]);

  // Handle refresh button click
  const handleRefreshRequests = () => {
    fetchFeatureRequests().then(() => {
      // Successfully refreshed
    }).catch((error) => {
      console.error('Failed to refresh feature requests:', error);
    });
  };

  // Handle upvote
  const handleUpvote = async (postId: string) => {
    if (upvotingIds.has(postId)) return; // Prevent double-clicking

    setUpvotingIds(prev => new Set(prev).add(postId));

    const wasUpvoted = userUpvotes.has(postId);

    // Optimistically update local state
    setUserUpvotes(prev => {
      const newSet = new Set(prev);
      if (wasUpvoted) {
        newSet.delete(postId);
      } else {
        newSet.add(postId);
      }
      return newSet;
    });

    // Optimistically update upvote count
    setExistingRequests(prev => prev.map(request =>
      request.id === postId
        ? {
          ...request,
          upvotes: wasUpvoted ? Math.max(0, request.upvotes - 1) : request.upvotes + 1
        }
        : request
    ));

    try {
      const response = await fetch('/api/feature-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'upvote',
          id: postId,
          email: user.primaryEmail,
          name: user.displayName || user.primaryEmail?.split('@')[0] || 'User'
        }),
      });

      if (response.ok) {
        // Refresh the list to get updated upvote counts from server
        await fetchFeatureRequests();
      } else {
        console.error('Failed to upvote feature request');
        // Revert optimistic updates on failure
        setUserUpvotes(prev => {
          const newSet = new Set(prev);
          if (wasUpvoted) {
            newSet.add(postId);
          } else {
            newSet.delete(postId);
          }
          return newSet;
        });
        setExistingRequests(prev => prev.map(request =>
          request.id === postId
            ? {
              ...request,
              upvotes: wasUpvoted ? request.upvotes + 1 : Math.max(0, request.upvotes - 1)
            }
            : request
        ));
      }
    } catch (error) {
      console.error('Error upvoting feature request:', error);
      // Revert optimistic updates on failure
      setUserUpvotes(prev => {
        const newSet = new Set(prev);
        if (wasUpvoted) {
          newSet.add(postId);
        } else {
          newSet.delete(postId);
        }
        return newSet;
      });
      setExistingRequests(prev => prev.map(request =>
        request.id === postId
          ? {
            ...request,
            upvotes: wasUpvoted ? request.upvotes + 1 : Math.max(0, request.upvotes - 1)
          }
          : request
      ));
    } finally {
      setUpvotingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(postId);
        return newSet;
      });
    }
  };

  // Submit feature request to Featurebase API
  const submitFeatureRequest = async () => {
    if (!featureTitle.trim()) return;

    setIsSubmitting(true);
    setSubmitStatus('idle');

    try {
      const requestBody = {
        title: featureTitle,
        content: featureContent,
        category: 'feature-requests',
        email: user.primaryEmail,
        authorName: user.displayName || user.primaryEmail?.split('@')[0] || 'User',
        tags: ['feature_request', 'dashboard'],
        commentsAllowed: true,
        customInputValues: {
          // Using the actual field IDs from Featurebase
          "6872f858cc9682d29cf2e4c0": 'dashboard_companion', // source field
          "6872f88041fa77a4dd9dab29": user.id, // userId field
          "6872f890143fc108288d8f5a": 'stack-auth' // projectId field
        }
      };

      const response = await fetch('/api/feature-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const responseData = await response.json();

      if (response.ok) {
        setSubmitStatus('success');
        setFeatureTitle('');
        setFeatureContent('');

        // Refresh the feature requests list
        try {
          await fetchFeatureRequests();
        } catch (error) {
          console.error('Failed to refresh feature requests:', error);
        }

        // Auto-reset status after success
        setTimeout(() => {
          setSubmitStatus('idle');
        }, 3000);
      } else {
        console.error('Featurebase API error:', responseData);
        throw new Error(`Failed to submit feature request: ${responseData.error || response.statusText}`);
      }
    } catch (error) {
      console.error('Error submitting feature request:', error);
      setSubmitStatus('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {submitStatus === 'success' ? (
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 text-center border border-green-200 dark:border-green-800">
          <Zap className="h-6 w-6 mx-auto mb-2 text-green-600" />
          <p className="text-sm text-green-800 dark:text-green-200 font-medium">
            Feature request submitted successfully!
          </p>
          <p className="text-xs text-green-600 dark:text-green-300 mt-1">
            Thank you for helping us improve Stack Auth!
          </p>
        </div>
      ) : (
        <div className="bg-card rounded-lg border border-border p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="h-5 w-5 text-purple-600" />
            <h4 className="text-sm font-semibold text-foreground">Submit Feature Request</h4>
          </div>

          {/* Title Input */}
          <div className="mb-3">
            <label htmlFor="feature-title" className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Title
            </label>
            <input
              id="feature-title"
              type="text"
              value={featureTitle}
              onChange={(e) => setFeatureTitle(e.target.value)}
              placeholder="Brief description of your feature request..."
              className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              disabled={isSubmitting}
            />
          </div>

          {/* Content Textarea */}
          <div className="mb-4">
            <label htmlFor="feature-content" className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Details (optional)
            </label>
            <textarea
              id="feature-content"
              value={featureContent}
              onChange={(e) => setFeatureContent(e.target.value)}
              placeholder="Provide more details about your feature request..."
              rows={3}
              className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
              disabled={isSubmitting}
            />
          </div>

          {/* Submit Button */}
          <Button
            onClick={submitFeatureRequest}
            disabled={!featureTitle.trim() || isSubmitting}
            className="w-full"
            size="sm"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Submit Request
              </>
            )}
          </Button>

          {submitStatus === 'error' && (
            <p className="text-sm text-destructive mt-2">
              Failed to submit feature request. Please try again.
            </p>
          )}
        </div>
      )}

      {/* Existing Feature Requests */}
      <div className="mt-4 flex-1 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h5 className="text-sm font-semibold text-foreground">Recent Requests</h5>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefreshRequests}
            disabled={isLoadingRequests}
            className="text-xs h-7 px-2"
          >
            {isLoadingRequests ? 'Loading...' : 'Refresh'}
          </Button>
        </div>

        {isLoadingRequests ? (
          <div className="bg-card rounded-lg border border-border p-6 text-center">
            <Loader2 className="h-5 w-5 mx-auto mb-2 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading feature requests...</p>
          </div>
        ) : existingRequests.length > 0 ? (
          <div
            className="flex-1 overflow-y-auto pr-1 space-y-2"
            style={{
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.scrollbarWidth = 'thin';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.scrollbarWidth = 'none';
            }}
          >
            <style jsx>{`
              div::-webkit-scrollbar {
                display: none;
              }
              div:hover::-webkit-scrollbar {
                display: block;
                width: 6px;
              }
              div:hover::-webkit-scrollbar-track {
                background: transparent;
              }
              div:hover::-webkit-scrollbar-thumb {
                background: hsl(var(--border));
                border-radius: 3px;
              }
              div:hover::-webkit-scrollbar-thumb:hover {
                background: hsl(var(--muted-foreground));
              }
            `}</style>
            {existingRequests.map((request) => (
              <div key={request.id} className="bg-card rounded-lg border border-border p-3 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-start gap-3">
                  {/* Upvote Button */}
                  <div className="flex flex-col items-center gap-1">
                    <Button
                      variant={userUpvotes.has(request.id) ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleUpvote(request.id)}
                      disabled={upvotingIds.has(request.id)}
                      className="h-6 w-6 p-0 rounded-md"
                    >
                      {upvotingIds.has(request.id) ? (
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      ) : (
                        <ChevronUp className="h-2.5 w-2.5" />
                      )}
                    </Button>
                    <span className="text-[10px] text-muted-foreground font-medium">
                      {request.upvotes || 0}
                    </span>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h6 className="text-sm font-medium text-foreground line-clamp-2">
                        {request.title}
                      </h6>
                      <span className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-md font-medium flex-shrink-0 border",
                        request.postStatus?.color === 'Green'
                          ? "bg-green-50 dark:bg-green-950 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800"
                          : request.postStatus?.color === 'Blue'
                            ? "bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800"
                            : request.postStatus?.color === 'Purple'
                              ? "bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-800"
                              : "bg-muted/50 text-muted-foreground border-border"
                      )}>
                        {request.postStatus?.name || 'Open'}
                      </span>
                    </div>

                    {request.content && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                        {request.content}
                      </p>
                    )}

                    <div className="flex items-center justify-end text-xs text-muted-foreground">
                      <span>{new Date(request.date).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-card rounded-lg border border-border p-6 text-center">
            <Zap className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No feature requests yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Be the first to submit one!</p>
          </div>
        )}
      </div>
    </div>
  );
}
