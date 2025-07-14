import { NextRequest, NextResponse } from 'next/server';

const FEATUREBASE_API_KEY = 'fb-a1e4acfa-7db3-428b-ab7f-1793b655e909';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Check if this is a batch request to check upvotes for multiple posts
    const batchPostIds = searchParams.get('batchCheckUpvotes');
    const userEmail = searchParams.get('email');

    if (batchPostIds && userEmail) {
      // Parse the comma-separated post IDs
      const postIds = batchPostIds.split(',').filter(id => id.trim());
      const upvoteResults: Record<string, boolean> = {};

      // Check upvote status for all posts in parallel
      const upvotePromises = postIds.map(async (postId) => {
        try {
          const response = await fetch(`https://do.featurebase.app/v2/posts/upvoters?submissionId=${postId}`, {
            method: 'GET',
            headers: {
              'X-API-Key': FEATUREBASE_API_KEY,
            },
          });

          if (response.ok) {
            const data = await response.json();
            const hasUpvoted = data.results?.some((upvoter: any) => upvoter.email === userEmail) || false;
            upvoteResults[postId] = hasUpvoted;
          } else {
            upvoteResults[postId] = false;
          }
        } catch (error) {
          console.error('Error checking upvote for post:', postId, error);
          upvoteResults[postId] = false;
        }
      });

      // Wait for all upvote checks to complete
      await Promise.all(upvotePromises);

      return NextResponse.json({ upvoteResults });
    }

    // Check if this is a request to check if current user upvoted a specific post
    const postId = searchParams.get('checkUpvote');

    if (postId && userEmail) {
      // Check if the current user has upvoted this specific post (privacy-safe)
      const response = await fetch(`https://do.featurebase.app/v2/posts/upvoters?submissionId=${postId}`, {
        method: 'GET',
        headers: {
          'X-API-Key': FEATUREBASE_API_KEY,
        },
      });

      if (response.ok) {
        const data = await response.json();
        // Only return whether THIS user has upvoted, don't expose other users' data
        const hasUpvoted = data.results?.some((upvoter: any) => upvoter.email === userEmail) || false;
        return NextResponse.json({ hasUpvoted });
      } else {
        return NextResponse.json({ hasUpvoted: false });
      }
    }

    // Fetch all posts
    const response = await fetch('https://do.featurebase.app/v2/posts?limit=10', {
      method: 'GET',
      headers: {
        'X-API-Key': FEATUREBASE_API_KEY,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Featurebase API error (GET):', data);
      return NextResponse.json(
        { error: data.error || 'Failed to fetch feature requests' },
        { status: response.status }
      );
    }

    // Filter out sensitive data and transform for frontend
    const sanitizedPosts = (data.results || []).map((post: any) => ({
      id: post.id,
      title: post.title,
      content: post.content,
      author: post.author, // Keep display name only
      authorPicture: post.authorPicture,
      // Remove: authorEmail, authorId, user object with email
      upvotes: post.upvotes,
      upvoted: post.upvoted,
      date: post.date,
      lastModified: post.lastModified,
      postStatus: post.postStatus,
      postCategory: {
        category: post.postCategory?.category,
        name: post.postCategory?.name
      },
      commentCount: post.commentCount,
      slug: post.slug
    }));

    return NextResponse.json({
      ...data,
      posts: sanitizedPosts,
      results: sanitizedPosts // Keep both for compatibility
    });
  } catch (error) {
    console.error('Proxy error (GET):', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Check if this is an upvote request
    if (body.action === 'upvote') {
      const response = await fetch('https://do.featurebase.app/v2/posts/upvoters', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': FEATUREBASE_API_KEY,
        },
        body: JSON.stringify({
          id: body.id,
          email: body.email,
          name: body.name
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Featurebase upvote API error:', data);
        return NextResponse.json(
          { error: data.error || 'Failed to upvote feature request' },
          { status: response.status }
        );
      }

      return NextResponse.json(data);
    }

    // Original post creation logic
    const response = await fetch('https://do.featurebase.app/v2/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': FEATUREBASE_API_KEY,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Featurebase API error:', data);
      return NextResponse.json(
        { error: data.error || 'Failed to submit feature request' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
