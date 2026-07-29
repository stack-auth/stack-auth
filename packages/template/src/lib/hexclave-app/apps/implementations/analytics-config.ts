/**
 * Product Analytics options and their serialization helpers, split out of
 * session-replay.ts: the app constructor needs these eagerly (option
 * resolution, toClientJson), while the SessionRecorder itself is now loaded
 * lazily — keeping the options in session-replay.ts would pull the whole
 * recorder into every initial bundle. session-replay.ts re-exports everything
 * here for compatibility.
 */

export type AnalyticsReplayOptions = {
  /**
   * Whether session replays are enabled.
   *
   * @default true
   */
  enabled?: boolean,
  /**
   * Whether to mask the content of all `<input>` elements.
   *
   * @default true
   */
  maskAllInputs?: boolean,
  /**
   * A CSS class name or RegExp. Elements with a matching class will be blocked
   * (replaced with a placeholder in the recording).
   *
   * @default undefined
   */
  blockClass?: string | RegExp,
  /**
   * A CSS selector string. Elements matching this selector will be blocked
   * (replaced with a placeholder in the recording).
   *
   * @default undefined
   */
  blockSelector?: string,
};

export type AnalyticsOptions = {
  /**
   * Whether SDK-managed analytics capture is enabled.
   *
   * @default true
   */
  enabled?: boolean,
  /**
   * Options for session replay recording. Replays are enabled by default;
   * set `enabled: false` to opt out.
   */
  replays?: AnalyticsReplayOptions,
  /**
   * Opt-in presence/integrity signals: an `$away` span per continuous interval
   * the user spent off the tab/window (its `data.reasons` records which
   * sensors fired: `tab-hidden`, `window-blur`, or both),
   * `$copy`/`$cut`/`$paste` (lengths and a
   * same-page-origin flag only — clipboard CONTENT is never captured),
   * `$context-menu`, `$print`, and `$fullscreen-exit` events. Built for
   * review-signal use cases like exam/quiz platforms; all signals are advisory
   * (page script cannot prove presence), and because they are
   * surveillance-adjacent they default to OFF.
   *
   * @default false
   */
  integritySignals?: boolean,
};

type SerializedRegExp = {
  __regexp: string,
  __flags: string,
};

type AnalyticsReplayOptionsJson = Omit<AnalyticsReplayOptions, "blockClass"> & {
  blockClass?: string | SerializedRegExp,
};

export type AnalyticsOptionsJson = Omit<AnalyticsOptions, "replays"> & {
  replays?: AnalyticsReplayOptionsJson,
};

export function getSessionReplayOptions(analyticsOptions: AnalyticsOptions | undefined): AnalyticsReplayOptions {
  return {
    ...analyticsOptions?.replays,
    enabled: analyticsOptions?.replays?.enabled ?? true,
  };
}

/**
 * Converts AnalyticsOptions to a JSON-safe representation.
 * RegExp blockClass values are serialized as `{ __regexp, __flags }` objects.
 * The serialized type models the RegExp envelope explicitly so the SSR handoff
 * never needs to bypass the type system.
 */
export function analyticsOptionsToJson(options: AnalyticsOptions | undefined): AnalyticsOptionsJson | undefined {
  if (options == null) return undefined;
  const { replays, ...outerOptions } = options;
  if (replays == null) return outerOptions;
  const { blockClass, ...replayOptions } = replays;
  return {
    ...outerOptions,
    replays: {
      ...replayOptions,
      ...(blockClass == null
        ? {}
        : {
          blockClass: blockClass instanceof RegExp
            ? { __regexp: blockClass.source, __flags: blockClass.flags }
            : blockClass,
        }),
    },
  };
}

function isSerializedRegExp(value: string | SerializedRegExp): value is SerializedRegExp {
  return typeof value === "object";
}

/**
 * Reconstructs AnalyticsOptions from a JSON-deserialized value.
 * Converts `{ __regexp, __flags }` objects back to RegExp instances.
 */
export function analyticsOptionsFromJson(json: AnalyticsOptionsJson | undefined): AnalyticsOptions | undefined {
  if (json == null) return undefined;
  const { replays, ...outerOptions } = json;
  if (replays == null) return outerOptions;
  const { blockClass, ...replayOptions } = replays;
  return {
    ...outerOptions,
    replays: {
      ...replayOptions,
      ...(blockClass == null
        ? {}
        : {
          blockClass: isSerializedRegExp(blockClass)
            ? new RegExp(blockClass.__regexp, blockClass.__flags)
            : blockClass,
        }),
    },
  };
}
