"use client";

import { useEffect, useState } from "react";

export function BackgroundShine() {
  const [scrollY, setScrollY] = useState(0);
  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="fixed inset-0 hidden dark:block opacity-75"
      style={{
        transition: 'transform 0.05s ease-in-out',
        transform: `translateY(${-scrollY * 0.2}px)`,
      }}
      inert={true}
    >
      <div style={{
        position: 'absolute',
        top: '-10%',
        left: '70%',
        width: '20%',
        height: '20%',
        background: 'linear-gradient(to bottom, #4E61B3, #9196F4)',
        borderRadius: '100%',
        filter: 'blur(100px)',
      }} />
      <div style={{
        position: 'absolute',
        top: '-5%',
        left: '60%',
        width: '15%',
        height: '10%',
        background: 'linear-gradient(to bottom, #6E8BB6, #9196F4)',
        borderRadius: '100%',
        filter: 'blur(100px)',
      }} />
      <div style={{
        position: 'absolute',
        top: '-8%',
        left: '73%',
        width: '10%',
        height: '10%',
        background: 'linear-gradient(to bottom, #22C55E, #9196F4)',
        borderRadius: '100%',
        filter: 'blur(75px)',
      }} />
    </div>
  );
}
