export function getSerializationHelpers() {
  const func = () => {
    const generateRandomId = () => crypto.randomUUID();

    const references = new Map<any, string>();
    const valuesByReference = new Map<string, any>();
    const getReference = (value: any): string => {
      if (references.has(value)) {
        return references.get(value)!;
      }
      const id = generateRandomId();
      references.set(value, id);
      valuesByReference.set(id, value);
      return id;
    };
    const getOrCreateValuesByReference = (ref: string, createFunc: () => any) => {
      if (valuesByReference.has(ref)) {
        return valuesByReference.get(ref);
      }
      const obj = createFunc();
      valuesByReference.set(ref, obj);
      references.set(obj, ref);
      return obj;
    };

    const hostObjectPaths = new Map();

    const functionDataByReference = new Map<
      string,
      | {
        functionType: "syntactic",
        scope: () => Record<string, any>,
        source: string,
      }
      | {
        functionType: "class",
        class: Function,
        expression: string,
      }
    >();

    // Class prototypes are created by the class definition, so we take extra care to not overwrite them
    const classPrototypes = new Map<any, {
      class: Function,
    }>();

    const scopeMap = new Map<string, Map<string, any>>();

    const throwErr = (message: string): never => {
      throw new Error(message);
    };

    const getKeyExpressionOrNull = (key: string | symbol) => {
      if (typeof key === "string") {
        return JSON.stringify(key);
      }
      return Symbol.keyFor(key) ?? null;
    };

    const isShallowEqual = (a: any, b: any) => {
      if (a === b) return true;
      if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return false;
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);
      if (keysA.length !== keysB.length) return false;
      for (const key of keysA) {
        if (a[key] !== b[key]) return false;
      }
      return true;
    };

    const definePropertyIfNotAlreadyDefined = (obj: any, key: string | symbol, descriptor: PropertyDescriptor) => {
      if (isShallowEqual(Object.getOwnPropertyDescriptor(obj, key), descriptor)) {
        return;
      }
      Object.defineProperty(obj, key, descriptor);
    };

    type HeapEntry = {
      objectType: string,
      prototype: any,
      isExtensible: boolean,
      ownProperties: [any, any][],
      data: any,
    };

    type ObjectHeapEntrySerializer<T, D> = {
      objectType: string,
      check: (obj: any) => boolean,
      serialize: (recurse: (path: null | ((old: string) => string), value: any) => any, obj: T) => D,
      initializationExpression: (recurse: (data: any) => string, data: D) => string,
      postProcessingFunction?: (recurse: (data: any) => string, data: D) => string,
      propertyFilter?: (value: any, key: string | symbol) => boolean,
    };
    const objectHeapEntrySerializers: ObjectHeapEntrySerializer<any, any>[] = [
      {
        objectType: "class-prototype",
        check: (obj) => classPrototypes.has(obj),
        serialize: (recurse, obj) => ({
          class: recurse(null, classPrototypes.get(obj)!.class),
        }),
        initializationExpression: (recurse, data) => `${recurse(data.class)}.prototype`,
      },
      {
        objectType: "function",
        check: (obj) => typeof obj === "function",
        serialize: (recurse, obj) => {
          const ref = getReference(obj);
          const functionData = functionDataByReference.get(ref);
          if (functionData === undefined) {
            if (hostObjectPaths.has(obj)) {
              // HACK make registerHostObject work
              return {} as any;
            }
            throw new Error(`Function data not found for function: ${obj}. Cannot serialize functions that were not registered; it's possible that you tried to serialize an object that is not known to the serializer.`);
          }
          return {
            ...functionData.functionType === "syntactic" ? {
              functionType: "syntactic",
              scope: Object.entries(functionData.scope()).map(([key, value]) => [recurse(null, key), recurse(null, value)]),
              source: recurse(null, functionData.source),
              scopeMapId: generateRandomId(),
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            } : functionData.functionType === "class" ? {
              functionType: "class",
              class: recurse(null, functionData.class),
              expression: functionData.expression,
            } : throwErr(`Unknown function type: ${(functionData as any).functionType}`),
          };
        },
        initializationExpression: (recurse, data) => {
          switch (data.functionType) {
            case "syntactic": {
              return `
                (() => {
                  const __$getFromScope = (key) => {
                    const scm = scopeMap.get(${JSON.stringify(data.scopeMapId)});
                    if (scm) return scm.get(key);
                    else {
                      // function/class declaration called before postProcessing; let's greedily read the variable
                      // this may cause a circular dependency, but that's also true in regular JS
                      return new Map([
                        ${data.scope.map(([key, value]) => `[${recurse(key)}, () => (${recurse(value)})]`).join(",\n")}
                      ]).get(key)();
                    }
                  };
                  return new Function("__$getFromScope", "return (" + ${recurse(data.source)} + ");")(__$getFromScope);
                })()
              `;
            }
            case "class": {
              return `
                (() => {
                  const C = ${recurse(data.class)};
                  return new Function("C", ${JSON.stringify(`return (${data.expression});`)})(C);
                })()
              `;
            }
            default: {
              throw new Error(`Unknown function type: ${(data as any).functionType}. This serialized object may be invalid.`);
            }
          }
        },
        postProcessingFunction: (recurse, data) => {
          switch (data.functionType) {
            case "syntactic": {
              return `
                (() => {
                  scopeMap.set(${JSON.stringify(data.scopeMapId)}, new Map([
                    ${data.scope.map(([key, value]) => `[${recurse(key)}, ${recurse(value)}]`).join(",\n")}
                  ]));
                })
              `;
            }
            case "class": {
              return "() => {}";
            }
            default: {
              throw new Error(`Unknown function type: ${(data as any).functionType}. This serialized object may be invalid.`);
            }
          }
        },
        // arguments, caller, and callee will be set automatically, so we don't want to serialize & set them again. they also have awfully awkward behavior so serializing makes no sense
        propertyFilter: (obj, key) => !["arguments", "caller", "callee"].includes(key as string),
      } satisfies ObjectHeapEntrySerializer<
        Function,
        | { functionType: "syntactic", scope: [string, any][], source: string, scopeMapId: string }
        | { functionType: "class", class: any, expression: string }
      >,
      {
        objectType: "array",
        check: (obj) => Array.isArray(obj),
        // Since we assign fields later, we don't actually need to serialize anything about the array, just the fact that it is one
        serialize: (recurse, obj) => ({}),
        initializationExpression: (recurse, data) => "[]",
      } satisfies ObjectHeapEntrySerializer<any[], {}>,
      {
        objectType: "map",
        check: (obj) => obj instanceof Map,
        serialize: (recurse, obj) => {
          return {
            entries: [...obj.entries()].map(([key, value], i) => {
              return [
                recurse(null, key),
                recurse(null, value),
              ];
            }),
          };
        },
        initializationExpression: (recurse, data) => `new Map()`,
        postProcessingFunction: (recurse, data) => `
          (map) => {
            ${data.entries.map(([key, value], i) => `map.set(${recurse(key)}, ${recurse(value)});`).join("\n")}
          }
        `,
      } satisfies ObjectHeapEntrySerializer<Map<any, any>, { entries: [string, any][] }>,
      {
        objectType: "set",
        check: (obj) => obj instanceof Set,
        serialize: (recurse, obj) => ({
          elements: [...obj.values()].map((element, i) => recurse(p => `[...${p}.values()][${i}]`, element)),
        }),
        initializationExpression: (recurse, data) => `new Set()`,
        postProcessingFunction: (recurse, data) => `
          (set) => {
            ${data.elements.map((element, i) => `set.add(${recurse(element)});`).join("\n")}
          }
        `,
      } satisfies ObjectHeapEntrySerializer<Set<any>, { elements: any[] }>,
      {
        objectType: "primitive-wrapper",
        check: (obj) => obj instanceof Number || obj instanceof String || obj instanceof Boolean || obj instanceof BigInt || obj instanceof Symbol,
        serialize: (recurse, obj) => ({
          value: recurse(p => `${p}.valueOf()`, obj),
        }),
        initializationExpression: (recurse, data) => `Object(${recurse(data.value)})`,
      } satisfies ObjectHeapEntrySerializer<Number | String | Boolean | BigInt | Symbol, { value: any }>,
      {
        objectType: "regexp",
        check: (obj) => obj instanceof RegExp,
        serialize: (recurse, obj) => ({
          source: obj.source,
          flags: obj.flags,
        }),
        initializationExpression: (recurse, data) => `new RegExp(${JSON.stringify(data.source)}, ${JSON.stringify(data.flags)})`,
      } satisfies ObjectHeapEntrySerializer<RegExp, { source: string, flags: string }>,
      {
        objectType: "error",
        check: (obj) => obj instanceof Error,
        serialize: (recurse, obj) => ({
          message: obj.message,
          name: obj.name,
          stack: obj.stack,
        }),
        initializationExpression: (recurse, data) => `
          (() => {
            const res = new Error(${JSON.stringify(data.message)});
            res.name = ${JSON.stringify(data.name)};
            res.stack = ${JSON.stringify(data.stack)};
            return res;
          })()
        `,
      } satisfies ObjectHeapEntrySerializer<Error, { message: string, name: string, stack: string | undefined }>,
      {
        objectType: "promise",
        check: (obj) => obj instanceof Promise,
        serialize: (recurse, obj) => ({
          // TODO: actually implement this instead of just rejecting every promise
        }),
        initializationExpression: (recurse, data) => `
          (() => {
            return Promise.reject(new Error("Putting a VM to sleep rejects all current promises. Please resolve all promises before putting the VM to sleep."));
          })()
        `,
      } satisfies ObjectHeapEntrySerializer<Promise<any>, {}>,
      {
        objectType: "date",
        check: (obj) => obj instanceof Date,
        serialize: (recurse, obj) => ({
          ms: obj.getTime(),
        }),
        initializationExpression: (recurse, data) => `new Date(${data.ms})`,
      } satisfies ObjectHeapEntrySerializer<Date, { ms: number }>,
      {
        // note: ArrayBuffer has a bunch of 2024/2025 features that are not part of the 2021 tsconfig lib we use, so we need a bunch of `any`s
        objectType: "array-buffer",
        check: (obj) => obj instanceof ArrayBuffer,
        serialize: (recurse, obj) => ({
          detached: (obj as any).detached ?? false,
          resizable: (obj as any).resizable ?? false,
          byteLength: (obj as any).byteLength ?? null,
          maxByteLength: (obj as any).maxByteLength ?? null,
          content: recurse(null, [...new Uint8Array(obj)]),
        }),
        initializationExpression: (recurse, data) => `new ArrayBuffer(${data.byteLength}, ${data.resizable ? `{ maxByteLength: ${JSON.stringify(data.maxByteLength)} }` : "{}"})`,
        postProcessingFunction: (recurse, data) => `
          ((arrayBuffer) => {
            const content = ${recurse(data.content)};
            const view = new Uint8Array(arrayBuffer);
            for (let i = 0; i < content.length; i++) {
              view[i] = content[i];
            }
            if (${data.detached}) {
              arrayBuffer.transfer();
            }
          })
        `,
      } satisfies ObjectHeapEntrySerializer<ArrayBuffer, { content: number[], detached: boolean, resizable: boolean, byteLength: number | null, maxByteLength: number | null }>,
      // TODO: missing: Proxy, module namespace objects, iterator objects, WeakMap/WeakSet/WeakRef/FinalizationRegistry, private class methods
      // TODO: `arguments` is technically supported, but it doesn't auto-sync, and some other things may not work with it
      // TODO: private fields are kinda bugged right now, particularly when accessing them from a class getter I believe. we need better testing here
      // TODO: I also think that right now we don't update class methods correctly, if you create a class with some methods, then later set the methods to another function, but serialize the original method somewhere, then instead we will serialize the new method
    ];

    function createHeapEntryForObjectLike(recurse: (path: null | ((old: string) => string), value: any) => any, obj: any): HeapEntry {
      if (!["object", "function"].includes(typeof obj)) {
        throw new Error(`Expected object or function in createHeapEntryForObjectLike, got ${typeof obj}`);
      }
      if (obj === null) {
        throw new Error("Expected object or function in createHeapEntryForObjectLike, got null");
      }
      const matchingObjectTypes = objectHeapEntrySerializers.filter((serializer) => serializer.check(obj));
      let ownPropertyDescriptors = Object.entries(Object.getOwnPropertyDescriptors(obj))
        .filter(([key]) => matchingObjectTypes[0]?.propertyFilter?.(obj, key) ?? true);
      return {
        objectType: matchingObjectTypes[0]?.objectType ?? "not-special",
        isExtensible: Object.isExtensible(obj),
        ownProperties: ownPropertyDescriptors.map(([key, descriptor]) => {
          const keySerialized = recurse(null, key);
          const keyExpression = typeof key === "string" ? JSON.stringify(key) : (Symbol.keyFor(key) ?? null);
          return [keySerialized, {
            ...("writable" in descriptor ? { writable: descriptor.writable } : {}),
            ...("enumerable" in descriptor ? { enumerable: descriptor.enumerable } : {}),
            ...("configurable" in descriptor ? { configurable: descriptor.configurable } : {}),
            ...("value" in descriptor ? { value: recurse(keyExpression === null ? null : (p => `${p}[${keyExpression}]`), descriptor.value) } : {}),
            ...("get" in descriptor ? { get: recurse(keyExpression === null ? null : (p => `Object.getOwnPropertyDescriptor(${p}, ${keyExpression}).get`), descriptor.get) } : {}),
            ...("set" in descriptor ? { set: recurse(keyExpression === null ? null : (p => `Object.getOwnPropertyDescriptor(${p}, ${keyExpression}).set`), descriptor.set) } : {}),
          } as const];
        }),
        prototype: recurse(p => `Object.getPrototypeOf(${p})`, Object.getPrototypeOf(obj)),
        data: matchingObjectTypes[0]?.serialize(recurse, obj) ?? null,
      };
    }

    function createExpressionFromHeapEntry(recurse: (value: any) => any, heapEntry: HeapEntry): { initializationFunc: () => string, postProcessingFunc: () => string } {
      let initialExpressionFunc: () => string;
      let postProcessingFunctionFunc: () => string | undefined;
      if (heapEntry.objectType === "not-special") {
        initialExpressionFunc = () => "{}";
        postProcessingFunctionFunc = () => undefined;
      } else {
        const heapEntrySerializers = objectHeapEntrySerializers.filter((serializer) => serializer.objectType === heapEntry.objectType);
        if (heapEntrySerializers.length === 0) {
          throw new Error(`Unknown object type: ${heapEntry.objectType}. The serialized object may be invalid.`);
        }
        if (heapEntrySerializers.length > 1) {
          throw new Error(`Multiple serializers found for object type: ${heapEntry.objectType}. Found: ${heapEntrySerializers.map((serializer) => serializer.objectType).join(", ")}`);
        }
        initialExpressionFunc = () => heapEntrySerializers[0].initializationExpression(recurse, heapEntry.data);
        postProcessingFunctionFunc = () => heapEntrySerializers[0].postProcessingFunction?.(recurse, heapEntry.data);
      }
      return {
        initializationFunc: initialExpressionFunc,
        postProcessingFunc: () => `
          (obj) => {
            (${postProcessingFunctionFunc() ?? "() => {}"})(obj);

            Object.setPrototypeOf(obj, ${recurse(heapEntry.prototype)});

            ${heapEntry.ownProperties.map(([key, descriptor]) => `
              definePropertyIfNotAlreadyDefined(obj, ${recurse(key)}, {
                ${"value" in descriptor ? `value: ${recurse(descriptor.value)},` : ""}
                ${"get" in descriptor ? `get: ${recurse(descriptor.get)},` : ""}
                ${"set" in descriptor ? `set: ${recurse(descriptor.set)},` : ""}
                ${"writable" in descriptor ? `writable: ${descriptor.writable},` : ""}
                ${"enumerable" in descriptor ? `enumerable: ${descriptor.enumerable},` : ""}
                ${"configurable" in descriptor ? `configurable: ${descriptor.configurable},` : ""}
              });
            `).join("\n\n")}

            ${heapEntry.isExtensible ? "" : "Object.preventExtensions(obj);"}
          }
        `,
      };
    }

    function serialize(obj: any, options?: { heap?: Record<string, HeapEntry>, hostObjectPath?: string, stopIfUnreachableFromHost?: boolean }) {
      const heap: Record<string, HeapEntry | "[circular reference]"> = options?.heap ?? {};

      const getSerialized = (obj: any, hostObjectPath?: string) => {
        if (hostObjectPaths.has(obj)) {
          return {
            type: "host-object",
            path: hostObjectPaths.get(obj),
          };
        }

        if (typeof obj === "function" && options?.stopIfUnreachableFromHost && !obj.toString().includes("[native code]")) {
          // this is probably a user-defined function that is polluting the global scope (most likely a function declaration at the top level of a script)
          // let's skip it instead of adding it as a host object
          return {
            type: "manual-stop",
          };
        }

        if (hostObjectPath && ["symbol", "function", "object"].includes(typeof obj) && obj !== null) {
          if (!hostObjectPaths.has(obj)) {
            hostObjectPaths.set(obj, hostObjectPath);
          }
        }

        switch (typeof obj) {
          case "string":
          case "number":
          case "boolean": {
            // Special-case NaN, Infinity, -Infinity, -0
            if (Number.isNaN(obj)) {
              return {
                type: "nan",
              };
            } else if (obj === Infinity) {
              return {
                type: "infinity",
              };
            } else if (obj === -Infinity) {
              return {
                type: "negative-infinity",
              };
            } else if (obj === 0 && 1 / obj === -Infinity) {
              return {
                type: "negative-zero",
              };
            }

            return {
              type: "simple",
              value: obj,
            };
          }
          case "bigint": {
            return {
              type: "bigint",
              valueString: obj.toString(),
            };
          }
          case "symbol": {
            const key = Symbol.keyFor(obj);
            if (key === undefined) {
              return {
                type: "unregistered-symbol",
                reference: getReference(obj),
                description: obj.description,
              };
            } else {
              return {
                type: "registered-symbol",
                key,
              };
            }
          }
          case "undefined": {
            return {
              type: "undefined",
            };
          }
          case "object":
          case "function": {
            if (obj === null) {
              return {
                type: "simple",
                value: null,
              };
            }
            const ref = getReference(obj);
            if (ref in heap) {
              // perfect! we already have a reference to this object in the heap
            } else {
              // we need to add a new reference to the heap
              const recurse = (pathDelta: null | ((old: string) => string), value: any) => {
                const newHostObjectPath = pathDelta === null || !hostObjectPath ? undefined : pathDelta(hostObjectPath);
                if (options?.stopIfUnreachableFromHost && newHostObjectPath === undefined) {
                  return {
                    type: "manual-stop",
                  };
                }
                return getSerialized(value, newHostObjectPath);
              };
              heap[ref] = "[circular reference]";
              heap[ref] = createHeapEntryForObjectLike(recurse, obj);
            }
            return {
              type: "object-like",
              reference: ref,
            };
          }
          default: {
            throw new Error(`Unknown type: ${typeof obj}`);
          }
        }
      };

      // assert there are no more [circular reference]s in the heap
      for (const key in heap) {
        if (typeof heap[key] === "string") {
          throw new Error(`Circular reference found in heap: ${key}`);
        }
      }

      const res = { heap: heap as Record<string, HeapEntry>, serialized: getSerialized(obj, options?.hostObjectPath) };
      JSON.stringify(res);  // assert the value is JSON-serializable
      return res;
    }

    function deserialize({ heap, serialized }: { heap: Record<string, HeapEntry>, serialized: any }) {
      let varCount = 0;
      const preProcessingStatements: string[] = [];
      const postProcessingStatements: string[] = [];

      const varNamesByReference: Map<string, string> = new Map();

      const getExpression = (serialized: any): string => {
        switch (serialized?.type) {
          case "simple": {
            return JSON.stringify(serialized.value);
          }
          case "nan": {
            return "NaN";
          }
          case "infinity": {
            return "Infinity";
          }
          case "negative-infinity": {
            return "-Infinity";
          }
          case "negative-zero": {
            return "-0";
          }
          case "bigint": {
            return serialized.valueString + "n";
          }
          case "unregistered-symbol": {
            return `getOrCreateValuesByReference(${JSON.stringify(serialized.reference)}, () => Symbol(${JSON.stringify(serialized.description)}))`;
          }
          case "registered-symbol": {
            return `Symbol.for(${JSON.stringify(serialized.key)})`;
          }
          case "undefined": {
            return "undefined";
          }
          case "host-object": {
            return serialized.path;
          }
          case "object-like": {
            if (!(serialized.reference in heap)) {
              throw new Error(`Heap entry not found for object-like: ${serialized.reference}. The serialized object may be invalid.`);
            }
            const heapEntry = heap[serialized.reference];

            if (varNamesByReference.has(serialized.reference)) {
              return varNamesByReference.get(serialized.reference)!;
            }

            const recurse = (data: any) => {
              return getExpression(data);
            };
            const varName = `var${varCount++}`;
            varNamesByReference.set(serialized.reference, varName);
            const { initializationFunc, postProcessingFunc } = createExpressionFromHeapEntry(recurse, heapEntry);
            const initialization = initializationFunc();
            preProcessingStatements.push(`const ${varName} /* ${serialized.reference} */ = ${initialization.trim()};`);
            const postProcessing = postProcessingFunc();
            if (postProcessing) postProcessingStatements.push(`(${postProcessing.trim()})(${varName});`);
            return varName;
          }
          case undefined: {
            throw new Error(`Serialized object does not have an objectType. This serialized object may be invalid. Object: ${JSON.stringify(serialized)}`);
          }
          default: {
            throw new Error(`Unknown serialized type: ${serialized.type}. This serialized object may be invalid.`);
          }
        }
      };

      const expr = getExpression(serialized);
      const code = `
        ${preProcessingStatements.join("\n")}

        const res = ${expr};

        ${postProcessingStatements.join("\n")}

        return res;
      `;
      console.log("CODE", code);

      return (new Function(
        "getOrCreateValuesByReference",
        "throwErr",
        "scopeMap",
        "definePropertyIfNotAlreadyDefined",
        code,
      ))(
        getOrCreateValuesByReference,
        throwErr,
        scopeMap,
        definePropertyIfNotAlreadyDefined,
      );
    }

    function registerFunction(func: Function, { scope, source }: { scope: () => Record<string, any>, source: string }) {
      if (!source) {
        throw new Error("Source is required in registerFunction (function: " + func.toString() + ")");
      }
      if (typeof scope !== "function") {
        throw new Error("Scope must be a function in registerFunction (function: " + func.toString() + ")");
      }

      const ref = getReference(func);
      functionDataByReference.set(ref, {
        functionType: "syntactic",
        scope,
        source,
      });
      return func;
    }

    /**
     * Class method syntax is different from normal function syntax and we cannot simply wrap it in a `registerFunction`
     * call without affecting the behavior, so we need to handle static and instance methods specially.
     */
    function registerClass(classConstructor: Function, { scope, source }: { scope: () => Record<string, any>, source: string }) {
      // The class itself is a function
      registerFunction(classConstructor, {
        scope,
        source,
      });

      // Register static methods
      for (const key of Object.getOwnPropertyNames(classConstructor)) {
        const method = classConstructor[key as keyof typeof classConstructor];
        if (typeof method === "function" && method !== classConstructor) {
          const ref = getReference(method);
          functionDataByReference.set(ref, {
            functionType: "class",
            class: classConstructor,
            expression: `C[${JSON.stringify(key)}]`,
          });
        }
      }

      // Register prototype
      classPrototypes.set(classConstructor.prototype, {
        class: classConstructor,
      });

      // Register instance methods
      for (const key of Object.getOwnPropertyNames(classConstructor.prototype)) {
        if (key === "constructor") continue;  // skip the constructor, it's already registered
        if (typeof classConstructor.prototype[key] === "function" && classConstructor.prototype[key] !== classConstructor) {
          const ref = getReference(classConstructor.prototype[key]);
          functionDataByReference.set(ref, {
            functionType: "class",
            class: classConstructor,
            expression: `C.prototype[${JSON.stringify(key)}]`, // TODO: this is wrong, we need to use the correct path
          });
        }
      }

      return classConstructor;
    }

    function registerHostObject(obj: any, path: string) {
      serialize(obj, { hostObjectPath: path, stopIfUnreachableFromHost: true });
    }

    function ensureSerializable<T>(obj: T): T {
      const serialized = serialize(obj);
      const deserialized = deserialize(serialized);
      if (obj !== deserialized && !(Number.isNaN(obj) && Number.isNaN(deserialized))) {
        throw new Error("Error while deserializing the object: Output does not match the input");
      }
      return deserialized;
    }

    (globalThis as any).__STACK_SerializableJs = {
      serialize,
      deserialize,
      registerFunction,
      registerClass,
      ensureSerializable,
    };

    registerHostObject(globalThis, "globalThis");
  };

  return `(${func.toString()})()`;
}
