import { redirect } from 'next/navigation';

type Props = {
  params: Promise<{
    slug: string[],
  }>,
};

export default async function CatchAllRedirects({ params }: Props) {
  const resolvedParams = await params;
  const path = resolvedParams.slug.join('/');

  // Simple fallback-to-overview strategy:
  // Instead of trying to map every URL, redirect to appropriate base sections

  // Detect the platform from common patterns
  let platform = 'next'; // default platform

  if (path.startsWith('react/') || path.includes('/react/')) {
    platform = 'react';
  } else if (path.startsWith('js/') || path.includes('/js/')) {
    platform = 'js';
  } else if (path.startsWith('python/') || path.includes('/python/')) {
    platform = 'python';
  }

  // Handle API routes → /api/overview
  if (path.startsWith('next/rest-api/') || path.startsWith('rest-api/') || path.includes('/rest-api/')) {
    redirect('/api/overview');
  }

  // Handle SDK routes → /docs/{platform}/sdk
  if (path.includes('/sdk/') || path.startsWith('sdk/') || path.endsWith('/sdk')) {
    redirect(`/docs/${platform}/sdk`);
  }

  // Handle Components routes → /docs/{platform}/components
  if (path.includes('/components/') || path.startsWith('components/') || path.endsWith('/components')) {
    redirect(`/docs/${platform}/components`);
  }

  // Handle Getting Started routes → /docs/{platform}/getting-started
  if (path.includes('/getting-started/') || path.startsWith('getting-started/')) {
    redirect(`/docs/${platform}/getting-started`);
  }

  // Handle Concepts routes → /docs/{platform}/concepts
  if (path.includes('/concepts/') || path.startsWith('concepts/')) {
    redirect(`/docs/${platform}/concepts`);
  }

  // Handle Customization routes → /docs/{platform}/customization
  if (path.includes('/customization/') || path.startsWith('customization/')) {
    redirect(`/docs/${platform}/customization`);
  }

  // Handle Others/FAQ/Overview → /docs/{platform}/overview
  if (
    path.includes('/others/') ||
    path.startsWith('others/') ||
    path.includes('/faq') ||
    path.startsWith('faq') ||
    path.includes('/overview') ||
    path.startsWith('overview') ||
    path.startsWith('next/') ||
    path === 'next'
  ) {
    redirect(`/docs/${platform}/overview`);
  }

  // Final fallback for any docs-related path → /docs/{platform}/overview
  redirect(`/docs/${platform}/overview`);
}
