import { EmbeddedLinkInterceptor } from '@/components/embedded-link-interceptor';
import { PlatformChangeNotifier } from '@/components/platform-change-notifier';

// Embedded layout for main docs - no navbar, optimized for iframe
export default function DocsEmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-fd-background">
      <EmbeddedLinkInterceptor />
      <PlatformChangeNotifier />
      {/* Main content area - no header, no padding, prevent horizontal overflow */}
      <main className="overflow-hidden">
        <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide">
          {children}
        </div>
      </main>
    </div>
  );
}
