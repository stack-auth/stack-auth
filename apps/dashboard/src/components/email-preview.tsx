import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { KnownErrors } from "@stackframe/stack-shared";
import { Spinner, Typography } from "@/components/ui";
import { Archive, ArrowLeft, CaretDown, DotsThreeVertical, ArrowBendUpRight, Envelope, List, Pencil, ArrowBendUpLeft, MagnifyingGlass, Star, Trash } from "@phosphor-icons/react";
import { Component, Fragment, ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { useDebounce } from 'use-debounce';
import ResizableContainer from './resizable-container';

class EmailPreviewErrorBoundary extends Component<
  { children: ReactNode },
  { error: KnownErrors["EmailRenderingError"] | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    if (error instanceof KnownErrors.EmailRenderingError) {
      return { error: error as KnownErrors["EmailRenderingError"] };
    }
    throw error;
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center p-4 h-full justify-center">
          <Typography type="h3" className="mb-2" variant="destructive">
            Email Rendering Error
          </Typography>
          <Typography variant="secondary" className="whitespace-pre-wrap">
            {this.state.error.message}
          </Typography>
        </div>
      );
    }
    return this.props.children;
  }
}

function EmailPreviewContent({
  themeId,
  themeTsxSource,
  templateId,
  templateTsxSource,
}: {
  themeId?: string | undefined | false,
  themeTsxSource?: string,
  templateId?: string,
  templateTsxSource?: string,
}) {
  const stackAdminApp = useAdminApp();

  const previewHtml = stackAdminApp.useEmailPreview({
    themeId,
    themeTsxSource,
    templateId,
    templateTsxSource
  });

  const inertPreviewHtml = previewHtml ? previewHtml + `
    <script>
      document.addEventListener('click', function(e) {
        var target = e.target;
        while (target && target.tagName !== 'A') {
          target = target.parentNode;
        }
        if (target && target.tagName === 'A') {
          e.preventDefault();
          e.stopPropagation();
        }
      }, true);
    </script>
  ` : previewHtml;

  return (
    <iframe
      srcDoc={inertPreviewHtml}
      className="w-full h-full border-0"
      title="Email Preview"
    />
  );
}

export type DeviceViewport = {
  id: string;
  name: string;
  width: number;
  height: number;
  type: 'phone' | 'tablet' | 'desktop';
};

export const DEVICE_VIEWPORTS: DeviceViewport[] = [
  { id: 'phone', name: 'Phone', width: 390, height: 844, type: 'phone' },
  { id: 'tablet', name: 'Tablet', width: 820, height: 1180, type: 'tablet' },
  { id: 'desktop', name: 'Desktop', width: 1200, height: 800, type: 'desktop' },
];

type EmailPreviewProps =
  | ({
    themeId: string | undefined | false,
    themeTsxSource?: undefined,
  } | {
    themeId?: undefined,
    themeTsxSource: string,
  })
  & (
    | {
      templateId: string,
      templateTsxSource?: undefined,
    }
    | {
      templateId?: undefined,
      templateTsxSource: string,
    }
  ) & {
    disableResizing?: boolean,
    viewport?: DeviceViewport,
    emailSubject?: string,
    senderName?: string,
    senderEmail?: string,
  };

