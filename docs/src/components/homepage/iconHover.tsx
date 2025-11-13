"use client";

import { Book, Code, Command, Layers, Search, Zap } from "lucide-react";
import React, { useState } from "react";

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
}
const DEFAULT_SECTIONS: DocsSection[] = [
  {
    id: "guides",
    title: "Guides",
    description: "Complete guides and tutorials",
    icon: <Book size={24} />,
    url: "/docs/overview",
    color: "rgb(59, 130, 246)",
  },
  {
    id: "sdk",
    title: "SDK",
    description: "Software development kits",
    icon: <Code size={24} />,
    url: "/docs/sdk",
    color: "rgb(16, 185, 129)",
  },
  {
    id: "components",
    title: "Components",
    description: "Reusable UI components",
    icon: <Layers size={24} />,
    url: "/docs/components",
    color: "rgb(245, 101, 101)",
  },
  {
    id: "api",
    title: "API Reference",
    description: "Complete API documentation",
    icon: <Zap size={24} />,
    url: "/api/overview",
    color: "rgb(168, 85, 247)",
  },
];

const DocsIcon3D: React.FC<DocsIcon3DProps> = ({
  sections = DEFAULT_SECTIONS,
  onSectionSelect,
}) => {
  const [hoveredSection, setHoveredSection] = useState<string | null>(null);

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
          ${sections.length === 1 ? 'grid-cols-1 max-w-xs' : ''}
          ${sections.length === 2 ? 'grid-cols-1 md:grid-cols-2 max-w-lg' : ''}
          ${sections.length === 3 ? 'grid-cols-1 md:grid-cols-3 max-w-2xl' : ''}
          ${sections.length >= 4 ? 'grid-cols-2 md:grid-cols-4' : ''}
        `}
      >
        {sections.map((section) => (
          <div
            key={section.id}
            className="cursor-pointer group transition-transform hover:scale-105"
            onMouseEnter={() => setHoveredSection(section.id)}
            onMouseLeave={() => setHoveredSection(null)}
            onClick={() => handleSectionClick(section)}
          >
            <div
              className="bg-card border border-border rounded-xl p-4 w-full h-40 flex flex-col items-center justify-center shadow-sm hover:shadow-lg transition-all overflow-hidden"
              style={{
                borderColor: hoveredSection === section.id ? section.color : rgbToRgba(section.color, 0.4),
              }}
            >
              {/* Icon Container */}
              <div className="mb-3 flex-shrink-0">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center transition-all"
                  style={{
                    backgroundColor: hoveredSection === section.id ? section.color : rgbToRgba(section.color, 0.2),
                    color: hoveredSection === section.id ? 'white' : section.color,
                    transform: hoveredSection === section.id ? 'scale(1.1)' : 'scale(1)',
                  }}
                >
                  {React.cloneElement(section.icon as React.ReactElement, {
                    size: 18,
                    strokeWidth: hoveredSection === section.id ? 2.5 : 2,
                  })}
                </div>
              </div>

              {/* Title */}
              <h3
                className="text-sm font-semibold mb-1.5 text-center transition-transform line-clamp-1"
                style={{
                  color: section.color,
                  transform: hoveredSection === section.id ? 'scale(1.05)' : 'scale(1)',
                }}
              >
                {section.title}
              </h3>

              {/* Description */}
              <p className="text-xs text-center text-muted-foreground leading-snug px-1 opacity-80 line-clamp-2">
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
  const handleSectionSelect = (section: DocsSection) => {
    //console.log("Selected section:", section);
    // Navigate to the selected section
    if (section.url) {
      window.location.href = section.url;
    }
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
        sections={DEFAULT_SECTIONS}
        onSectionSelect={handleSectionSelect}
      />
    </div>
  );
}

// Export the core component for direct use
export { DocsIcon3D };
