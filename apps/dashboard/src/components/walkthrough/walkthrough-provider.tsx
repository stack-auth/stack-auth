'use client';

import { getPublicEnvVar } from '@/lib/env';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type SpotlightRect, WALKTHROUGH_STEPS } from './walkthrough-steps';
import { WalkthroughOverlay } from './walkthrough-overlay';

// Timing multiplier for debugging — set to 1.0 for production, lower to speed up
const TIMING_MULTIPLIER = 1.0;

function useProjectId() {
  if (typeof window === 'undefined') return null;
  const match = window.location.pathname.match(/\/projects\/([^/]+)/);
  return match ? match[1] : null;
}

function waitForElement(selector: string, timeoutMs = 3000): Promise<Element | null> {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing && existing.getBoundingClientRect().height > 0) {
      resolve(existing);
      return;
    }

    const start = Date.now();
    const check = () => {
      const el = document.querySelector(selector);
      if (el && el.getBoundingClientRect().height > 0) {
        resolve(el);
      } else if (Date.now() - start > timeoutMs) {
        resolve(null);
      } else {
        requestAnimationFrame(check);
      }
    };
    requestAnimationFrame(check);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms * TIMING_MULTIPLIER));
}

// For waits that depend on CSS animations / external timing, not walkthrough pacing
function sleepFixed(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function typeIntoInput(input: HTMLInputElement, text: string, cancelled: () => boolean) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  nativeInputValueSetter.call(input, '');
  input.dispatchEvent(new Event('input', { bubbles: true }));

  for (const char of text) {
    if (cancelled()) return;
    const currentValue = input.value + char;
    nativeInputValueSetter.call(input, currentValue);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(60 + Math.random() * 40);
  }
}

export function WalkthroughProvider({ children }: { children: React.ReactNode }) {
  const isPreview = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_PREVIEW") === "true";

  if (!isPreview) {
    return <>{children}</>;
  }

  return (
    <>
      {children}
      <WalkthroughEngine />
    </>
  );
}

