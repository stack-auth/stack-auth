"use client";

import { LargeSearchToggle } from '@/components/layout/search-toggle';
import { platformSupportsComponents, platformSupportsSDK } from "@/lib/navigation-utils";
import { PLATFORMS, type Platform } from "@/lib/platform-utils";
import { Book, ChevronDown, Code, Layers, Zap } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

type DocsSection = {
  id: string,
  title: string,
  description: string,
  icon: React.ReactNode,
  url: string,
  color: string,
}

type DocsIcon3DProps = {
  sections?: DocsSection[],
  onSectionSelect?: (section: DocsSection) => void,
  selectedPlatform?: Platform,
}

const createPlatformSections = (platform: Platform): DocsSection[] => {
  const sections: DocsSection[] = [
    {
      id: "guides",
      title: "Guides",
      description: "Complete guides and tutorials",
      icon: <Book size={24} />,
      url: `/docs/${platform}/overview`,
      color: "rgb(59, 130, 246)",
    },
  ];

  // Add SDK if platform supports it
  if (platformSupportsSDK(platform)) {
    sections.push({
      id: "sdks",
      title: "SDKs",
      description: "Software development kits",
      icon: <Code size={24} />,
      url: `/docs/${platform}/sdk/overview`,
      color: "rgb(16, 185, 129)",
    });
  }

  // Add Components if platform supports it
  if (platformSupportsComponents(platform)) {
    sections.push({
      id: "components",
      title: "Components",
      description: "Reusable UI components",
      icon: <Layers size={24} />,
      url: `/docs/${platform}/components/overview`,
      color: "rgb(245, 101, 101)",
    });
  }

  // Always add API (platform agnostic)
  sections.push({
    id: "api",
    title: "API Reference",
    description: "Complete API documentation",
    icon: <Zap size={24} />,
    url: "/api/overview",
    color: "rgb(168, 85, 247)",
  });

  return sections;
};

