import { EmbeddedLinkInterceptor } from '@/components/embedded-link-interceptor';

// Embedded layout for dashboard docs - no navbar, optimized for iframe
export default function DashboardEmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-fd-background">
      <EmbeddedLinkInterceptor />
      {/* Main content area - no header, no padding, prevent horizontal overflow */}
      <main className="h-screen overflow-hidden">
        <div className="h-full overflow-y-auto overflow-x-hidden scrollbar-hide">
          {children}
        </div>
      </main>
    </div>
  );
}