function WalkthroughEngine() {
  const [isRunning, setIsRunning] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [spotlightRect, setSpotlightRect] = useState<SpotlightRect | null>(null);
  const [showSpotlight, setShowSpotlight] = useState(false);
  const [cursorPosition, setCursorPosition] = useState({ x: -50, y: -50 });
  const [isHovering, setIsHovering] = useState(false);
  const stoppedRef = useRef(false);
  const rafRef = useRef<number>(0);
  const currentPathRef = useRef<string>('/');

  const projectId = useProjectId();

  const stop = useCallback(() => {
    stoppedRef.current = true;
    setIsRunning(false);
    setShowSpotlight(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
  }, []);

  // Send "ready" to parent and listen for "visible" response
  useEffect(() => {
    if (stoppedRef.current) return;

    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    if (!mediaQuery.matches) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'stack-preview-visible' && !stoppedRef.current) {
        setTimeout(() => {
          if (!stoppedRef.current) {
            setIsRunning(true);
          }
        }, 2000 * TIMING_MULTIPLIER);
      }
    };

    window.addEventListener('message', handleMessage);
    window.parent.postMessage({ type: 'stack-preview-ready' }, '*');

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Track mouse hover for "Click to take control" overlay
  useEffect(() => {
    if (!isRunning) return;

    const handleMove = () => setIsHovering(true);
    const handleLeave = () => setIsHovering(false);

    document.documentElement.addEventListener('mousemove', handleMove);
    document.documentElement.addEventListener('mouseleave', handleLeave);
    return () => {
      document.documentElement.removeEventListener('mousemove', handleMove);
      document.documentElement.removeEventListener('mouseleave', handleLeave);
    };
  }, [isRunning]);

  // Main walkthrough engine
  useEffect(() => {
    if (!isRunning || !projectId) return;

    let cancelled = false;
    const isCancelled = () => cancelled || stoppedRef.current;

    const navigateViaCmdK = async (searchText: string) => {
      // Move cursor to CmdK trigger button
      const cmdkTrigger = document.querySelector('[data-walkthrough-nav="cmdk-trigger"]') as HTMLElement | null;
      if (!cmdkTrigger) return false;

      const triggerRect = cmdkTrigger.getBoundingClientRect();
      setCursorPosition({
        x: triggerRect.left + triggerRect.width / 2,
        y: triggerRect.top + triggerRect.height / 2,
      });
      await sleep(600);
      if (isCancelled()) return false;

      // Open CmdK
      window.dispatchEvent(new CustomEvent('spotlight-toggle'));
      await sleep(400);
      if (isCancelled()) return false;

      // Find the input and type into it
      const input = document.querySelector('input[placeholder="Search or ask AI..."]') as HTMLInputElement | null;
      if (!input) return false;

      const inputRect = input.getBoundingClientRect();
      setCursorPosition({
        x: inputRect.left + inputRect.width / 3,
        y: inputRect.top + inputRect.height / 2,
      });
      await sleep(500);
      if (isCancelled()) return false;

      await typeIntoInput(input, searchText, isCancelled);
      if (isCancelled()) return false;

      await sleep(400);
      if (isCancelled()) return false;

      // Click the first result
      await sleep(100);
      if (isCancelled()) return false;

      const cmdkContainer = input.closest('.rounded-2xl');
      const resultButton = cmdkContainer?.querySelector('.border-t button') as HTMLElement | null;

      if (resultButton) {
        const resultRect = resultButton.getBoundingClientRect();
        setCursorPosition({
          x: resultRect.left + resultRect.width / 2,
          y: resultRect.top + resultRect.height / 2,
        });
        await sleep(400);
        if (isCancelled()) return false;

        resultButton.click();
        await sleep(500);
        if (isCancelled()) return false;
      }

      return true;
    };

    const navigateViaSidebar = async (label: string) => {
      const isVisibleInOverflowAncestors = (el: HTMLElement): boolean => {
        const rect = el.getBoundingClientRect();
        let parent = el.parentElement;
        while (parent) {
          const style = getComputedStyle(parent);
          if (style.overflow === 'hidden' || style.overflowY === 'hidden') {
            const parentRect = parent.getBoundingClientRect();
            if (rect.bottom <= parentRect.top || rect.top >= parentRect.bottom) {
              return false;
            }
          }
          parent = parent.parentElement;
        }
        return true;
      };

      const findSidebarLink = () => {
        for (const link of document.querySelectorAll('aside a')) {
          if (link.textContent.trim() === label && isVisibleInOverflowAncestors(link as HTMLElement)) {
            return link as HTMLElement;
          }
        }
        return null;
      };

      let targetLink = findSidebarLink();

      // If link isn't visible, find and expand its parent section
      if (!targetLink) {
        // Find the link in DOM (even if hidden) to locate its parent section button
        for (const link of document.querySelectorAll('aside a')) {
          if (link.textContent.trim() === label) {
            // Walk up to find the closest collapsed section
            let el = link.parentElement;
            while (el && el.tagName !== 'ASIDE') {
              const prevSibling = el.previousElementSibling;
              if (prevSibling?.tagName === 'BUTTON' && prevSibling.getAttribute('aria-expanded') === 'false') {
                (prevSibling as HTMLElement).click();
                break;
              }
              el = el.parentElement;
            }
            break;
          }
        }
        // Wait for CSS height transition (200ms) to complete
        await sleepFixed(300);
        if (isCancelled()) return false;
        targetLink = findSidebarLink();
      }

      if (!targetLink) return false;

      // Scroll the sidebar to make the link visible (not the outer page)
      const scrollContainer = targetLink.closest('[class*="overflow-y-auto"]') ?? targetLink.closest('aside');
      if (scrollContainer) {
        const linkTop = targetLink.offsetTop;
        scrollContainer.scrollTo({ top: linkTop - scrollContainer.clientHeight / 2 });
      }
      // Wait a frame for scroll to settle before reading position
      await sleepFixed(50);
      if (isCancelled()) return false;

      const linkRect = targetLink.getBoundingClientRect();
      setCursorPosition({
        x: linkRect.left + linkRect.width / 2,
        y: linkRect.top + linkRect.height / 2,
      });
      await sleep(600);
      if (isCancelled()) return false;

      targetLink.click();
      await sleep(500);
      if (isCancelled()) return false;

      return true;
    };

    const runWalkthrough = async () => {
      for (let i = 0; i < WALKTHROUGH_STEPS.length; i++) {
        if (isCancelled()) return;

        const step = WALKTHROUGH_STEPS[i];
        setStepIndex(i);
        setShowSpotlight(false);

        const needsNavigation = currentPathRef.current !== step.path;

        // Phase 1: Navigate if needed
        if (needsNavigation) {
          let success = false;
          if (step.cmdkSearch) {
            success = await navigateViaCmdK(step.cmdkSearch);
          } else if (step.sidebarNavLabel) {
            success = await navigateViaSidebar(step.sidebarNavLabel);
          }
          if (isCancelled()) return;
          if (success) {
            currentPathRef.current = step.path;
            await sleep(300);
            if (isCancelled()) return;
          }
        }

        // Phase 2: Wait for target element
        const targetEl = await waitForElement(`[data-walkthrough="${step.id}"]`);
        if (isCancelled()) return;
        if (!targetEl) continue;

        // Phase 3: Animate mouse to target element
        const targetRect = targetEl.getBoundingClientRect();
        setCursorPosition({
          x: targetRect.left + targetRect.width / 2,
          y: targetRect.top + targetRect.height / 2,
        });
        await sleep(600);
        if (isCancelled()) return;

        // Phase 4: Show spotlight
        setSpotlightRect({
          top: targetRect.top,
          left: targetRect.left,
          width: targetRect.width,
          height: targetRect.height,
        });
        setShowSpotlight(true);

        // Continuously track element position
        const trackElement = () => {
          if (isCancelled()) return;
          const el = document.querySelector(`[data-walkthrough="${step.id}"]`);
          if (el) {
            const rect = el.getBoundingClientRect();
            setSpotlightRect({
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
            });
          }
          rafRef.current = requestAnimationFrame(trackElement);
        };
        rafRef.current = requestAnimationFrame(trackElement);

        // Phase 5: Wait at this step
        await sleep(8000);
        cancelAnimationFrame(rafRef.current);
        if (isCancelled()) return;
      }

      // Walkthrough complete
      setShowSpotlight(false);
      setIsRunning(false);
    };

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    runWalkthrough();

    return () => {
      cancelled = true;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [isRunning, projectId]);

  if (!isRunning) return null;

  const currentStep = WALKTHROUGH_STEPS[stepIndex] ?? null;

  return (
    <WalkthroughOverlay
      step={currentStep}
      stepIndex={stepIndex}
      totalSteps={WALKTHROUGH_STEPS.length}
      spotlightRect={spotlightRect}
      cursorPosition={cursorPosition}
      showSpotlight={showSpotlight}
      isHovering={isHovering}
      onStop={stop}
    />
  );
}