const PlatformSelector: React.FC<{
  selectedPlatform: Platform,
  onPlatformChange: (platform: Platform) => void,
}> = ({ selectedPlatform, onPlatformChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredPlatform, setHoveredPlatform] = useState<Platform | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const platformNames: Record<Platform, string> = {
    next: "Next.js",
    react: "React",
    js: "JavaScript",
    python: "Python",
  };

  const platformColors: Record<Platform, string> = {
    next: "rgb(59, 130, 246)", // Blue
    react: "rgb(16, 185, 129)", // Green
    js: "rgb(245, 158, 11)", // Yellow
    python: "rgb(168, 85, 247)", // Purple
  };

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setHoveredPlatform(null);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="relative mb-8">
      <div className="text-center mb-4">
        <h3 className="text-lg font-semibold text-foreground mb-2">Choose Your Platform</h3>
        <p className="text-sm text-muted-foreground">Select your development environment</p>
      </div>

      <div className="relative inline-block w-64 mx-auto" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between px-4 py-3 bg-background border-2 border-border rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
          style={{
            borderColor: platformColors[selectedPlatform],
            boxShadow: `0 4px 20px ${platformColors[selectedPlatform]}20`,
          }}
        >
          <span
            className="font-semibold"
            style={{ color: platformColors[selectedPlatform] }}
          >
            {platformNames[selectedPlatform]}
          </span>
          <ChevronDown
            size={20}
            className={`transform transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
            style={{ color: platformColors[selectedPlatform] }}
          />
        </button>

        {isOpen && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-background/95 backdrop-blur-lg border-2 border-border rounded-xl shadow-2xl z-50 overflow-hidden">
            {PLATFORMS.map((platform) => {
              const isSelected = selectedPlatform === platform;
              const isHovered = hoveredPlatform === platform;
              const isHighlighted = isSelected || isHovered;

              return (
                <button
                  key={platform}
                  onClick={() => {
                    onPlatformChange(platform);
                    setIsOpen(false);
                    setHoveredPlatform(null);
                  }}
                  onMouseEnter={() => setHoveredPlatform(platform)}
                  onMouseLeave={() => setHoveredPlatform(null)}
                  className={`
                    w-full px-4 py-3 text-left transition-all duration-200
                    border-l-4 border-transparent
                    ${isHighlighted ? "bg-muted/70" : "hover:bg-muted/30"}
                  `}
                  style={{
                    borderLeftColor: isHighlighted ? platformColors[platform] : "transparent",
                    backgroundColor: isHighlighted ? `${platformColors[platform]}15` : undefined,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`font-medium transition-all duration-200 ${
                        isHighlighted ? "font-semibold" : ""
                      }`}
                      style={{
                        color: isHighlighted ? platformColors[platform] : undefined,
                      }}
                    >
                      {platformNames[platform]}
                    </span>
                    {isSelected && (
                      <div
                        className="w-2 h-2 rounded-full transition-all duration-200"
                        style={{ backgroundColor: platformColors[platform] }}
                      />
                    )}
                    {isHovered && !isSelected && (
                      <div
                        className="w-1.5 h-1.5 rounded-full transition-all duration-200"
                        style={{ backgroundColor: platformColors[platform], opacity: 0.6 }}
                      />
                    )}
                  </div>
                  <div className={`text-xs mt-1 transition-all duration-200 ${
                    isHighlighted ? "text-muted-foreground" : "text-muted-foreground/70"
                  }`}>
                    {platform === "next" && "Full-stack React framework"}
                    {platform === "react" && "Client-side React applications"}
                    {platform === "js" && "Vanilla JavaScript integration"}
                    {platform === "python" && "Backend Python applications"}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

const DocsIcon3D: React.FC<DocsIcon3DProps> = ({
  sections,
  onSectionSelect,
  selectedPlatform = "next"
}) => {
  const [hoveredSection, setHoveredSection] = useState<string | null>(null);

  // Use platform-based sections if none provided
  const platformSections = sections || createPlatformSections(selectedPlatform);

  const handleSectionClick = (section: DocsSection) => {
    if (onSectionSelect) {
      onSectionSelect(section);
    } else {
      window.location.href = section.url;
    }
  };

  // Add custom CSS for the floating animation
  const floatingDotsStyle = `
  @keyframes float-up {
    0% {
      transform: translateY(0px) scale(1);
      opacity: 0.8;
      filter: blur(0px);
    }
    50% {
      opacity: 0.6;
      filter: blur(0.5px);
    }
    100% {
      transform: translateY(-200px) scale(0.3);
      opacity: 0;
      filter: blur(1px);
    }
  }
  .animate-float-up {
    animation: float-up 3s ease-out infinite;
  }
`;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: floatingDotsStyle }} />
      <div className="flex justify-center items-center p-4">
        <div
          className={`
            grid gap-4 max-w-4xl w-full justify-center
            ${platformSections.length === 1 ? 'grid-cols-1 max-w-xs' : ''}
            ${platformSections.length === 2 ? 'grid-cols-1 md:grid-cols-2 max-w-lg' : ''}
            ${platformSections.length === 3 ? 'grid-cols-1 md:grid-cols-3 max-w-2xl' : ''}
            ${platformSections.length === 4 ? 'grid-cols-2 md:grid-cols-4' : ''}
          `}
        >
          {platformSections.map((section) => (
            <div
              key={section.id}
              className={`
              relative cursor-pointer group
              transform transition-all duration-500 ease-out
              hover:scale-105 hover:-translate-y-2 hover:rotate-1
              active:scale-95 active:rotate-0
            `}
              onMouseEnter={() => setHoveredSection(section.id)}
              onMouseLeave={() => setHoveredSection(null)}
              onClick={() => handleSectionClick(section)}
            >
              <div
                className={`
                relative bg-gradient-to-br from-background via-background to-muted/20
                border-2 border-border rounded-2xl p-4 w-full h-44 
                flex flex-col items-center justify-center 
                shadow-xl hover:shadow-2xl
                overflow-hidden backdrop-blur-sm
                transition-all duration-500 ease-out
                before:absolute before:inset-0 before:bg-gradient-to-br before:opacity-0
                hover:before:opacity-100 before:transition-opacity before:duration-500
                ${hoveredSection === section.id ? "border-opacity-100 shadow-2xl" : "border-opacity-50"}
              `}
                style={{
                  transformStyle: "preserve-3d",
                  perspective: "1000px",
                  borderColor: hoveredSection === section.id ? section.color : undefined,
                  boxShadow:
                    hoveredSection === section.id
                      ? `0 25px 50px -12px ${section.color}40, 0 0 0 1px ${section.color}20`
                      : undefined,
                }}
              >
                {/* Animated background gradient */}
                <div
                  className={`
                  absolute inset-0 rounded-2xl transition-opacity duration-500
                  ${hoveredSection === section.id ? "opacity-100" : "opacity-0"}
                `}
                  style={{
                    background: `
                    radial-gradient(circle at 30% 20%, ${section.color}15 0%, transparent 50%),
                    linear-gradient(135deg, ${section.color}08, ${section.color}03, transparent)
                  `,
                  }}
                />

                {/* Continuous upward floating dots effect */}
                <div className="absolute inset-0 overflow-hidden rounded-2xl">
                  {hoveredSection === section.id && (
                    <div className="absolute inset-0">
                      {[...Array(12)].map((_, i) => (
                        <div
                          key={`${section.id}-${i}`}
                          className="absolute w-1.5 h-1.5 rounded-full animate-float-up"
                          style={{
                            backgroundColor: section.color,
                            left: `${10 + Math.random() * 80}%`,
                            bottom: "-6px",
                            animationDelay: `${i * 0.3}s`,
                            animationDuration: "3s",
                            animationIterationCount: "infinite",
                            animationTimingFunction: "ease-out",
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* 3D Icon Container */}
                <div
                  className={`
                  relative mb-4 transition-all duration-700 ease-out
                  ${
                    hoveredSection === section.id
                      ? "transform -rotate-y-12 rotate-x-6 translate-z-8"
                      : "transform rotate-0"
                  }
                `}
                  style={{
                    transformStyle: "preserve-3d",
                  }}
                >
                  {/* Enhanced shadow layers */}
                  <div
                    className={`
                    absolute inset-0 rounded-xl transition-all duration-500
                    ${hoveredSection === section.id ? "opacity-50 blur-sm" : "opacity-20"}
                  `}
                    style={{
                      backgroundColor: section.color,
                      transform: "translateZ(-6px) translateX(3px) translateY(3px)",
                    }}
                  />

                  {/* Main icon with enhanced styling */}
                  <div
                    className={`
                      relative z-10 w-16 h-16 rounded-xl flex items-center justify-center 
                      border-2 transition-all duration-500 ease-out
                      ${
                        hoveredSection === section.id
                          ? "text-white border-transparent scale-110 rotate-3"
                          : "text-foreground border-border bg-background scale-100"
                      }
                    `}
                    style={{
                      backgroundColor: hoveredSection === section.id ? section.color : undefined,
                      boxShadow:
                        hoveredSection === section.id
                          ? `0 12px 40px ${section.color}60, inset 0 1px 0 rgba(255,255,255,0.2)`
                          : `0 6px 25px ${section.color}30`,
                    }}
                  >
                    <div
                      className={`
                        transition-all duration-500 ease-out
                        ${hoveredSection === section.id ? "scale-125 rotate-6" : "scale-100"}
                      `}
                    >
                      {React.cloneElement(section.icon as React.ReactElement, {
                        size: 24,
                        strokeWidth: hoveredSection === section.id ? 2.5 : 2,
                      })}
                    </div>
                  </div>
                </div>

                {/* Enhanced Title */}
                <h3
                  className={`
                    text-lg font-bold mb-2 text-center transition-all duration-500
                    ${hoveredSection === section.id ? "scale-105 font-extrabold" : "scale-100"}
                  `}
                  style={{
                    color: hoveredSection === section.id ? section.color : undefined,
                    textShadow: hoveredSection === section.id ? `0 0 20px ${section.color}40` : undefined,
                  }}
                >
                  {section.title}
                </h3>

                {/* Enhanced Description */}
                <p
                  className={`
                    text-xs text-center leading-relaxed px-2 transition-all duration-500
                    ${
                      hoveredSection === section.id
                        ? "text-muted-foreground opacity-100 scale-105"
                        : "text-muted-foreground opacity-70"
                    }
                  `}
                >
                  {section.description}
                </p>

                {/* Enhanced hover indicator */}
                <div
                  className={`
                    absolute bottom-0 left-0 right-0 h-1.5 rounded-b-2xl
                    transition-all duration-500 ease-out
                    ${hoveredSection === section.id ? "scale-x-100" : "scale-x-0"}
                  `}
                  style={{
                    transformOrigin: "left",
                    backgroundColor: section.color,
                    boxShadow: hoveredSection === section.id ? `0 0 20px ${section.color}60` : undefined,
                  }}
                />

                {/* Enhanced corner accents with glow */}
                <div
                  className={`
                    absolute top-3 right-3 w-2 h-2 rounded-full
                    transition-all duration-500 ease-out
                    ${hoveredSection === section.id ? "scale-150 opacity-100" : "scale-75 opacity-30"}
                  `}
                  style={{
                    backgroundColor: section.color,
                    boxShadow: hoveredSection === section.id ? `0 0 15px ${section.color}80` : undefined,
                  }}
                />

                <div
                  className={`
                    absolute bottom-3 left-3 w-2 h-2 rounded-full
                    transition-all duration-500 ease-out
                    ${hoveredSection === section.id ? "scale-150 opacity-100" : "scale-75 opacity-30"}
                  `}
                  style={{
                    backgroundColor: section.color,
                    boxShadow: hoveredSection === section.id ? `0 0 15px ${section.color}80` : undefined,
                  }}
                />

                {/* New: Diagonal accent line */}
                <div
                  className={`
                    absolute top-0 right-0 w-16 h-16 overflow-hidden rounded-tr-2xl
                    transition-all duration-500
                    ${hoveredSection === section.id ? "opacity-100" : "opacity-0"}
                  `}
                >
                  <div
                    className="absolute top-0 right-0 w-full h-0.5 origin-top-right rotate-45 translate-x-2 translate-y-4"
                    style={{ backgroundColor: section.color }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};

export default function DocsSelector() {
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>("next");

  const handleSectionSelect = (section: DocsSection) => {
    console.log("Selected section:", section);
    // Navigate to the selected section
    if (section.url) {
      window.location.href = section.url;
    }
  };

  const handlePlatformChange = (platform: Platform) => {
    setSelectedPlatform(platform);
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      <PlatformSelector
        selectedPlatform={selectedPlatform}
        onPlatformChange={handlePlatformChange}
      />

      {/* Search Bar */}
      <div className="mb-8 flex justify-center">
        <div className="w-full max-w-md">
          <LargeSearchToggle className="w-full" />
        </div>
      </div>

      <DocsIcon3D
        selectedPlatform={selectedPlatform}
        onSectionSelect={handleSectionSelect}
      />
    </div>
  );
}

// Export the core component for direct use
export { DocsIcon3D };
