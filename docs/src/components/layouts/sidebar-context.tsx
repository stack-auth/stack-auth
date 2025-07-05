'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type SidebarType = 'toc' | 'chat' | 'auth' | null;

type SidebarContextType = {
  // Current active sidebar
  activeSidebar: SidebarType,

  // TOC state
  isTocOpen: boolean,
  setTocOpen: (open: boolean) => void,
  toggleToc: () => void,

  // Chat state
  isChatOpen: boolean,
  setChatOpen: (open: boolean) => void,
  toggleChat: () => void,

  // Chat expansion
  isChatExpanded: boolean,
  setChatExpanded: (expanded: boolean) => void,

  // Auth state
  isAuthOpen: boolean,
  setAuthOpen: (open: boolean) => void,
  toggleAuth: () => void,

  // Full page state
  isFullPage: boolean,
  setIsFullPage: (fullPage: boolean) => void,

  // Unified controls
  openSidebar: (type: SidebarType) => void,
  closeSidebar: () => void,
}

const SidebarContext = createContext<SidebarContextType | null>(null);

export function useSidebar() {
  const context = useContext(SidebarContext);
  return context;
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [activeSidebar, setActiveSidebar] = useState<SidebarType>(null);
  const [isChatExpanded, setIsChatExpanded] = useState(false);
  const [isFullPage, setIsFullPage] = useState(false);

  // Load state from localStorage on mount
  useEffect(() => {
    const savedChat = localStorage.getItem('ai-chat-open');
    const savedExpanded = localStorage.getItem('ai-chat-expanded');

    if (savedChat === 'true') {
      setActiveSidebar('chat');
    }
    if (savedExpanded === 'true') {
      setIsChatExpanded(true);
    }
  }, []);

  // Manage body classes based on sidebar state
  useEffect(() => {
    // Remove all classes first
    document.body.classList.remove('chat-open', 'toc-open', 'auth-open');

    // Add appropriate class based on active sidebar
    if (activeSidebar === 'chat') {
      document.body.classList.add('chat-open');
    } else if (activeSidebar === 'toc') {
      document.body.classList.add('toc-open');
    } else if (activeSidebar === 'auth') {
      document.body.classList.add('auth-open');
    }

    return () => {
      document.body.classList.remove('chat-open', 'toc-open', 'auth-open');
    };
  }, [activeSidebar]);

  // Derived state
  const isTocOpen = activeSidebar === 'toc';
  const isChatOpen = activeSidebar === 'chat';
  const isAuthOpen = activeSidebar === 'auth';

  // Individual controls
  const setTocOpen = (open: boolean) => {
    setActiveSidebar(open ? 'toc' : null);
  };

  const setChatOpen = (open: boolean) => {
    if (open) {
      setActiveSidebar('chat');
      localStorage.setItem('ai-chat-open', 'true');
    } else {
      setActiveSidebar(null);
      localStorage.setItem('ai-chat-open', 'false');
      setIsChatExpanded(false);
    }
  };

  const setAuthOpen = (open: boolean) => {
    setActiveSidebar(open ? 'auth' : null);
  };

  const toggleToc = () => setTocOpen(!isTocOpen);
  const toggleChat = () => setChatOpen(!isChatOpen);
  const toggleAuth = () => setAuthOpen(!isAuthOpen);

  const setChatExpanded = (expanded: boolean) => {
    setIsChatExpanded(expanded);
    localStorage.setItem('ai-chat-expanded', expanded.toString());
  };

  // Unified controls
  const openSidebar = (type: SidebarType) => {
    setActiveSidebar(type);

    if (type === 'chat') {
      localStorage.setItem('ai-chat-open', 'true');
    } else {
      localStorage.setItem('ai-chat-open', 'false');
    }
  };

  const closeSidebar = () => {
    setActiveSidebar(null);
    localStorage.setItem('ai-chat-open', 'false');
    setIsChatExpanded(false);
  };

  return (
    <SidebarContext.Provider value={{
      activeSidebar,
      isTocOpen,
      setTocOpen,
      toggleToc,
      isChatOpen,
      setChatOpen,
      toggleChat,
      isChatExpanded,
      setChatExpanded,
      isAuthOpen,
      setAuthOpen,
      toggleAuth,
      isFullPage,
      setIsFullPage,
      openSidebar,
      closeSidebar,
    }}>
      {children}
    </SidebarContext.Provider>
  );
}
