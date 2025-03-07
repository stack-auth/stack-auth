import { nicify } from "./strings";

export function logged<T extends object>(name: string, toLog: T, options: {} = {}): T {
  const proxy = new Proxy(toLog, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig === "function") {
        return function (this: any, ...args: any[]) {
          const success = (v: any, isPromise: boolean) => console.debug(`logged(...): Called ${name}.${String(prop)}(${args.map(a => nicify(a)).join(", ")}) => ${isPromise ? "Promise<" : ""}${nicify(result)}${isPromise ? ">" : ""}`, { this: this, args, promise: isPromise ? result : false, result: v, trace: new Error() });
          const error = (e: any, isPromise: boolean) => console.debug(`logged(...): Error in ${name}.${String(prop)}(${args.map(a => nicify(a)).join(", ")})`, { this: this, args, promise: isPromise ? result : false, error: e, trace: new Error() });

          let result: unknown;
          try {
            result = orig.apply(this, args);
          } catch (e) {
            error(e, false);
            throw e;
          }
          if (result instanceof Promise) {
            result.then((v) => success(v, true)).catch((e) => error(e, true));
          } else {
            success(result, false);
          }
          return result;
        };
      }
      return orig;
    },
    set(target, prop, value) {
      console.log(`Setting ${name}.${String(prop)} to ${value}`);
      return Reflect.set(target, prop, value);
    },
    apply(target, thisArg, args) {
      console.log(`Calling ${name}(${JSON.stringify(args).slice(1, -1)})`);
      return Reflect.apply(target as any, thisArg, args);
    },
    construct(target, args, newTarget) {
      console.log(`Constructing ${name}(${JSON.stringify(args).slice(1, -1)})`);
      return Reflect.construct(target as any, args, newTarget);
    },
    defineProperty(target, prop, descriptor) {
      console.log(`Defining ${name}.${String(prop)} as ${JSON.stringify(descriptor)}`);
      return Reflect.defineProperty(target, prop, descriptor);
    },
    deleteProperty(target, prop) {
      console.log(`Deleting ${name}.${String(prop)}`);
      return Reflect.deleteProperty(target, prop);
    },
    setPrototypeOf(target, prototype) {
      console.log(`Setting prototype of ${name} to ${prototype}`);
      return Reflect.setPrototypeOf(target, prototype);
    },
    preventExtensions(target) {
      console.log(`Preventing extensions of ${name}`);
      return Reflect.preventExtensions(target);
    },
  });
  return proxy;
}

export function createLazyProxy<FactoryResult>(factory: () => FactoryResult): FactoryResult {
  let cache: FactoryResult | undefined = undefined;
  let initialized: boolean = false;

  function initializeIfNeeded() {
    if (!initialized) {
      cache = factory();
      initialized = true;
    }
    return cache!;
  }

  return new Proxy({}, {
    get(target, prop, receiver) {
      const instance = initializeIfNeeded();
      return Reflect.get(instance, prop, receiver);
    },
    set(target, prop, value, receiver) {
      const instance = initializeIfNeeded();
      return Reflect.set(instance, prop, value, receiver);
    },
    has(target, prop) {
      const instance = initializeIfNeeded();
      return Reflect.has(instance, prop);
    },
    deleteProperty(target, prop) {
      const instance = initializeIfNeeded();
      return Reflect.deleteProperty(instance, prop);
    },
    ownKeys(target) {
      const instance = initializeIfNeeded();
      return Reflect.ownKeys(instance);
    },
    getOwnPropertyDescriptor(target, prop) {
      const instance = initializeIfNeeded();
      return Reflect.getOwnPropertyDescriptor(instance, prop);
    },
    defineProperty(target, prop, descriptor) {
      const instance = initializeIfNeeded();
      return Reflect.defineProperty(instance, prop, descriptor);
    },
    getPrototypeOf(target) {
      const instance = initializeIfNeeded();
      return Reflect.getPrototypeOf(instance);
    },
    setPrototypeOf(target, proto) {
      const instance = initializeIfNeeded();
      return Reflect.setPrototypeOf(instance, proto);
    },
    isExtensible(target) {
      const instance = initializeIfNeeded();
      return Reflect.isExtensible(instance);
    },
    preventExtensions(target) {
      const instance = initializeIfNeeded();
      return Reflect.preventExtensions(instance);
    },
    apply(target, thisArg, argumentsList) {
      const instance = initializeIfNeeded();
      return Reflect.apply(instance as any, thisArg, argumentsList);
    },
    construct(target, argumentsList, newTarget) {
      const instance = initializeIfNeeded();
      return Reflect.construct(instance as any, argumentsList, newTarget);
    }
  }) as FactoryResult;
}
import.meta.vitest?.test("createLazyProxy", ({ expect }) => {
  // Test with a simple object factory
  let factoryCallCount = 0;
  const createObject = () => {
    factoryCallCount++;
    return { value: 42, method: () => "hello" };
  };

  const proxy = createLazyProxy(createObject);

  // Factory should not be called until property is accessed
  expect(factoryCallCount).toBe(0);

  // Accessing a property should initialize the object
  expect(proxy.value).toBe(42);
  expect(factoryCallCount).toBe(1);

  // Accessing another property should not call factory again
  expect(proxy.method()).toBe("hello");
  expect(factoryCallCount).toBe(1);

  // Test with property setting
  proxy.value = 100;
  expect(proxy.value).toBe(100);
  expect(factoryCallCount).toBe(1);

  // Test with a class factory
  let classFactoryCallCount = 0;
  class TestClass {
    constructor() {
      classFactoryCallCount++;
    }

    getValue() {
      return "class value";
    }
  }

  const classFactory = () => new TestClass();
  const classProxy = createLazyProxy(classFactory);

  // Factory should not be called until method is accessed
  expect(classFactoryCallCount).toBe(0);

  // Accessing a method should initialize the object
  expect(classProxy.getValue()).toBe("class value");
  expect(classFactoryCallCount).toBe(1);

  // Accessing the method again should not call factory again
  expect(classProxy.getValue()).toBe("class value");
  expect(classFactoryCallCount).toBe(1);
});
