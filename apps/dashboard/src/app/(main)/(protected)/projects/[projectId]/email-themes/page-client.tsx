"use client";

import { SettingCard } from "@/components/settings";
import { Button, Card, Typography } from "@stackframe/stack-ui";
import { Check, Moon, Sun } from "lucide-react";
import { ReactNode, useState } from "react";
import { PageLayout } from "../page-layout";

type ThemeType = 'light' | 'dark';

interface Theme {
  id: ThemeType;
  name: string;
  description: string;
  icon: React.ReactNode;
  component: React.ComponentType<{ children: ReactNode }>;
}

function LightTheme({ children }: { children: ReactNode }) {
  return (
    <div
      className="p-4 rounded-lg space-y-4"
      style={{
        backgroundColor: '#ffffff',
        color: '#1e293b'
      }}
    >
      {children}
    </div>
  );
}

function DarkTheme({ children }: { children: ReactNode }) {
  return (
    <div
      className="p-4 rounded-lg space-y-4"
      style={{
        backgroundColor: '#0f172a',
        color: '#f1f5f9'
      }}
    >
      {children}
    </div>
  );
}

const themes: Theme[] = [
  {
    id: 'light',
    name: 'Light Theme',
    description: 'Clean and bright appearance',
    icon: <Sun className="h-5 w-5" />,
    component: LightTheme
  },
  {
    id: 'dark',
    name: 'Dark Theme',
    description: 'Modern dark appearance',
    icon: <Moon className="h-5 w-5" />,
    component: DarkTheme
  }
];

export default function PageClient() {
  const [selectedTheme, setSelectedTheme] = useState<ThemeType>('light');

  const handleThemeSelect = (themeId: ThemeType) => {
    setSelectedTheme(themeId);
    console.log('Selected theme:', themeId);
  };

  const selectedThemeData = themes.find(t => t.id === selectedTheme);

  return (
    <PageLayout title="Email Themes" description="Customize email themes for your project">
      <SettingCard title="Theme Selection" description="Choose a theme for your email templates">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {themes.map((theme) => (
            <ThemeOption
              key={theme.id}
              theme={theme}
              isSelected={selectedTheme === theme.id}
              onSelect={handleThemeSelect}
            />
          ))}
        </div>
      </SettingCard>

      {selectedThemeData && (
        <SettingCard
          title="Preview"
          description={`Preview of emails with ${selectedThemeData.name} applied`}
        >
          <div className="w-full max-w-xl mx-auto border border-primary-500 rounded-lg">
            <selectedThemeData.component>
              Your email content here...
            </selectedThemeData.component>
          </div>
        </SettingCard>
      )}
    </PageLayout>
  );
}

function ThemeOption({
  theme,
  isSelected,
  onSelect
}: {
  theme: Theme;
  isSelected: boolean;
  onSelect: (themeId: ThemeType) => void;
}) {
  return (
    <Card
      className={`p-4 cursor-pointer transition-all hover:shadow-md ${isSelected ? 'ring-2 ring-blue-500 shadow-lg' : ''}`}
      onClick={() => onSelect(theme.id)}
    >
      <div className="flex items-center gap-2">
        {theme.icon}
        <Typography className="font-medium">{theme.name}</Typography>
      </div>

      <Typography type="label" variant="secondary" className="mb-3">
        {theme.description}
      </Typography>


      <div className="mt-3">
        <Button
          variant={isSelected ? "default" : "outline"}
          size="sm"
          className="w-full"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(theme.id);
          }}
        >
          {isSelected ? 'Selected' : 'Select Theme'}
        </Button>
      </div>
    </Card>
  );
}