export default function EmailPreview({
  themeId,
  themeTsxSource,
  templateId,
  templateTsxSource,
  disableResizing,
  viewport,
  emailSubject = "Verify your email at Acme Inc",
  senderName = "Acme Inc",
  senderEmail = "noreply@acme.com",
}: EmailPreviewProps) {
  const [debouncedTemplateTsxSource] = useDebounce(templateTsxSource, 100);
  const [debouncedThemeTsxSource] = useDebounce(themeTsxSource, 100);
  const Container = disableResizing ? Fragment : ResizableContainer;

  const emailContent = (
    <Suspense fallback={
      <div className="flex items-center justify-center h-full bg-white">
        <Spinner />
      </div>
    }>
      <EmailPreviewErrorBoundary key={`${debouncedTemplateTsxSource ?? ""}${debouncedThemeTsxSource ?? ""}`}>
        <EmailPreviewContent
          themeId={themeId}
          themeTsxSource={debouncedThemeTsxSource}
          templateId={templateId}
          templateTsxSource={debouncedTemplateTsxSource}
        />
      </EmailPreviewErrorBoundary>
    </Suspense>
  );

  // If viewport is provided, render in an email client frame
  if (viewport) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-start">
        <EmailClientFrame 
          viewport={viewport}
          emailSubject={emailSubject}
          senderName={senderName}
          senderEmail={senderEmail}
        >
          {emailContent}
        </EmailClientFrame>
      </div>
    );
  }

  return (
    <div className={`w-full h-full flex flex-col justify-center ${disableResizing ? "pointer-events-none" : ""}`}>
      <Container>
        {emailContent}
      </Container>
    </div>
  );
}

// Gmail Logo SVG Component
function GmailLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 75 24" className={className} aria-label="Gmail">
      <g>
        <path fill="#EA4335" d="M1 5.625L1 18.375C1 19.2034 1.67157 19.875 2.5 19.875L5.5 19.875L5.5 10.5L7.75 12.375L7.75 19.875L14 19.875L14 10.5L8.5 6L2.5 10.5L2.5 5.625C2.5 4.79657 1.82843 4.125 1 4.125L1 5.625Z"/>
        <path fill="#34A853" d="M22.5 19.875L19.5 19.875L19.5 10.5L14 6L14 19.875L17.25 19.875L17.25 12.375L19.5 10.5L19.5 19.875L22.5 19.875C23.3284 19.875 24 19.2034 24 18.375L24 5.625C24 4.79657 23.3284 4.125 22.5 4.125L22.5 5.625L22.5 19.875Z"/>
        <path fill="#4285F4" d="M14 6L19.5 10.5L19.5 5.625L14 1.125L8.5 5.625L8.5 6L14 10.5L14 6Z"/>
        <path fill="#FBBC05" d="M5.5 10.5L5.5 5.625L8.5 5.625L8.5 6L14 1.125L8.5 1.125L2.5 5.625L5.5 10.5Z"/>
        <path fill="#EA4335" d="M5.5 5.625L5.5 10.5L8.5 6L8.5 5.625L5.5 5.625Z"/>
        <path fill="#34A853" d="M19.5 5.625L19.5 10.5L14 6L14 1.125L19.5 5.625Z"/>
      </g>
    </svg>
  );
}

// iOS Status Bar Component
function IOSStatusBar() {
  return (
    <div className="h-11 px-6 flex items-center justify-between text-black text-sm font-semibold">
      <span>9:41</span>
      <div className="flex items-center gap-1">
        {/* Signal */}
        <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor">
          <rect x="0" y="6" width="3" height="6" rx="1"/>
          <rect x="4" y="4" width="3" height="8" rx="1"/>
          <rect x="8" y="2" width="3" height="10" rx="1"/>
          <rect x="12" y="0" width="3" height="12" rx="1"/>
        </svg>
        {/* WiFi */}
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor">
          <path d="M8 2.4C10.9 2.4 13.5 3.5 15.4 5.3L14.1 6.6C12.5 5.1 10.4 4.2 8 4.2C5.6 4.2 3.5 5.1 1.9 6.6L0.6 5.3C2.5 3.5 5.1 2.4 8 2.4ZM8 5.8C9.9 5.8 11.6 6.5 12.9 7.7L11.6 9C10.6 8.1 9.4 7.6 8 7.6C6.6 7.6 5.4 8.1 4.4 9L3.1 7.7C4.4 6.5 6.1 5.8 8 5.8ZM8 9.2C8.9 9.2 9.8 9.5 10.5 10.1L8 12.6L5.5 10.1C6.2 9.5 7.1 9.2 8 9.2Z"/>
        </svg>
        {/* Battery */}
        <svg width="25" height="12" viewBox="0 0 25 12" fill="currentColor">
          <rect x="0" y="1" width="21" height="10" rx="2" stroke="currentColor" strokeWidth="1" fill="none"/>
          <rect x="2" y="3" width="16" height="6" rx="1"/>
          <path d="M23 4V8C23.8 8 24 7 24 6C24 5 23.8 4 23 4Z"/>
        </svg>
      </div>
    </div>
  );
}

