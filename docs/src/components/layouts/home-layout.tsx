'use client';

import { Github, Menu, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { AIChatDrawer } from '../chat/ai-chat';
import { CustomSearchDialog } from '../layout/custom-search-dialog';
import { SearchInputToggle } from '../layout/custom-search-toggle';
import { ThemeToggle } from '../layout/theme-toggle';
import { SidebarProvider, useSidebar } from './sidebar-context';

// Discord Icon Component
function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z"/>
    </svg>
  );
}

// Stack Auth Logo Component
function StackAuthLogo() {
  return (
    <Link href="https://stack-auth.com" className="flex items-center gap-2.5 text-fd-foreground hover:text-fd-foreground/80 transition-colors">
      <svg
        width="30"
        height="24"
        viewBox="0 0 200 242"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Stack Logo"
        className="flex-shrink-0"
      >
        <path d="M103.504 1.81227C101.251 0.68679 98.6002 0.687576 96.3483 1.81439L4.4201 47.8136C1.71103 49.1692 0 51.9387 0 54.968V130.55C0 133.581 1.7123 136.351 4.42292 137.706L96.4204 183.695C98.6725 184.82 101.323 184.82 103.575 183.694L168.422 151.271C173.742 148.611 180 152.479 180 158.426V168.879C180 171.91 178.288 174.68 175.578 176.035L103.577 212.036C101.325 213.162 98.6745 213.162 96.4224 212.036L11.5771 169.623C6.25791 166.964 0 170.832 0 176.779V187.073C0 190.107 1.71689 192.881 4.43309 194.234L96.5051 240.096C98.7529 241.216 101.396 241.215 103.643 240.094L195.571 194.235C198.285 192.881 200 190.109 200 187.076V119.512C200 113.565 193.741 109.697 188.422 112.356L131.578 140.778C126.258 143.438 120 139.57 120 133.623V123.17C120 120.14 121.712 117.37 124.422 116.014L195.578 80.4368C198.288 79.0817 200 76.3116 200 73.2814V54.9713C200 51.9402 198.287 49.1695 195.576 47.8148L103.504 1.81227Z" fill="currentColor"/>
      </svg>
      <span className="font-medium text-[15px]">Stack Auth</span>
    </Link>
  );
}

// AI Chat Toggle Button for Home Layout
function HomeAIChatToggleButton() {
  const sidebarContext = useSidebar();
  const { isChatOpen, toggleChat } = sidebarContext || {
    isChatOpen: false,
    toggleChat: () => {},
  };

  return (
    <button
      onClick={toggleChat}
      className="flex items-center justify-center transition-all duration-500 ease-out w-8 h-8 rounded-lg text-sm font-medium relative overflow-hidden text-white chat-gradient-active hover:scale-105 hover:brightness-110 hover:shadow-lg"
      title={isChatOpen ? 'Close AI chat' : 'Open AI chat'}
    >
      <Sparkles className="h-4 w-4 relative z-10" />
    </button>
  );
}

