"use client";

import { StackAssertionError } from '@stackframe/stack-shared/dist/utils/errors';
import { Json } from '@stackframe/stack-shared/dist/utils/json';
import { RefState } from '@stackframe/stack-shared/dist/utils/react';
import { generateUuid } from '@stackframe/stack-shared/dist/utils/uuids';
import React from 'react';

export type Widget<Settings, State> = {
  id: string,
  MainComponent: React.ComponentType<{ settings: Settings, state: State, stateRef: RefState<State>, setState: (updater: (state: State) => State) => void, widthInGridUnits: number, heightInGridUnits: number, isSingleColumnMode: boolean }>,
  SettingsComponent?: React.ComponentType<{ settings: Settings, setSettings: (updater: (settings: Settings) => Settings) => void }>,
  defaultSettings: Settings,
  defaultState: State,
  calculateMinSize?: (options: { settings: Settings, state: State }) => { widthInGridUnits: number, heightInGridUnits: number },
  minWidth?: number,
  minHeight?: number,
  hasSubGrid?: boolean,
  isHeightVariable?: boolean,
};

export type WidgetInstance<Settings = any, State = any> = {
  readonly id: string,
  readonly widget: Widget<Settings, State>,
  /**
   * `undefined` means that the settings have never been set and the default settings should be used; if the default
   * settings change later, so should the settings.
   */
  readonly settingsOrUndefined: Settings | undefined,
  /**
   * See settingsOrUndefined for more information on the meaning of `undefined`.
   */
  readonly stateOrUndefined: State | undefined,
};

export type GridElement = {
  readonly instance: WidgetInstance | null,
  readonly x: number,
  readonly y: number,
  readonly width: number,
  readonly height: number,
};

export function createWidgetInstance<Settings, State>(widget: Widget<Settings, State>): WidgetInstance<Settings, State> {
  return {
    id: generateUuid(),
    widget,
    settingsOrUndefined: undefined,
    stateOrUndefined: undefined,
  };
}

export function createErrorWidget(id: string, errorMessage: string): Widget<any, any> {
  return {
    id,
    MainComponent: () => (
      <div
        style={{ inset: '0', position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
      >
        <div style={{ fontSize: '16px', fontWeight: 'bold', color: 'red', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
          {errorMessage}
        </div>
      </div>
    ),
    defaultSettings: null as any,
    defaultState: null as any,
  };
}

export function serializeWidgetInstance(widgetInstance: WidgetInstance<any, any>): Json {
  return {
    id: widgetInstance.id,
    widgetId: widgetInstance.widget.id,
    ...(widgetInstance.settingsOrUndefined === undefined ? {} : { settingsOrUndefined: widgetInstance.settingsOrUndefined }),
    ...(widgetInstance.stateOrUndefined === undefined ? {} : { stateOrUndefined: widgetInstance.stateOrUndefined }),
  };
}

export function deserializeWidgetInstance(widgets: Widget<any, any>[], serialized: Json): WidgetInstance<any, any> {
  const serializedAny: any = serialized;
  if (typeof serializedAny !== "object" || serializedAny === null) {
    throw new StackAssertionError(`Serialized widget instance is not an object!`, { serialized });
  }
  if (typeof serializedAny.id !== "string") {
    throw new StackAssertionError(`Serialized widget instance id is not a string!`, { serialized });
  }
  return {
    id: serializedAny.id,
    widget: widgets.find((widget) => widget.id === serializedAny.widgetId) ?? createErrorWidget(serializedAny.id, `Widget ${serializedAny.widgetId} not found. Was it deleted?`),
    settingsOrUndefined: serializedAny.settingsOrUndefined,
    stateOrUndefined: serializedAny.stateOrUndefined,
  };
}

export function getSettings<Settings, State>(widgetInstance: WidgetInstance<Settings, State>): Settings {
  return widgetInstance.settingsOrUndefined === undefined ? widgetInstance.widget.defaultSettings : widgetInstance.settingsOrUndefined;
}

export function getState<Settings, State>(widgetInstance: WidgetInstance<Settings, State>): State {
  return widgetInstance.stateOrUndefined === undefined ? widgetInstance.widget.defaultState : widgetInstance.stateOrUndefined;
}

export const gridGapPixels = 8;
export const gridUnitHeight = 20;
export const mobileModeWidgetHeight = 384;
export const mobileModeCutoffWidth = 768;
