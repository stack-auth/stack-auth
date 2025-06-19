'use client';

import { ChevronUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '../../lib/cn';
import { buttonVariants } from './button';

export function BackToTop() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const toggleVisibility = () => {
      // If user scrolls down more than 300px, show the button
      if (window.scrollY > 300) {
        setIsVisible(true);
      } else {
        setIsVisible(false);
      }
    };

    window.addEventListener('scroll', toggleVisibility);

    return () => window.removeEventListener('scroll', toggleVisibility);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  };

  return (
    <button
      onClick={scrollToTop}
      className={cn(
        buttonVariants({
          size: 'icon',
          color: 'secondary',
        }),
        'fixed bottom-8 right-8 z-50 shadow-lg opacity-0 transition-opacity duration-300',
        isVisible && 'opacity-100'
      )}
      aria-label="Back to top"
    >
      <ChevronUp className="h-5 w-5" />
    </button>
  );
}
