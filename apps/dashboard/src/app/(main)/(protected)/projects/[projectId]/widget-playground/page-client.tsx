"use client";

import { PacificaCard } from '@/components/pacifica/card';
import { Button, Input } from '@/components/ui';
import {
  SwappableWidgetInstanceGrid,
  SwappableWidgetInstanceGridContext,
  type Widget,
  type WidgetInstance,
  WidgetInstanceGrid,
  createWidgetInstance,
} from '@stackframe/dashboard-ui-components';
import { errorToNiceString } from '@stackframe/stack-shared/dist/utils/errors';
import { bundleJavaScript } from '@stackframe/stack-shared/dist/utils/esbuild';
import { runAsynchronously, wait } from '@stackframe/stack-shared/dist/utils/promises';
import { type RefState, mapRefState, useRefState } from '@stackframe/stack-shared/dist/utils/react';
import { AsyncResult, Result } from '@stackframe/stack-shared/dist/utils/results';
import { deindent } from '@stackframe/stack-shared/dist/utils/strings';
import { generateUuid } from '@stackframe/stack-shared/dist/utils/uuids';
import React, { useEffect, useState } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { PageLayout } from "../page-layout";

type SerializedWidget = {
  version: 1,
  sourceJs: string,
  compilationResult: Result<string, string>,
  id: string,
};

const widgetGlobals = {
  React,
  jsxRuntime,
  Card: PacificaCard,

  Button,
  Input,
};

async function compileWidgetSource(source: string): Promise<Result<string, string>> {
  return await bundleJavaScript({
    "/source.tsx": source,
    "/entry.js": `
      import * as widget from "./source.tsx";
      __STACK_WIDGET_RESOLVE(widget);
    `,
  }, {
    format: 'iife',
    externalPackages: {
      'react': 'module.exports = React;',
      'react/jsx-runtime': 'module.exports = jsxRuntime;',
    },
  });
}

async function compileWidget(source: string): Promise<SerializedWidget> {
  const compilationResult = await compileWidgetSource(source);
  return {
    id: generateUuid(),
    version: 1,
    sourceJs: source,
    compilationResult: compilationResult,
  };
}

let compileAndDeserializeTask: Promise<unknown> | null = null;
function useCompileAndDeserializeWidget(source: string) {
  const [compilationResult, setCompilationResult] = useState<AsyncResult<Widget<any, any>, never> & { status: "ok" | "pending" }>(AsyncResult.pending());
  useEffect(() => {
    let isCancelled = false;
    runAsynchronously(async () => {
      setCompilationResult(AsyncResult.pending());
      while (compileAndDeserializeTask) {
        if (isCancelled) return;
        await compileAndDeserializeTask;
      }
      compileAndDeserializeTask = (async () => {
        const serializedWidget = await compileWidget(source);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (isCancelled) return;
        if (serializedWidget.compilationResult.status === "error") {
          // if there's a compile error, we want to debounce a little so we don't flash errors while the user is typing
          await wait(500);
        }
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (isCancelled) return;
        const widget = await deserializeWidget(serializedWidget);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (isCancelled) return;
        setCompilationResult(AsyncResult.ok(widget));
      })();
      await compileAndDeserializeTask;
      compileAndDeserializeTask = null;
    });
    return () => {
      isCancelled = true;
    };
  }, [source]);
  return compilationResult;
}

