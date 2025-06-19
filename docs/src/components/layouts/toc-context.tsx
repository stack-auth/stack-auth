'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

type TOCContextType = {
  isTocOpen: boolean,
  setIsTocOpen: (open: boolean) => void,
  toggleToc: () => void,
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

  const toggleToc = () => setIsTocOpen(!isTocOpen);

  return (
    <TOCContext.Provider value={{ isTocOpen, setIsTocOpen, toggleToc }}>
      {children}
    </TOCContext.Provider>
  );
}
