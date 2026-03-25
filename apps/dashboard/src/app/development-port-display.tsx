"use client";

import { useState } from "react";
import { getPublicEnvVar } from "../lib/env";


export function DevelopmentPortDisplay() {
  const [isVisible, setIsVisible] = useState(true);
  const prefix = getPublicEnvVar("NEXT_PUBLIC_STACK_PORT_PREFIX");
  if (!prefix || !isVisible || !process.env.NODE_ENV.includes("development")) return null;
  const color = ({
    "91": "#eee",
    "92": "#fff8e0",
    "93": "#e0e0ff",
  } as any)[prefix as any] || undefined;
  if (!color) return null;
  return (
    <div onClick={() => setIsVisible(false)} className="fixed top-0 left-0 p-2 text-red-700 animate-[dev-port-slide_120s_linear_infinite] flex gap-2" style={{
      backgroundColor: color,
      zIndex: 10000000,
    }}>
      <style>{`
        @keyframes dev-port-slide {
          0% { transform: translateX(0); }
          100% { transform: translateX(100vw); }
        }
      `}</style>
      <div className="text-lg">
        PORT: {prefix}xx
      </div>
      <div className="text-xs">
        <span className="hidden xs:inline sm:hidden">
          xs
        </span>
        <span className="hidden sm:inline md:hidden">
          sm
        </span>
        <span className="hidden md:inline lg:hidden">
          md
        </span>
        <span className="hidden lg:inline xl:hidden">
          lg
        </span>
        <span className="hidden xl:inline 2xl:hidden">
          xl
        </span>
        <span className="hidden 2xl:inline">
          2xl
        </span>
      </div>
    </div>
  );
}