// Email Client Frame Component - Mimics Gmail UI
function EmailClientFrame({ 
  viewport, 
  children,
  emailSubject,
  senderName,
  senderEmail,
}: { 
  viewport: DeviceViewport;
  children: ReactNode;
  emailSubject: string;
  senderName: string;
  senderEmail: string;
}) {
  const isPhone = viewport.type === 'phone';
  const isTablet = viewport.type === 'tablet';
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 900, height: 580 });

  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Calculate scale based on actual container size, but keep mockups at a reasonable size
  const maxMockupHeight = 580; // Standardize mockup height
  const scale = Math.min(
    maxMockupHeight / viewport.height,
    (containerSize.width * 0.95) / viewport.width,
    1
  );

  const avatarColors = [
    'bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-yellow-500',
    'bg-lime-500', 'bg-green-500', 'bg-emerald-500', 'bg-teal-500',
    'bg-cyan-500', 'bg-sky-500', 'bg-blue-500', 'bg-indigo-500',
    'bg-violet-500', 'bg-purple-500', 'bg-fuchsia-500', 'bg-pink-500',
  ];
  const avatarColor = avatarColors[senderName.charCodeAt(0) % avatarColors.length];

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col items-center justify-start overflow-hidden">
      {isPhone ? (
        <div 
          className="relative flex flex-col items-center"
          style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}
        >
          {/* iPhone Pro frame */}
          <div className="relative bg-[#1c1c1e] rounded-[55px] p-[12px] shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5),0_30px_60px_-30px_rgba(0,0,0,0.6)] ring-1 ring-[#3a3a3c]">
            {/* Dynamic Island */}
            <div className="absolute top-[22px] left-1/2 -translate-x-1/2 w-[126px] h-[37px] bg-black rounded-[20px] z-20 flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-[#1c1c1e] mr-8" /> {/* Camera */}
            </div>
            
            {/* Side buttons */}
            <div className="absolute -left-[2px] top-[120px] w-[3px] h-[30px] bg-[#3a3a3c] rounded-l-sm" />
            <div className="absolute -left-[2px] top-[170px] w-[3px] h-[60px] bg-[#3a3a3c] rounded-l-sm" />
            <div className="absolute -left-[2px] top-[240px] w-[3px] h-[60px] bg-[#3a3a3c] rounded-l-sm" />
            <div className="absolute -right-[2px] top-[180px] w-[3px] h-[80px] bg-[#3a3a3c] rounded-r-sm" />
            
            {/* Screen */}
            <div 
              className="relative bg-white rounded-[43px] overflow-hidden flex flex-col"
              style={{ width: viewport.width, height: viewport.height }}
            >
              {/* iOS Status Bar */}
              <div className="bg-white shrink-0">
                <IOSStatusBar />
              </div>
              
              {/* Gmail Mobile App Header */}
              <div className="bg-white px-2 pb-2 flex items-center shrink-0">
                <button className="p-2 hover:bg-gray-100 rounded-full">
                  <ArrowLeft className="w-6 h-6 text-[#5f6368]" strokeWidth={1.5} />
                </button>
                <div className="flex-1" />
                <button className="p-2 hover:bg-gray-100 rounded-full">
                  <Archive className="w-6 h-6 text-[#5f6368]" strokeWidth={1.5} />
                </button>
                <button className="p-2 hover:bg-gray-100 rounded-full">
                  <Trash className="w-6 h-6 text-[#5f6368]" weight="regular" />
                </button>
                <button className="p-2 hover:bg-gray-100 rounded-full">
                  <Envelope className="w-6 h-6 text-[#5f6368]" weight="regular" />
                </button>
                <button className="p-2 hover:bg-gray-100 rounded-full">
                  <DotsThreeVertical className="w-6 h-6 text-[#5f6368]" weight="bold" />
                </button>
              </div>
              
              {/* Email Subject & Sender */}
              <div className="bg-white px-4 pb-4 shrink-0">
                <h1 className="text-[22px] font-normal text-[#202124] leading-7 mb-4">{emailSubject}</h1>
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-full ${avatarColor} flex items-center justify-center text-white font-medium text-base shrink-0`}>
                    {senderName.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[14px] text-[#202124]">{senderName}</span>
                    </div>
                    <div className="flex items-center text-[12px] text-[#5f6368]">
                      <span>to me</span>
                      <CaretDown className="w-4 h-4 ml-0.5" />
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[12px] text-[#5f6368]">10:30 AM</span>
                    <button className="p-1">
                      <Star className="w-5 h-5 text-[#5f6368]" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              </div>
              
              {/* Email Body */}
              <div className="flex-1 overflow-auto bg-white">
                {children}
              </div>
              
              {/* Reply/Forward Bar */}
              <div className="bg-white border-t border-[#e8eaed] px-4 py-3 flex items-center gap-3 shrink-0">
                <button className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full border border-[#dadce0] text-[14px] font-medium text-[#5f6368] hover:bg-[#f1f3f4]">
                  <ArrowBendUpLeft className="w-5 h-5" weight="regular" />
                  Reply
                </button>
                <button className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full border border-[#dadce0] text-[14px] font-medium text-[#5f6368] hover:bg-[#f1f3f4]">
                  <ArrowBendUpRight className="w-5 h-5" weight="regular" />
                  Forward
                </button>
              </div>
              
              {/* Home Indicator */}
              <div className="bg-white pb-2 pt-2 flex justify-center shrink-0">
                <div className="w-[134px] h-[5px] bg-black rounded-full" />
              </div>
            </div>
          </div>
        </div>
      ) : isTablet ? (
        <div 
          className="relative flex flex-col items-center"
          style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}
        >
          {/* iPad Pro frame */}
          <div className="relative bg-[#1c1c1e] rounded-[28px] p-[14px] shadow-[0_50px_100px_-20px_rgba(0,0,0,0.4)] ring-1 ring-[#3a3a3c]">
            
            {/* Screen */}
            <div 
              className="relative bg-[#f6f8fc] rounded-[14px] overflow-hidden flex flex-col"
              style={{ width: viewport.width, height: viewport.height }}
            >
              {/* Gmail App Header */}
              <div className="bg-white h-14 px-4 flex items-center gap-4 shrink-0 shadow-sm">
                <button className="p-2 hover:bg-gray-100 rounded-full">
                  <List className="w-6 h-6 text-[#5f6368]" weight="regular" />
                </button>
                <div className="flex-1 flex items-center bg-[#eaf1fb] hover:bg-[#dde6f2] rounded-full px-4 py-2.5 cursor-pointer transition-colors">
                  <MagnifyingGlass className="w-5 h-5 text-[#5f6368] mr-3" weight="regular" />
                  <span className="text-[16px] text-[#5f6368]">Search in mail</span>
                </div>
                <button className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white text-base font-medium hover:shadow-md transition-shadow">
                  U
                </button>
              </div>
              
              {/* Content area */}
              <div className="flex-1 flex overflow-hidden">
                {/* Sidebar Rail */}
                <div className="w-20 bg-white border-r border-[#e8eaed] py-3 flex flex-col items-center gap-1 shrink-0">
                  <button className="w-14 h-14 rounded-2xl bg-[#c2e7ff] flex items-center justify-center mb-4 shadow-sm hover:shadow-md transition-shadow">
                    <Pencil className="w-6 h-6 text-[#001d35]" weight="regular" />
                  </button>
                  <button className="w-14 h-14 rounded-full bg-[#d3e3fd] flex items-center justify-center">
                    <Envelope className="w-6 h-6 text-[#001d35]" weight="regular" />
                  </button>
                  <button className="w-14 h-14 rounded-full hover:bg-[#e8eaed] flex items-center justify-center">
                    <Star className="w-6 h-6 text-[#5f6368]" weight="regular" />
                  </button>
                  <button className="w-14 h-14 rounded-full hover:bg-[#e8eaed] flex items-center justify-center">
                    <Archive className="w-6 h-6 text-[#5f6368]" weight="regular" />
                  </button>
                </div>
                
                {/* Email Content */}
                <div className="flex-1 flex flex-col overflow-hidden bg-white m-2 rounded-xl shadow-sm">
                  {/* Email toolbar */}
                  <div className="h-14 px-4 flex items-center gap-2 border-b border-[#e8eaed] shrink-0">
                    <button className="p-2 hover:bg-[#e8eaed] rounded-full">
                      <ArrowLeft className="w-5 h-5 text-[#5f6368]" weight="regular" />
                    </button>
                    <button className="p-2 hover:bg-[#e8eaed] rounded-full">
                      <Archive className="w-5 h-5 text-[#5f6368]" weight="regular" />
                    </button>
                    <button className="p-2 hover:bg-[#e8eaed] rounded-full">
                      <Trash className="w-5 h-5 text-[#5f6368]" weight="regular" />
                    </button>
                    <div className="flex-1" />
                    <button className="p-2 hover:bg-[#e8eaed] rounded-full">
                      <DotsThreeVertical className="w-5 h-5 text-[#5f6368]" weight="bold" />
                    </button>
                  </div>
                  
                  {/* Email header */}
                  <div className="px-6 py-5 border-b border-[#e8eaed] shrink-0">
                    <h1 className="text-[22px] font-normal text-[#202124] mb-5">{emailSubject}</h1>
                    <div className="flex items-start gap-4">
                      <div className={`w-10 h-10 rounded-full ${avatarColor} flex items-center justify-center text-white font-medium shrink-0`}>
                        {senderName.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-medium text-[14px] text-[#202124]">{senderName}</span>
                          <span className="text-[12px] text-[#5f6368]">&lt;{senderEmail}&gt;</span>
                        </div>
                        <div className="flex items-center text-[12px] text-[#5f6368]">
                          <span>to me</span>
                          <CaretDown className="w-4 h-4 ml-0.5" />
                        </div>
                      </div>
                      <span className="text-[12px] text-[#5f6368]">10:30 AM</span>
                      <button className="p-1 hover:bg-[#e8eaed] rounded-full">
                        <Star className="w-5 h-5 text-[#5f6368]" weight="regular" />
                      </button>
                      <button className="p-1 hover:bg-[#e8eaed] rounded-full">
                        <ArrowBendUpLeft className="w-5 h-5 text-[#5f6368]" weight="regular" />
                      </button>
                    </div>
                  </div>
                  
                  {/* Email body */}
                  <div className="flex-1 overflow-auto">
                    {children}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div 
          className="relative flex flex-col items-center"
          style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}
        >
          {/* Browser window */}
          <div className="relative bg-[#202124] rounded-xl overflow-hidden shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)] ring-1 ring-[#3a3a3c]">
            {/* Browser chrome - Chrome style */}
            <div className="bg-[#202124] h-9 flex items-center pl-2 pr-3">
              {/* Window controls */}
              <div className="flex gap-2 mr-4">
                <div className="w-3 h-3 rounded-full bg-[#ff5f57] hover:bg-[#ff5f57]/80" />
                <div className="w-3 h-3 rounded-full bg-[#febc2e] hover:bg-[#febc2e]/80" />
                <div className="w-3 h-3 rounded-full bg-[#28c840] hover:bg-[#28c840]/80" />
              </div>
              {/* Tab */}
              <div className="flex items-center bg-[#35363a] rounded-t-lg px-3 py-1.5 gap-2 mr-2">
                <GmailLogo className="w-4 h-4" />
                <span className="text-[13px] text-gray-300 max-w-32 truncate">Inbox - {senderEmail}</span>
                <button className="ml-1 hover:bg-[#5f6368] rounded p-0.5">
                  <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <button className="p-1 hover:bg-[#35363a] rounded">
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>
            {/* URL bar */}
            <div className="bg-[#202124] h-10 flex items-center px-3 gap-3 border-b border-[#3a3a3c]">
              <div className="flex items-center gap-2">
                <button className="p-1.5 hover:bg-[#35363a] rounded-full">
                  <ArrowLeft className="w-4 h-4 text-gray-500" strokeWidth={1.5} />
                </button>
                <button className="p-1.5 hover:bg-[#35363a] rounded-full">
                  <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <button className="p-1.5 hover:bg-[#35363a] rounded-full">
                  <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 flex justify-center">
                <div className="bg-[#35363a] hover:bg-[#3f4042] rounded-full px-4 py-1.5 flex items-center gap-2 w-[600px] cursor-text">
                  <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span className="text-[13px] text-gray-300">mail.google.com</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button className="p-1.5 hover:bg-[#35363a] rounded-full">
                  <Star className="w-4 h-4 text-gray-500" strokeWidth={1.5} />
                </button>
              </div>
            </div>
            
            {/* Gmail UI */}
            <div 
              className="bg-[#f6f8fc] flex flex-col overflow-hidden"
              style={{ width: viewport.width, height: viewport.height }}
            >
              {/* Gmail Header */}
              <div className="bg-white h-16 px-4 flex items-center gap-3 shrink-0">
                <button className="p-3 hover:bg-[#e8eaed] rounded-full">
                  <List className="w-5 h-5 text-[#5f6368]" weight="regular" />
                </button>
                <div className="flex items-center gap-1 mr-6">
                  <GmailLogo className="w-8 h-8" />
                  <span className="text-[22px] text-[#5f6368] font-normal">Gmail</span>
                </div>
                <div className="flex-1 max-w-[720px]">
                  <div className="bg-[#eaf1fb] hover:bg-[#dde6f2] hover:shadow-md rounded-full px-4 py-3 flex items-center gap-4 cursor-pointer transition-all">
                    <MagnifyingGlass className="w-5 h-5 text-[#5f6368]" weight="regular" />
                    <span className="text-[16px] text-[#5f6368]">Search mail</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <button className="p-3 hover:bg-[#e8eaed] rounded-full">
                    <svg className="w-5 h-5 text-[#5f6368]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
                  <button className="p-3 hover:bg-[#e8eaed] rounded-full">
                    <svg className="w-5 h-5 text-[#5f6368]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </button>
                  <button className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-medium ml-2 hover:shadow-md transition-shadow">
                    U
                  </button>
                </div>
              </div>
              
              {/* Main content */}
              <div className="flex-1 flex overflow-hidden">
                {/* Sidebar */}
                <div className="w-[256px] py-3 px-3 shrink-0">
                  <button className="flex items-center gap-3 bg-[#c2e7ff] hover:shadow-md rounded-2xl pl-4 pr-6 py-4 mb-4 transition-shadow">
                    <Pencil className="w-5 h-5 text-[#001d35]" weight="regular" />
                    <span className="text-[14px] font-medium text-[#001d35]">Compose</span>
                  </button>
                  <div className="space-y-0.5">
                    <button className="w-full flex items-center gap-4 pl-3 pr-4 py-1.5 rounded-r-full bg-[#d3e3fd] text-[#001d35]">
                      <Envelope className="w-5 h-5" weight="regular" />
                      <span className="flex-1 text-left text-[14px] font-semibold">Inbox</span>
                      <span className="text-[12px] font-semibold">1,234</span>
                    </button>
                    <button className="w-full flex items-center gap-4 pl-3 pr-4 py-1.5 rounded-r-full text-[#5f6368] hover:bg-[#e8eaed]">
                      <Star className="w-5 h-5" weight="regular" />
                      <span className="flex-1 text-left text-[14px]">Starred</span>
                    </button>
                    <button className="w-full flex items-center gap-4 pl-3 pr-4 py-1.5 rounded-r-full text-[#5f6368] hover:bg-[#e8eaed]">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="flex-1 text-left text-[14px]">Snoozed</span>
                    </button>
                    <button className="w-full flex items-center gap-4 pl-3 pr-4 py-1.5 rounded-r-full text-[#5f6368] hover:bg-[#e8eaed]">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                      <span className="flex-1 text-left text-[14px]">Sent</span>
                    </button>
                  </div>
                </div>
                
                {/* Email view */}
                <div className="flex-1 flex flex-col bg-white rounded-2xl m-2 mr-4 overflow-hidden shadow-sm">
                  {/* Email toolbar */}
                  <div className="h-12 px-3 flex items-center gap-1 border-b border-[#e8eaed] shrink-0">
                    <button className="p-2 hover:bg-[#e8eaed] rounded-full">
                      <ArrowLeft className="w-5 h-5 text-[#5f6368]" weight="regular" />
                    </button>
                    <button className="p-2 hover:bg-[#e8eaed] rounded-full">
                      <Archive className="w-5 h-5 text-[#5f6368]" weight="regular" />
                    </button>
                    <button className="p-2 hover:bg-[#e8eaed] rounded-full">
                      <Trash className="w-5 h-5 text-[#5f6368]" weight="regular" />
                    </button>
                    <div className="w-px h-5 bg-[#e8eaed] mx-1" />
                    <button className="p-2 hover:bg-[#e8eaed] rounded-full">
                      <Envelope className="w-5 h-5 text-[#5f6368]" weight="regular" />
                    </button>
                    <div className="flex-1" />
                    <span className="text-[12px] text-[#5f6368] mr-2">1 of 1,234</span>
                    <button className="p-2 hover:bg-[#e8eaed] rounded-full">
                      <svg className="w-5 h-5 text-[#5f6368]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <button className="p-2 hover:bg-[#e8eaed] rounded-full">
                      <svg className="w-5 h-5 text-[#5f6368]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                  
                  {/* Email header */}
                  <div className="px-6 py-5 shrink-0">
                    <h1 className="text-[22px] font-normal text-[#202124] mb-6">{emailSubject}</h1>
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-full ${avatarColor} flex items-center justify-center text-white font-medium shrink-0`}>
                        {senderName.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[14px] text-[#202124]">{senderName}</span>
                          <span className="text-[12px] text-[#5f6368]">&lt;{senderEmail}&gt;</span>
                        </div>
                        <div className="flex items-center text-[12px] text-[#5f6368]">
                          <span>to me</span>
                          <CaretDown className="w-4 h-4 ml-0.5" />
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[12px] text-[#5f6368] mr-2">10:30 AM (2 hours ago)</span>
                        <button className="p-2 hover:bg-[#e8eaed] rounded-full">
                          <Star className="w-5 h-5 text-[#5f6368]" weight="regular" />
                        </button>
                        <button className="p-2 hover:bg-[#e8eaed] rounded-full">
                          <ArrowBendUpLeft className="w-5 h-5 text-[#5f6368]" weight="regular" />
                        </button>
                        <button className="p-2 hover:bg-[#e8eaed] rounded-full">
                          <DotsThreeVertical className="w-5 h-5 text-[#5f6368]" weight="bold" />
                        </button>
                      </div>
                    </div>
                  </div>
                  
                  {/* Email body */}
                  <div className="flex-1 overflow-auto border-t border-[#e8eaed]">
                    {children}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
