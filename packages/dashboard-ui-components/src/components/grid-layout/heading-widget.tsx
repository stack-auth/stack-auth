"use client";

import React from 'react';
import { generateUuid } from '@stackframe/stack-shared/dist/utils/uuids';
import type { Widget, WidgetInstance } from './types';

type HeadingSettings = { text: string, level?: 'h2' | 'h3' };

export const sectionHeadingWidget: Widget<HeadingSettings, Record<string, never>> = {
  id: 'section-heading',
  MainComponent: ({ settings }) => {
    const Tag = (settings.level ?? 'h2') as 'h2' | 'h3';
    return (
      <>
        <style>{`
          .section-heading-card {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            padding: 8px 12px 12px;
            background: rgba(255, 255, 255, 0.9);
            border-radius: 12px;
            box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.04), 0 0 0 1px rgb(0 0 0 / 0.06);
          }
          .dark .section-heading-card {
            background: transparent;
            box-shadow: none;
          }
        `}</style>
        <div className="section-heading-card">
          <Tag style={{
            margin: 0,
            fontSize: '11px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'hsl(var(--muted-foreground, 240 3.8% 46.1%))',
            width: '100%',
          }}>
            {settings.text}
          </Tag>
        </div>
      </>
    );
  },
  SettingsComponent: ({ settings, setSettings }) => {
    return (
      <div style={{ padding: '4px 0' }}>
        <input
          type="text"
          value={settings.text}
          onChange={(e) => {
            const newText = e.target.value;
            setSettings((s) => ({ ...s, text: newText }));
          }}
          style={{
            width: '100%',
            padding: '8px 12px',
            fontSize: '14px',
            border: '1px solid hsl(var(--border, 214.3 31.8% 91.4%))',
            borderRadius: '6px',
            background: 'transparent',
            color: 'inherit',
            outline: 'none',
          }}
          autoFocus
          placeholder="Section title..."
        />
      </div>
    );
  },
  defaultSettings: { text: 'Section', level: 'h2' },
  defaultState: {},
  minHeight: 2,
};

export function createSectionHeadingInstance(
  text: string,
  level?: 'h2' | 'h3',
): WidgetInstance<HeadingSettings, Record<string, never>> {
  return {
    id: generateUuid(),
    widget: sectionHeadingWidget,
    settingsOrUndefined: { text, level: level ?? 'h2' },
    stateOrUndefined: {},
  };
}