function createErrorWidget(id: string, errorMessage: string): Widget<any, any> {
  return {
    id,
    MainComponent: () => (
      <PacificaCard
        style={{ inset: '0', position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
      >
        <div style={{ fontSize: '16px', fontWeight: 'bold', color: 'red', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
          {errorMessage}
        </div>
      </PacificaCard>
    ),
    defaultSettings: null as any,
    defaultState: null as any,
  };
}

async function deserializeWidget(serializedWidget: SerializedWidget): Promise<Widget<any, any>> {
  const errorWidget = (errorMessage: string): Widget<any, any> => createErrorWidget(serializedWidget.id, errorMessage);

  if (serializedWidget.compilationResult.status === "ok") {
    const globalsEntries = Object.entries(widgetGlobals);
    const globalsKeys = globalsEntries.map(([key]) => key);
    const globalsValues = globalsEntries.map(([_, value]) => value);
    const compiledJs = serializedWidget.compilationResult.data;
    let widget: Widget<any, any>;
    try {
      widget = await new Promise(resolve => new Function(...globalsKeys, "__STACK_WIDGET_RESOLVE", compiledJs)(...globalsValues, resolve));
    } catch (e) {
      return errorWidget(`Widget failed to run: ${errorToNiceString(e)}`);
    }

    const allowedKeys = Object.entries(widgetExports).filter(([_, v]) => v !== "never").map(([k]) => k);
    const requiredKeys = Object.entries(widgetExports).filter(([_, v]) => v === "required").map(([k]) => k);
    const exports = Object.keys(widget) as (keyof Widget<any, any>)[];
    const notAllowedExports = exports.filter(key => !allowedKeys.includes(key as keyof Widget<any, any>));
    if (notAllowedExports.length > 0) {
      return errorWidget(`Widget has invalid exports: ${notAllowedExports.join(", ")}. Only these exports are allowed: ${Object.entries(widgetExports).filter(([_, v]) => v === "required").map(([k]) => k).join(", ")}`);
    }
    const missingExports = requiredKeys.filter(key => !exports.includes(key as keyof Widget<any, any>));
    if (missingExports.length > 0) {
      return errorWidget(`Widget is missing required exports: ${missingExports.join(", ")}`);
    }

    widget.id = serializedWidget.id;
    return widget;
  } else {
    const errorMessage = serializedWidget.compilationResult.error;
    return errorWidget(`Widget failed to compile: ${errorMessage}`);
  }
}

const widgetExports: Record<keyof Widget<any, any>, "required" | "optional" | "never" > = {
  "id": "never",
  "MainComponent": "required",
  "SettingsComponent": "optional",
  "defaultSettings": "required",
  "defaultState": "required",
  "calculateMinSize": "optional",
  "minWidth": "optional",
  "minHeight": "optional",
  "hasSubGrid": "optional",
  "isHeightVariable": "optional",
};

const widgets: Widget<any, any>[] = [
  {
    id: "$sub-grid",
    MainComponent: ({ widthInGridUnits, heightInGridUnits, stateRef, isSingleColumnMode }) => {
      const widgetGridRef = mapRefState(
        stateRef,
        (state) => WidgetInstanceGrid.fromSerialized(widgets, state.serializedGrid),
        (state, grid) => ({
          ...state,
          serializedGrid: grid.serialize(),
        }),
      );
      const [color] = useState("#" + Math.floor(Math.random() * 16777215).toString(16) + "22");

      useEffect(() => {
        const newWidgetGrid = widgetGridRef.current.resize(widthInGridUnits - 1, heightInGridUnits - 1);
        if (newWidgetGrid !== widgetGridRef.current) {
          widgetGridRef.set(newWidgetGrid);
        }
      }, [widthInGridUnits, heightInGridUnits, widgetGridRef]);

      return (
        <div style={{ backgroundColor: color, padding: '16px' }}>
          <SwappableWidgetInstanceGrid
            isSingleColumnMode={isSingleColumnMode ? "auto" : false}
            gridRef={widgetGridRef}
            allowVariableHeight={false}
            isStatic={false}
            availableWidgets={widgets}
            unitHeight={48}
            gapPixels={32}
          />
        </div>
      );
    },
    defaultSettings: {},
    defaultState: {
      serializedGrid: WidgetInstanceGrid.fromWidgetInstances(
        [],
        {
          width: 1,
          height: 1,
        },
      ).serialize(),
    },
    hasSubGrid: true,
    calculateMinSize(options) {
      const grid = WidgetInstanceGrid.fromSerialized(widgets, options.state.serializedGrid);
      const minSize = grid.getMinResizableSize();
      return {
        widthInGridUnits: Math.max(minSize.width, WidgetInstanceGrid.MIN_ELEMENT_WIDTH) + 1,
        heightInGridUnits: Math.max(minSize.height, WidgetInstanceGrid.MIN_ELEMENT_HEIGHT) + 1,
      };
    },
  },
  {
    id: "$compile-widget",
    MainComponent: () => {
      const [source, setSource] = useState(deindent`
        export function MainComponent(props) {
          return <Card>Hello, {props.settings.name}!</Card>;
        }

        // export function SettingsComponent(props) {
        //   return <div>Name: <Input value={props.settings.name} onChange={(e) => props.setSettings((settings) => ({ ...settings, name: e.target.value }))} /></div>;
        // }

        export const defaultSettings = {name: "world"};
      `);
      const [compilationResult, setCompilationResult] = useState<Result<string, string> | null>(null);

      return (
        <PacificaCard
          title="Widget compiler"
          subtitle="This is a subtitle"
        >
          <textarea value={source} onChange={(e) => setSource(e.target.value)} style={{ width: '100%', height: '35%', fontFamily: "monospace" }} />
          <Button onClick={async () => {
            const result = await compileWidgetSource(source);
            setCompilationResult(result);
          }}>Compile</Button>
          {compilationResult?.status === "ok" && (
            <>
              <textarea style={{ fontFamily: "monospace", width: '100%', height: '35%' }} value={compilationResult.data} readOnly />
              <Button onClick={async () => {
                widgets.push(await deserializeWidget({
                  id: generateUuid(),
                  version: 1,
                  sourceJs: compilationResult.data,
                  compilationResult: Result.ok(compilationResult.data),
                }));
                alert("Widget saved");
              }}>Save as widget</Button>
            </>
          )}
          {compilationResult?.status === "error" && (
            <div style={{ color: "red" }}>
              {compilationResult.error}
            </div>
          )}
        </PacificaCard>
      );
    },
    defaultSettings: {},
    defaultState: {},
  },
  {
    id: "$variable-height-widget",
    MainComponent: () => {
      return (
        <PacificaCard
          title="Variable height widget"
          subtitle="This widget has a variable height. It does not follow the regular grid pattern, and always takes up the grid's full width."
        >
          <textarea value="resize me" readOnly />
        </PacificaCard>
      );
    },
    defaultSettings: {},
    defaultState: {},
    isHeightVariable: true,
  },
  {
    id: "$widget-builder",
    MainComponent: () => {
      const [source, setSource] = useState(deindent`
        export function MainComponent(props) {
          return <Card>
            Hello, {props.settings.name}!
            You are <input value={props.state.value} onChange={(e) => props.setState((state) => ({ ...state, value: e.target.value }))} /> years old.
          </Card>;
        }

        export function SettingsComponent(props) {
          return <div>Name: <Input value={props.settings.name} onChange={(e) => props.setSettings((settings) => ({ ...settings, name: e.target.value }))} /></div>;
        }

        export const defaultSettings = {name: "world"};
        export const defaultState = {value: 1};
      `);
      const widgetResult = useCompileAndDeserializeWidget(source);
      const widget = widgetResult.status === "ok" ? widgetResult.data : null;
      const [lastWidget, setLastWidget] = useState(widget);
      const widgetInstanceRef = useRefState<WidgetInstance<any, any> | null>(null);
      useEffect(() => {
        if (lastWidget !== widget) {
          if (widget) {
            widgetInstanceRef.set(createWidgetInstance(widget));
          }
          setLastWidget(widget);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [widget]);

      return (
        <PacificaCard
          title="Widget builder"
        >
          <textarea value={source} onChange={(e) => setSource(e.target.value)} style={{ width: '100%', height: '35%', fontFamily: "monospace" }} />
          {widgetInstanceRef.current && (
            <SingleWidget widgetInstanceRef={widgetInstanceRef as any} />
          )}
        </PacificaCard>
      );
    },
    defaultSettings: {},
    defaultState: {},
    hasSubGrid: true,
  },
];

export default function PageClient() {
  const widgetGridRef = useRefState(WidgetInstanceGrid.fromWidgetInstances(widgets.map((w) => createWidgetInstance(w))));
  const [isAltDown, setIsAltDown] = useState(false);

  useEffect(() => {
    const downListener = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        setIsAltDown(true);
      }
    };
    const upListener = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        setIsAltDown(false);
      }
    };
    window.addEventListener('keydown', downListener);
    window.addEventListener('keyup', upListener);
    return () => {
      window.removeEventListener('keydown', downListener);
      window.removeEventListener('keyup', upListener);
    };
  }, []);

  return (
    <PageLayout
      title="Widget Playground"
      fillWidth
    >
      <SwappableWidgetInstanceGridContext.Provider value={{ isEditing: isAltDown }}>
        <SwappableWidgetInstanceGrid gridRef={widgetGridRef} isSingleColumnMode="auto" allowVariableHeight={true} isStatic={false} availableWidgets={widgets} unitHeight={48} gapPixels={32} />
      </SwappableWidgetInstanceGridContext.Provider>
    </PageLayout>
  );
}

function SingleWidget(props: {
  widgetInstanceRef: RefState<WidgetInstance<any, any>>,
}) {
  const widgetGridRef = mapRefState(
    props.widgetInstanceRef,
    (widgetInstance) => {
      return WidgetInstanceGrid.fromSingleWidgetInstance(widgetInstance);
    },
    (widgetInstance, grid) => grid.getInstanceById(widgetInstance.id) ?? /* widget deleted, let's reset to last known state */ widgetInstance,
  );

  return (
    <SwappableWidgetInstanceGrid
      gridRef={widgetGridRef}
      isSingleColumnMode={true}
      allowVariableHeight={true}
      isStatic={true}
    />
  );
}
