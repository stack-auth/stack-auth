import { baseOptions } from '@/app/layout.config';
import { ApiSidebar } from '@/components/layouts/api/api-sidebar-server';
import { PlatformAwareHeader } from '@/components/layouts/platform-aware-header';
import Link from 'next/link';

export default function ApiLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-fd-background">
      {/* Custom API Sidebar - completely independent */}
      <div className="w-64 flex-shrink-0 border-r border-fd-border">
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="h-14 px-4 border-b border-fd-border flex items-center">
            <Link
              href="/"
              className="inline-flex text-[15px] items-center gap-2.5 font-medium"
            >
              {baseOptions.nav?.title}
            </Link>
          </div>
          
          {/* API Sidebar Content */}
          <div className="flex-1 overflow-hidden">
            <ApiSidebar />
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Platform-Aware Header Component */}
        <PlatformAwareHeader 
          className="h-14 border-b border-fd-border flex items-center px-6 relative overflow-hidden"
          showSearch={false}
        />

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <div className="container max-w-6xl mx-auto px-6 py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
} 