// Home Navbar Component
function HomeNavbar() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const sidebarContext = useSidebar();
  const { isChatOpen, isChatExpanded } = sidebarContext || {
    isChatOpen: false,
    isChatExpanded: false,
  };

  // Scroll detection
  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      setIsScrolled(scrollY > 50);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close mobile menu when scrolling
  useEffect(() => {
    if (isScrolled && mobileMenuOpen) {
      setMobileMenuOpen(false);
    }
  }, [isScrolled, mobileMenuOpen]);

  return (
    <>
      {/* Full Navbar */}
      <header className={`sticky top-0 z-50 w-full border-b border-fd-border bg-fd-background/95 backdrop-blur supports-[backdrop-filter]:bg-fd-background/60 transition-all duration-300 ${isScrolled ? 'opacity-0 pointer-events-none' : 'opacity-100'} ${(isChatOpen || isChatExpanded) ? 'fixed left-0 right-0 z-[80]' : ''}`}>
        <div className={`flex h-14 items-center justify-between px-4 md:px-6 ${(isChatOpen || isChatExpanded) ? '' : 'container max-w-screen-2xl'}`}>
          {/* Left - Logo + Social Links */}
          <div className="flex items-center gap-4">
            <StackAuthLogo />

            {/* Desktop Social Links */}
            <div className="hidden md:flex items-center gap-1">
              <Link
                href="https://github.com/stack-auth/stack"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-fd-muted-foreground transition-colors hover:bg-fd-muted hover:text-fd-foreground"
                title="GitHub"
              >
                <Github className="h-4 w-4" />
              </Link>
              <Link
                href="https://discord.stack-auth.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-fd-muted-foreground transition-colors hover:bg-fd-muted hover:text-fd-foreground"
                title="Discord"
              >
                <DiscordIcon className="h-4 w-4" />
              </Link>
            </div>
          </div>

          {/* Right - Search + Actions */}
          <div className="flex items-center gap-2">
            {/* Desktop Search */}
            <div className="hidden md:block w-64">
              <SearchInputToggle
                onOpen={() => setSearchOpen(true)}
                className="w-full"
              />
            </div>

            {/* AI Chat Toggle */}
            <HomeAIChatToggleButton />

            {/* Theme Toggle */}
            <ThemeToggle className="p-0" />

            {/* Mobile Search */}
            <div className="md:hidden">
              <SearchInputToggle
                onOpen={() => setSearchOpen(true)}
                className="w-9"
              />
            </div>

            {/* Mobile Menu Toggle */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-lg text-fd-muted-foreground transition-colors hover:bg-fd-muted hover:text-fd-foreground"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-fd-border bg-fd-background">
            <div className="container px-4 py-4 space-y-3">
              <Link
                href="https://github.com/stack-auth/stack"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-fd-muted-foreground hover:bg-fd-muted hover:text-fd-foreground transition-colors"
              >
                <Github className="h-4 w-4" />
                <span>GitHub</span>
              </Link>
              <Link
                href="https://discord.stack-auth.com"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-fd-muted-foreground hover:bg-fd-muted hover:text-fd-foreground transition-colors"
              >
                <DiscordIcon className="h-4 w-4" />
                <span>Discord</span>
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* Compact Pill Navbar */}
      <div className={`fixed top-4 left-1/2 -translate-x-1/2 transition-all duration-300 ${isScrolled ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'} ${isChatExpanded ? 'z-[80]' : 'z-50'}`}>
        <div className="flex items-center gap-2 px-4 py-2 bg-fd-background/95 backdrop-blur border border-fd-border rounded-full shadow-lg supports-[backdrop-filter]:bg-fd-background/80">
          {/* Compact Logo */}
          <Link href="https://stack-auth.com" className="flex items-center gap-2 text-fd-foreground hover:text-fd-foreground/80 transition-colors">
            <svg
              width="20"
              height="16"
              viewBox="0 0 200 242"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-label="Stack Logo"
              className="flex-shrink-0"
            >
              <path d="M103.504 1.81227C101.251 0.68679 98.6002 0.687576 96.3483 1.81439L4.4201 47.8136C1.71103 49.1692 0 51.9387 0 54.968V130.55C0 133.581 1.7123 136.351 4.42292 137.706L96.4204 183.695C98.6725 184.82 101.323 184.82 103.575 183.694L168.422 151.271C173.742 148.611 180 152.479 180 158.426V168.879C180 171.91 178.288 174.68 175.578 176.035L103.577 212.036C101.325 213.162 98.6745 213.162 96.4224 212.036L11.5771 169.623C6.25791 166.964 0 170.832 0 176.779V187.073C0 190.107 1.71689 192.881 4.43309 194.234L96.5051 240.096C98.7529 241.216 101.396 241.215 103.643 240.094L195.571 194.235C198.285 192.881 200 190.109 200 187.076V119.512C200 113.565 193.741 109.697 188.422 112.356L131.578 140.778C126.258 143.438 120 139.57 120 133.623V123.17C120 120.14 121.712 117.37 124.422 116.014L195.578 80.4368C198.288 79.0817 200 76.3116 200 73.2814V54.9713C200 51.9402 198.287 49.1695 195.576 47.8148L103.504 1.81227Z" fill="currentColor"/>
            </svg>
            <span className="hidden sm:inline font-medium text-sm">Stack Auth</span>
          </Link>

          {/* Compact Actions */}
          <div className="flex items-center gap-1 ml-2">
            {/* Compact Social Links */}
            <Link
              href="https://github.com/stack-auth/stack"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-fd-muted-foreground transition-colors hover:bg-fd-muted hover:text-fd-foreground"
              title="GitHub"
            >
              <Github className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="https://discord.stack-auth.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-fd-muted-foreground transition-colors hover:bg-fd-muted hover:text-fd-foreground"
              title="Discord"
            >
              <DiscordIcon className="h-3.5 w-3.5" />
            </Link>

            {/* Compact Search */}
            <button
              onClick={() => setSearchOpen(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-fd-muted-foreground transition-colors hover:bg-fd-muted hover:text-fd-foreground"
              title="Search (⌘K)"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>

            {/* Compact Theme Toggle */}
            <ThemeToggle compact />

            {/* Compact AI Chat Toggle */}
            <HomeAIChatToggleButton />
          </div>
        </div>
      </div>

      {/* Search Dialog */}
      <CustomSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
      />
    </>
  );
}

// Main Home Layout Component
export function HomeLayout({ children }: { children: ReactNode }) {
  // Add home-page class to body to exclude from chat content shifting
  useEffect(() => {
    document.body.classList.add('home-page');
    return () => {
      document.body.classList.remove('home-page');
    };
  }, []);

  // Add scroll detection for homepage
  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const isScrolled = scrollY > 50;

      if (isScrolled) {
        document.body.classList.add('scrolled');
      } else {
        document.body.classList.remove('scrolled');
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      document.body.classList.remove('scrolled');
    };
  }, []);

  return (
    <SidebarProvider>
      <div className="relative flex min-h-screen flex-col bg-fd-background">
        <HomeNavbar />
        <main className="flex-1">
          {children}
        </main>
        <AIChatDrawer />
      </div>
    </SidebarProvider>
  );
}
