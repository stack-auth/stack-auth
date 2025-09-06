'use client';

import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type CodeOverlayContextType = {
  isOpen: boolean,
  code: string,
  language: string,
  title: string,
  openOverlay: (code: string, language?: string, title?: string) => void,
  closeOverlay: () => void,
  toggleOverlay: () => void,
};

const CodeOverlayContext = createContext<CodeOverlayContextType | null>(null);

export function CodeOverlayProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState('tsx');
  const [title, setTitle] = useState('Code Example');
  const [, setCurrentPage] = useState('');
  const pathname = usePathname();

  // Close overlay when navigating to a different page
  useEffect(() => {
      setIsOpen(false);
    setCurrentPage(pathname);
  }, [pathname]);

  const openOverlay = useCallback((newCode: string, newLanguage = 'tsx', newTitle = 'Code Example') => {
    setCode(newCode);
    setLanguage(newLanguage);
    setTitle(newTitle);
    setIsOpen(true);
  }, []);

  const closeOverlay = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggleOverlay = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  const contextValue = useMemo(() => ({
    isOpen,
    code,
    language,
    title,
    openOverlay,
    closeOverlay,
    toggleOverlay,
  }), [isOpen, code, language, title, openOverlay, closeOverlay, toggleOverlay]);

  return (
    <CodeOverlayContext.Provider value={contextValue}>
      {children}
    </CodeOverlayContext.Provider>
  );
}

export function useCodeOverlay() {
  const context = useContext(CodeOverlayContext);
  if (!context) {
    throw new Error('useCodeOverlay must be used within a CodeOverlayProvider');
  }
  return context;
}
