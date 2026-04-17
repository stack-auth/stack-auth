"use client";

import { createContext, useContext } from "react";

const DesignEditModeContext = createContext(false);

export function DesignEditMode({ children }: { children: React.ReactNode }) {
  return (
    <DesignEditModeContext.Provider value={true}>
      {children}
    </DesignEditModeContext.Provider>
  );
}

export function useDesignEditMode(): boolean {
  return useContext(DesignEditModeContext);
}
