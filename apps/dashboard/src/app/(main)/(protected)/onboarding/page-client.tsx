'use client';

import { Logo } from "@/components/logo";
import { Terminal, TypingAnimation } from "@/components/onboarding/terminal";
import { TypewriterEffectSmooth } from "@/components/onboarding/typing";
import { Button } from "@stackframe/stack-ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface OnboardingStep {
  id: string;
  component: React.ComponentType<{ onNext: () => void; onSkip: () => void; }>;
}

// Step 1: Dictionary-style entry point
function WelcomeStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void; }) {
  const [showTerminal, setShowTerminal] = useState(false);
  const [shrinkLogo, setShrinkLogo] = useState(false);
  const [startTerminalTyping, setStartTerminalTyping] = useState(false);
  const [hideTitleCursor, setHideTitleCursor] = useState(false);
  const [currentCursorLine, setCurrentCursorLine] = useState<0 | 1 | 2 | 3>(0);
  const [showPrompt, setShowPrompt] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [nameSubmitted, setNameSubmitted] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const placeholderText = "my-awesome-project";

  // Terminal typing script configuration
  const line1Text = "Welcome to Stack Auth! 🚀";
  const line1Dur = 50; // ms per character
  const promptText = "$ What would you like to name your project?";
  const promptDur = 40; // ms per character
  const promptDelay = line1Text.length * line1Dur + 200; // after line1 completes

  // Add keyboard support for Enter key
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        onNext();
      }
    };
    
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [onNext]);

  // Show terminal after typing completes (faster timing)
  useEffect(() => {
    const terminalTimer = setTimeout(() => {
      // Hide title cursor shortly after title typing finishes
      setHideTitleCursor(true);
      setShowTerminal(true);
      // Start shrinking logo quickly after terminal appears
      setTimeout(() => {
        setShrinkLogo(true);
        // Start terminal typing after logo finishes shrinking (500ms duration + 200ms buffer)
        setTimeout(() => {
          setStartTerminalTyping(true);
          // Begin cursor on line 1 immediately
          setCurrentCursorLine(1);
          // Move the cursor when the prompt line starts typing
          setTimeout(() => setCurrentCursorLine(2), promptDelay);
          // After prompt finishes typing, show input
          setTimeout(() => {
            setCurrentCursorLine(0);
            setShowPrompt(true);
            setTimeout(() => inputRef.current?.focus(), 50);
          }, promptDelay + promptText.length * promptDur + 200);
        }, 700);
      }, 200);
    }, 2500);

    return () => clearTimeout(terminalTimer);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      <div className="text-center w-full mx-auto relative">
        {/* Terminal that appears around logo */}
        {showTerminal && (
          <div className="animate-fade-in absolute inset-0 flex items-center justify-center z-0">
            <Terminal className="w-full max-w-5xl min-h-[300px] mx-8 [&_code]:text-left" sequence={false}>
              {/* Empty first line to make space for logo */}
              <div className="h-6"></div>
              {startTerminalTyping && (
                <>
                  <div className="flex items-center">
                    <TypingAnimation duration={50} delay={0} className="text-left">
                      Welcome to Stack Auth! 🚀
                    </TypingAnimation>
                    {currentCursorLine === 1 && (
                      <span className="ml-1 inline-block align-baseline rounded-sm w-[0.3em] h-[1em] bg-white animate-pulse"></span>
                    )}
                  </div>
                  <div className="flex items-center">
                    <TypingAnimation duration={promptDur} delay={promptDelay} className="text-left text-sm">
                      $ What would you like to name your project?
                    </TypingAnimation>
                    {currentCursorLine === 2 && (
                      <span className="ml-1 inline-block align-baseline rounded-sm w-[0.3em] h-[1em] bg-white animate-pulse"></span>
                    )}
                  </div>
                  {showPrompt && (
                    <div className="mt-2 text-left">
                      {!nameSubmitted ? (
                        <div className="flex items-center mt-2">
                          <span className="text-muted-foreground">&gt;</span>
                          <input
                            ref={inputRef}
                            value={projectName}
                            onChange={(e) => setProjectName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && projectName.trim().length > 0) {
                                setNameSubmitted(true);
                              }
                            }}
                            className="ml-2 bg-transparent outline-none border-none text-sm w-auto caret-transparent"
                            style={{ width: `${Math.max((projectName || placeholderText).length, 1)}ch` }}
                            placeholder={placeholderText}
                          />
                          <span className="ml-[0.05em] inline-block align-baseline rounded-sm w-[0.3em] h-[1em] bg-white animate-pulse"></span>
                        </div>
                      ) : (
                        <div className="flex items-center mt-2">
                          <span className="text-muted-foreground">&gt;</span>
                          <span className="ml-2">{projectName}</span>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </Terminal>
          </div>
        )}
        
        {/* Logo and Main Title with typing effect */}
        <div 
          className={`mb-4 animate-fade-from-top transition-all duration-500 relative z-10 ${
            shrinkLogo 
              ? 'transform scale-[0.25] -translate-y-20 -translate-x-[28rem]' 
              : ''
          }`}
        >
          <div className="flex items-center justify-center space-x-6">
            <div className="w-20 h-20 flex items-center justify-center">
              <Logo noLink className="w-16 h-16 [&_svg_path]:fill-current text-white" />
            </div>
            <div className="text-6xl font-bold tracking-wider">
              <TypewriterEffectSmooth
                words={[
                  { text: "Stack" },
                  { text: "Auth" },
                ]}
                className="text-6xl font-bold tracking-wider text-left justify-start [&>div>div]:text-6xl [&>div>div]:font-bold [&>div>div]:tracking-wider"
                 cursorClassName={`bg-current w-1 h-12`}
                 hideCursor={hideTitleCursor}
              />
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes fade-from-top {
          from {
            opacity: 0;
            transform: translateY(-30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes slide-in {
          from {
            opacity: 0;
            transform: translateX(-20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes glow {
          0%, 100% {
            text-shadow: 0 0 20px rgba(255, 255, 255, 0.1);
          }
          50% {
            text-shadow: 0 0 30px rgba(255, 255, 255, 0.2);
          }
        }

        .animate-fade-in {
          animation: fade-in 0.6s ease-out;
        }

        .animate-fade-from-top {
          animation: fade-from-top 0.6s ease-out;
        }

        .animate-fade-in-delayed {
          animation: fade-in 0.6s ease-out 2.2s both;
        }

        .animate-fade-in-delayed-more {
          animation: fade-in 0.6s ease-out 2.5s both;
        }

        .animate-glow {
          animation: glow 3s ease-in-out infinite;
        }

        .animate-slide-in {
          animation: slide-in 0.5s ease-out 2.8s both;
        }
      `}</style>
    </div>
  );
}

// Placeholder for future steps
function PlaceholderStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void; }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center space-y-8">
        <h2 className="text-3xl font-bold">Step Coming Soon</h2>
        <p className="text-muted-foreground">This step will be implemented next.</p>
        <div className="flex justify-center space-x-4">
          <Button onClick={onNext}>Continue</Button>
          <Button onClick={onSkip} variant="outline">Skip</Button>
        </div>
      </div>
    </div>
  );
}

export default function OnboardingPageClient() {
  const router = useRouter();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const steps: OnboardingStep[] = [
    { id: 'welcome', component: WelcomeStep },
    { id: 'placeholder', component: PlaceholderStep },
  ];

  const handleNext = () => {
    if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex(currentStepIndex + 1);
    } else {
      // Finished onboarding, redirect to new project
      router.push('/new-project');
    }
  };

  const handleSkip = () => {
    // Skip to projects page
    router.push('/projects');
  };

  const CurrentStepComponent = steps[currentStepIndex]?.component || PlaceholderStep;

  return <CurrentStepComponent onNext={handleNext} onSkip={handleSkip} />;
}
