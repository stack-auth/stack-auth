'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

type TOCContextType = {
  isTocOpen: boolean,
  setIsTocOpen: (open: boolean) => void,
  toggleToc: () => void,
  isFullPage: boolean,
  setIsFullPage: (fullPage: boolean) => void,
}

const TOCContext = createContext<TOCContextType | null>(null);

export function useTOC() {
  const context = useContext(TOCContext);
  if (!context) {
    throw new Error('useTOC must be used within TOCProvider');
  }
  return context;
}

export function TOCProvider({ children }: { children: ReactNode }) {
  const [isTocOpen, setIsTocOpen] = useState(false); // Default closed
  const [isFullPage, setIsFullPage] = useState(false); // Default not full page

  const toggleToc = () => setIsTocOpen(!isTocOpen);

  return (
    <TOCContext.Provider value={{
      isTocOpen,
      setIsTocOpen,
      toggleToc,
      isFullPage,
      setIsFullPage
    }}>
      {children}
    </TOCContext.Provider>
  );
}
