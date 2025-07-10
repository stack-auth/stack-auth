"use client";

import { Book, ChevronDown, Code, Command, Layers, Search, Zap } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { usePlatformPreference } from "../../hooks/use-platform-preference";
import { platformSupportsComponents, platformSupportsSDK } from "../../lib/navigation-utils";
import { PLATFORMS, type Platform } from "../../lib/platform-utils";

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
      url: `/docs/${platform}/sdk`,
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
      url: `/docs/${platform}/components`,
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
          className="w-full flex items-center justify-between px-4 py-3 bg-background border-2 border-border rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-1"
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
            className={`transform ${isOpen ? "rotate-180" : ""}`}
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
                    w-full px-4 py-3 text-left
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
                      className={`font-medium ${
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
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: platformColors[platform] }}
                      />
                    )}
                    {isHovered && !isSelected && (
                      <div
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: platformColors[platform], opacity: 0.6 }}
                      />
                    )}
                  </div>
                  <div className={`text-xs mt-1 ${
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

  // Helper function to convert rgb to rgba
  const rgbToRgba = (rgb: string, alpha: number) => {
    const match = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${alpha})`;
    }
    return rgb;
  };

  return (
    <div className="flex justify-center items-center p-4">
      <div
        className={`
          grid gap-6 max-w-4xl w-full justify-center
          ${platformSections.length === 1 ? 'grid-cols-1 max-w-xs' : ''}
          ${platformSections.length === 2 ? 'grid-cols-1 md:grid-cols-2 max-w-lg' : ''}
          ${platformSections.length === 3 ? 'grid-cols-1 md:grid-cols-3 max-w-2xl' : ''}
          ${platformSections.length === 4 ? 'grid-cols-2 md:grid-cols-4' : ''}
        `}
      >
        {platformSections.map((section) => (
          <div
            key={section.id}
            className="cursor-pointer group transform hover:scale-105"
            onMouseEnter={() => setHoveredSection(section.id)}
            onMouseLeave={() => setHoveredSection(null)}
            onClick={() => handleSectionClick(section)}
          >
            <div
              className={`
                bg-card border-[0.5px] border-border rounded-xl p-6 w-full h-40
                flex flex-col items-center justify-center
                shadow-sm hover:shadow-lg
              `}
              style={{
                borderColor: hoveredSection === section.id ? section.color : rgbToRgba(section.color, 0.4),
              }}
            >
              {/* Icon Container */}
              <div className="mb-4">
                <div
                  className={`
                    w-12 h-12 rounded-lg flex items-center justify-center
                  `}
                  style={{
                    backgroundColor: hoveredSection === section.id ? section.color : rgbToRgba(section.color, 0.2),
                    color: hoveredSection === section.id ? 'white' : section.color,
                    transform: hoveredSection === section.id ? 'scale(1.1)' : 'scale(1)',
                  }}
                >
                  {React.cloneElement(section.icon as React.ReactElement, {
                    size: 20,
                    strokeWidth: hoveredSection === section.id ? 2.5 : 2,
                  })}
                </div>
              </div>

              {/* Title */}
              <h3
                className="text-sm font-semibold mb-2 text-center"
                style={{
                  color: section.color,
                  transform: hoveredSection === section.id ? 'scale(1.05)' : 'scale(1)',
                }}
              >
                {section.title}
              </h3>

              {/* Description */}
              <p className="text-xs text-center text-muted-foreground leading-relaxed px-2 opacity-80">
                {section.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default function DocsSelector() {
  const { preferredPlatform, setPreferredPlatform, isLoaded } = usePlatformPreference();
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>(preferredPlatform);

  // Update selected platform when preference loads
  useEffect(() => {
    if (isLoaded) {
      setSelectedPlatform(preferredPlatform);
    }
  }, [preferredPlatform, isLoaded]);

  const handleSectionSelect = (section: DocsSection) => {
    //console.log("Selected section:", section);
    // Navigate to the selected section
    if (section.url) {
      window.location.href = section.url;
    }
  };

  const handlePlatformChange = (platform: Platform) => {
    setSelectedPlatform(platform);
    // Also update the preference in localStorage
    setPreferredPlatform(platform);
  };

  // Simple search button that opens the shared search dialog
  const handleSearchOpen = () => {
    // Trigger the main search dialog by dispatching the Cmd+K event
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true
    });
    document.dispatchEvent(event);
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      <PlatformSelector
        selectedPlatform={selectedPlatform}
        onPlatformChange={handlePlatformChange}
      />

      {/* Search Bar - uses shared search dialog */}
      <div className="mb-8 flex justify-center">
        <div className="w-full max-w-md">
          <button
            onClick={handleSearchOpen}
            className="group flex w-full items-center gap-4 rounded-xl border border-fd-border/60 bg-fd-background/80 px-4 py-4 text-left text-sm text-fd-muted-foreground backdrop-blur-sm hover:border-fd-border hover:bg-fd-background hover:text-fd-foreground hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-fd-primary/20"
          >
            <Search className="h-5 w-5 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-medium">Search documentation</div>
              <div className="text-xs text-fd-muted-foreground/70">Find guides, API references, and examples</div>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="inline-flex h-7 min-w-[28px] items-center justify-center rounded-md border border-fd-border/60 bg-fd-muted/50 px-2 font-mono text-xs font-medium text-fd-muted-foreground/80 group-hover:border-fd-border group-hover:bg-fd-muted group-hover:text-fd-muted-foreground">
                <Command className="h-4 w-4" />
              </kbd>
              <kbd className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-fd-border/60 bg-fd-muted/50 font-mono text-xs font-medium text-fd-muted-foreground/80 group-hover:border-fd-border group-hover:bg-fd-muted group-hover:text-fd-muted-foreground">
                K
              </kbd>
            </div>
          </button>
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
