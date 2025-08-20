'use client';

import { getPublicEnvVar } from '@/lib/env';
import { cn } from '@/lib/utils';
import { useUser } from '@stackframe/stack';
import { StackAssertionError } from '@stackframe/stack-shared/dist/utils/errors';
import { htmlToText } from '@stackframe/stack-shared/dist/utils/html';
import { runAsynchronously } from '@stackframe/stack-shared/dist/utils/promises';
import { Button } from '@stackframe/stack-ui';
import { ChevronUp, Lightbulb, Loader2, Plus, Send, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

type FeatureRequestBoardProps = {
  isActive: boolean,
};

type FeatureRequestPostStatus = {
  name: string,
  color: string,
};

type FeatureRequest = {
  id: string,
  title: string,
  content: string | null,
  upvotes: number,
  date: string,
  postStatus: FeatureRequestPostStatus | null,
  userHasUpvoted: boolean,
};

type FeatureRequestsResponse = {
  posts: FeatureRequest[],
};

type CreateFeatureRequestBody = {
  title: string,
  content: string,
  category: string,
  tags: string[],
  commentsAllowed: boolean,
};

type CreateFeatureRequestResponse = {
  success: boolean,
  id?: string,
  error?: string,
};

export function FeatureRequestBoard({}: FeatureRequestBoardProps) {
  const user = useUser({ or: 'redirect', projectIdMustMatch: "internal" });

  // Base URL for API requests
  const baseUrl = getPublicEnvVar('NEXT_PUBLIC_STACK_API_URL') || '';

  // Feature request form state
  const [featureTitle, setFeatureTitle] = useState('');
  const [featureContent, setFeatureContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [showSubmitForm, setShowSubmitForm] = useState(false);

  // Existing feature requests state
  const [existingRequests, setExistingRequests] = useState<FeatureRequest[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(true);

  // Track which posts the current user has upvoted
  const [userUpvotes, setUserUpvotes] = useState<Set<string>>(new Set());

  // Fetch existing feature requests from secure backend
  const fetchFeatureRequests = useCallback(async () => {
    try {
      const authJson = await user.getAuthJson();
      const response = await fetch(`${baseUrl}/api/v1/internal/feature-requests`, {
        headers: {
          'X-Stack-Project-Id': 'internal',
          'X-Stack-Access-Type': 'client',
          'X-Stack-Access-Token': authJson.accessToken || '',
          'X-Stack-Publishable-Client-Key': getPublicEnvVar('NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY') || '',
        },
      });

      if (response.ok) {
        const data: FeatureRequestsResponse = await response.json();
        setExistingRequests(data.posts);

        // Update upvote status from backend response
        const upvotedPosts = new Set<string>();
        data.posts.forEach((post) => {
          if (post.userHasUpvoted) {
            upvotedPosts.add(post.id);
          }
        });
        setUserUpvotes(upvotedPosts);
      } else {
        throw new StackAssertionError('Fetch response is not OK', {
          details: {
            response: response,
            responseText: await response.text(),
          },
        });
      }
    } finally {
      setIsLoadingRequests(false);
    }
  }, [user, baseUrl]);

  useEffect(() => {
    runAsynchronously(fetchFeatureRequests());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle refresh button click
  const handleRefreshRequests = () => {
    setIsLoadingRequests(true);
    runAsynchronously(fetchFeatureRequests());
  };

  // Handle upvote
  const handleUpvote = async (postId: string) => {
    const wasUpvoted = userUpvotes.has(postId);
    if (wasUpvoted) return;  // sadly Featurebase doesn't currently support unvoting via the API...

    // Optimistically update local state
    setUserUpvotes(prev => {
      const newSet = new Set(prev);
      newSet.add(postId);
      return newSet;
    });

    // Optimistically update upvote count
    setExistingRequests(prev => prev.map(request =>
      request.id === postId
        ? {
          ...request,
          upvotes: request.upvotes + 1
        }
        : request
    ));

    try {
      const authJson = await user.getAuthJson();
      const response = await fetch(`${baseUrl}/api/v1/internal/feature-requests/${postId}/upvote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Stack-Project-Id': 'internal',
          'X-Stack-Access-Type': 'client',
          'X-Stack-Access-Token': authJson.accessToken || '',
          'X-Stack-Publishable-Client-Key': getPublicEnvVar('NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY') || '',
        },
        body: JSON.stringify({}),
      });

      if (response.ok) {
        // Refresh the list to get updated upvote counts from server
        runAsynchronously(fetchFeatureRequests());
      } else {
        console.error('Failed to upvote feature request');
        // Revert optimistic updates on failure
        setUserUpvotes(prev => {
          const newSet = new Set(prev);
          newSet.add(postId);
          return newSet;
        });
        setExistingRequests(prev => prev.map(request =>
          request.id === postId
            ? {
              ...request,
              upvotes: request.upvotes + 1
            }
            : request
        ));
      }
    } catch (error) {
      console.error('Error upvoting feature request:', error);
      // Revert optimistic updates on failure
      setUserUpvotes(prev => {
        const newSet = new Set(prev);
        newSet.add(postId);
        return newSet;
      });
      setExistingRequests(prev => prev.map(request =>
        request.id === postId
          ? {
            ...request,
            upvotes: request.upvotes + 1
          }
          : request
      ));

      throw error;
    }
  };

  // Submit feature request via secure backend
  const submitFeatureRequest = async () => {
    if (!featureTitle.trim()) return;

    setIsSubmitting(true);
    setSubmitStatus('idle');

    try {
      const requestBody: CreateFeatureRequestBody = {
        title: featureTitle,
        content: featureContent,
        category: 'feature-requests',
        tags: ['feature_request', 'dashboard'],
        commentsAllowed: true,
      };

      const authJson = await user.getAuthJson();
      const response = await fetch(`${baseUrl}/api/v1/internal/feature-requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Stack-Project-Id': 'internal',
          'X-Stack-Access-Type': 'client',
          'X-Stack-Access-Token': authJson.accessToken || '',
          'X-Stack-Publishable-Client-Key': getPublicEnvVar('NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY') || '',
        },
        body: JSON.stringify(requestBody)
      });

      const responseData: CreateFeatureRequestResponse = await response.json();

      if (response.ok && responseData.success) {
        setSubmitStatus('success');
        setFeatureTitle('');
        setFeatureContent('');

        // Refresh the feature requests list
        try {
          await fetchFeatureRequests();
        } catch (error) {
          console.error('Failed to refresh feature requests:', error);
        }

        // Auto-reset status and hide form after success
        setTimeout(() => {
          setSubmitStatus('idle');
          setShowSubmitForm(false);
        }, 3000);
      } else {
        console.error('Backend API error:', responseData);
        throw new Error(`Failed to submit feature request: ${responseData.error || response.statusText}`);
      }
    } catch (error) {
      console.error('Error submitting feature request:', error);
      setSubmitStatus('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle clicking on a feature request card to view it on Featurebase
  const handleFeatureRequestClick = (requestId: string) => {
    // Construct the Featurebase post URL using the post ID
    const featureRequestUrl = `https://feedback.stack-auth.com/p/${requestId}`;
    const redirectTo = `/integrations/featurebase/sso?return_to=${encodeURIComponent(featureRequestUrl)}`;

    // Open in new tab to maintain the current Stack Companion session
    window.open(redirectTo, '_blank');
  };

  return (
    <div className="flex flex-col h-full">
      {submitStatus === 'success' ? (
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 text-center border border-green-200 dark:border-green-800">
          <Lightbulb className="h-6 w-6 mx-auto mb-2 text-green-600" />
          <p className="text-sm text-green-800 dark:text-green-200 font-medium">
            Feature request submitted successfully!
          </p>
          <p className="text-xs text-green-600 dark:text-green-300 mt-1">
            Thank you for helping us improve Stack Auth!
          </p>
        </div>
      ) : showSubmitForm ? (
        <div className="bg-card rounded-lg border border-border p-4 shadow-sm animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-purple-600" />
              <h4 className="text-sm font-semibold text-foreground">Submit Feature Request</h4>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSubmitForm(false)}
              className="h-6 w-6 p-0 hover:bg-muted rounded-md"
              title="Cancel"
            >
              <X className="h-3 w-3" />
            </Button>
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
      ) : (
        <Button
          onClick={() => setShowSubmitForm(true)}
          variant="outline"
          className="w-full mb-4 min-h-[36px] flex-shrink-0 animate-in fade-in-0 duration-200"
          size="sm"
        >
          <Plus className="h-4 w-4 mr-2 flex-shrink-0" />
          <span className="flex-1">Submit New Feature Request</span>
        </Button>
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
            } as React.CSSProperties}
            onMouseEnter={(e) => {
              (e.currentTarget.style as any).scrollbarWidth = 'thin';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget.style as any).scrollbarWidth = 'none';
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
              <div key={request.id} className="bg-card rounded-lg border border-border shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-start gap-3 p-3">
                  {/* Upvote Button */}
                  <div className="flex flex-col items-center gap-1">
                    <Button
                      variant={userUpvotes.has(request.id) ? "default" : "outline"}
                      size="sm"
                      onClick={async (e) => {
                        e.stopPropagation();
                        await handleUpvote(request.id);
                      }}
                      className="h-6 w-6 p-0 rounded-md"
                    >
                      <ChevronUp className="h-2.5 w-2.5" />
                    </Button>
                    <span className="text-[10px] text-muted-foreground font-medium">
                      {request.upvotes || 0}
                    </span>
                  </div>

                  {/* Clickable Content */}
                  <button
                    onClick={() => handleFeatureRequestClick(request.id)}
                    className="flex-1 min-w-0 text-left group hover:bg-muted/30 rounded-md p-2 -m-2 transition-colors"
                  >
                    <div className="mb-2">
                      <h6 className="text-sm font-medium text-foreground line-clamp-4 group-hover:text-primary mb-2">
                        {request.title}
                      </h6>
                      <span className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-md font-medium inline-block border",
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
                        {htmlToText(request.content)}
                      </p>
                    )}

                    <div className="flex items-center justify-end text-xs text-muted-foreground">
                      <span>{new Date(request.date).toLocaleDateString()}</span>
                    </div>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-card rounded-lg border border-border p-6 text-center">
            <Lightbulb className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No feature requests yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Be the first to submit one!</p>
          </div>
        )}
      </div>
    </div>
  );
}
