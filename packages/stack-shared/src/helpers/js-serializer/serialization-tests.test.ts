import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import * as vm from 'vm';
import { wait } from '../../utils/promises';
import { nicify } from '../../utils/strings';
import { transpileJsToSerializableJs } from './transpiler';

function runTranspiledVmScript(code: string) {
  const transpiled = transpileJsToSerializableJs(code);
  const context = vm.createContext({
    crypto: crypto.webcrypto,
    console,
  });
  const script = new vm.Script(transpiled).runInContext(context);
  return script;
}

async function testCode(objCode: string) {
  await wait(10); // spawning too many vms synchronously freezes vitest; let's give it a bit of breathing room
  console.log("RUNNING");
  const serializeCode = `
    const obj = (${objCode.trim()});
    const serialized = __STACK_SerializableJs.serialize(obj);
    serialized;
  `;

  const serializedResult = runTranspiledVmScript(serializeCode);

  console.log("SERIALIZED RESULT", { objCode }, nicify(serializedResult, { maxDepth: 10 }));

  const deserializeCode = `
    const deserialized = __STACK_SerializableJs.deserialize(${JSON.stringify(serializedResult)});
    deserialized;
  `;

  const deserializedResult = runTranspiledVmScript(deserializeCode);

  return deserializedResult;
}

describe('Serialization and Deserialization with VM', async () => {
  // Primitive types
  it('should serialize strings', async () => {
    expect(await testCode(`"abc"`)).toBe("abc");
    expect(await testCode(`"123"`)).toBe("123");
    expect(await testCode(`"12" + 3`)).toBe("123");
  });

  it('should serialize numbers', async () => {
    expect(await testCode(`42`)).toBe(42);
    expect(await testCode(`3.14`)).toBe(3.14);
    expect(await testCode(`-0`)).toBe(-0);
    expect(1 / await testCode(`-0`)).toBe(-Infinity);
    expect(await testCode(`0`)).toBe(0);
  });

  it('should serialize special number values', async () => {
    expect(await testCode(`Infinity`)).toBe(Infinity);
    expect(await testCode(`-Infinity`)).toBe(-Infinity);
    expect(Number.isNaN(await testCode(`NaN`))).toBe(true);
  });

  it('should serialize booleans', async () => {
    expect(await testCode(`true`)).toBe(true);
    expect(await testCode(`false`)).toBe(false);
  });

  it('should serialize null and undefined', async () => {
    expect(await testCode(`null`)).toBe(null);
    expect(await testCode(`undefined`)).toBe(undefined);
  });

  it('should serialize bigints', async () => {
    expect(await testCode(`123n`)).toBe(123n);
    expect(await testCode(`-456789012345678901234567890n`)).toBe(-456789012345678901234567890n);
  });

  it('should serialize symbols', async () => {
    const result = await testCode(`Symbol("test")`);
    expect(typeof result).toBe('symbol');
    expect(result.description).toBe('test');
  });

  it('should serialize registered symbols', async () => {
    const result = await testCode(`Symbol.for("global")`);
    expect(typeof result).toBe('symbol');
    expect(Symbol.keyFor(result)).toBe('global');
  });

  // Objects
  it('should serialize basic objects', async () => {
    expect(await testCode(`
      { exampleKey: "exampleValue" }
    `)).toMatchInlineSnapshot(`
      {
        "exampleKey": "exampleValue",
      }
    `);
  });

  it('should serialize arrays', async () => {
    expect(await testCode(`[1, 2, 3]`)).toEqual([1, 2, 3]);
    expect(await testCode(`[1, "two", true, null, undefined]`)).toEqual([1, "two", true, null, undefined]);
  });

  it('should serialize nested objects', async () => {
    expect(await testCode(`{
      a: 1,
      b: {
        c: 2,
        d: {
          e: 3,
          f: [4, 5, 6]
        }
      }
    }`)).toEqual({
      a: 1,
      b: {
        c: 2,
        d: {
          e: 3,
          f: [4, 5, 6]
        }
      }
    });
  });

  it('should serialize objects with circular references', async () => {
    const result = await testCode(`
      (() => {
        const obj = { a: 1 };
        obj.self = obj;
        return obj;
      })()
    `);
    expect(result.a).toBe(1);
    expect(result.self).toBe(result);
  });

  it('should serialize sparse arrays', async () => {
    const result = await testCode(`(() => {
      const arr = [1, , , 4];
      arr.length = 10;
      return arr;
    })()`);
    expect(result.length).toBe(10);
    expect(result[0]).toBe(1);
    expect(result[3]).toBe(4);
    expect(1 in result).toBe(false);
  });

  it('should serialize arrays with custom properties', async () => {
    const result = await testCode(`(() => {
      const arr = [1, 2, 3];
      arr.customProp = "test";
      return arr;
    })()`);
    expect(result).toEqual(Object.assign([1, 2, 3], { customProp: "test" }));
    expect(result.customProp).toBe("test");
  });

  // Built-in objects
  it('should serialize Dates', async () => {
    const result = await testCode(`new Date("2024-01-01T00:00:00.000Z")`);
    expect(result.constructor.name).toBe("Date");
    expect(result.toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });

  it('should serialize RegExp', async () => {
    const result = await testCode(`/test\\d+/gi`);
    expect(result.constructor.name).toBe("RegExp");
    expect(result.source).toBe("test\\d+");
    expect(result.flags).toBe("gi");
  });

  it('should serialize Maps', async () => {
    const result = await testCode(`new Map([
      ["key1", "value1"],
      ["key2", 42],
      [3, "three"]
    ])`);
    expect(result.constructor.name).toBe("Map");
    expect(result.size).toBe(3);
    expect(result.get("key1")).toBe("value1");
    expect(result.get("key2")).toBe(42);
    expect(result.get(3)).toBe("three");
  });

  it('should serialize Sets', async () => {
    const result = await testCode(`new Set([1, "two", 3, "four", 1])`);
    expect(result.constructor.name).toBe("Set");
    expect(result.size).toBe(4);
    expect(result.has(1)).toBe(true);
    expect(result.has("two")).toBe(true);
    expect(result.has(3)).toBe(true);
    expect(result.has("four")).toBe(true);
  });

  it('should serialize Errors', async () => {
    const result = await testCode(`(() => {
      const err = new Error("Test error");
      err.name = "CustomError";
      return err;
    })()`);
    expect(result.constructor.name).toBe("Error");
    expect(result.message).toBe("Test error");
    expect(result.name).toBe("CustomError");
  });

  it('should serialize typed arrays', async () => {
    const result = await testCode(`new Uint8Array([1, 2, 3, 4, 5])`);
    expect(result.constructor.name).toBe("Uint8Array");
    expect(result).toMatchInlineSnapshot(`
      Uint8Array {
        "0": 1,
        "1": 2,
        "2": 3,
        "3": 4,
        "4": 5,
      }
    `);
  });

  it('should serialize ArrayBuffers', async () => {
    const result = await testCode(`(() => {
      const buffer = new ArrayBuffer(8);
      const view = new Uint8Array(buffer);
      view[0] = 255;
      view[7] = 128;
      return buffer;
    })()`);
    expect(result.constructor.name).toBe("ArrayBuffer");
    expect(result.byteLength).toBe(8);
    const view = new Uint8Array(result);
    expect(view[0]).toBe(255);
    expect(view[7]).toBe(128);
  });

  // Functions
  it('should serialize simple functions', async () => {
    const result = await testCode(`function add(a, b) { return a + b; }`);
    expect(typeof result).toBe('function');
    expect(result(2, 3)).toBe(5);
  });

  it('should serialize recursive functions', async () => {
    const result = await testCode(`
      (() => {
        function a(x) {
          if (x > 10) return x;
          return a(x + 3);
        }
        return a;
      })()
    `);
    expect(typeof result).toBe('function');
    expect(result(0)).toBe(12);
  });


  it('should serialize functions with circular scope dependencies', async () => {
    const result = await testCode(`
      (() => {
        function a(x) {
          if (x % 5 === 0) return x;
          return b(x);
        }
        function b(x) {
          return a(x + 1);
        }
        return [a, b];
      })()
    `);
    expect(typeof result[0]).toBe('function');
    expect(typeof result[1]).toBe('function');
    expect(result[0](0)).toBe(0);
    expect(result[0](1)).toBe(5);
    expect(result[1](0)).toBe(5);
    expect(result[1](1)).toBe(5);
  });

  it('should serialize recursive functions that use a different name for the recursive call', async () => {
    const result = await testCode(`
      (() => {
        function a(x) {
          if (x > 10) return x;
          return b(x + 3);
        }
        const b = a;
        return a;
      })()
    `);
    expect(typeof result).toBe('function');
    expect(result(0)).toBe(12);
  });

  it('should serialize arrow functions', async () => {
    const result = await testCode(`(x, y) => x * y`);
    expect(typeof result).toBe('function');
    expect(result(3, 4)).toBe(12);
  });

  it('should serialize async functions', async () => {
    const result = await testCode(`async function fetchData() {
      return "data";
    }`);
    expect(typeof result).toBe('function');
    return await expect(result()).resolves.toBe("data");
  });

  it('should serialize generator functions', async () => {
    const result = await testCode(`function* gen() {
      yield 1;
      yield 2;
      yield 3;
    }`);
    expect(typeof result).toBe('function');
    const generator = result();
    expect(generator.next().value).toBe(1);
    expect(generator.next().value).toBe(2);
    expect(generator.next().value).toBe(3);
    expect(generator.next().done).toBe(true);
  });

  it('should serialize functions with closures', async () => {
    const result = await testCode(`(() => {
      const multiplier = 10;
      return function(x) {
        return x * multiplier;
      };
    })()`);
    expect(typeof result).toBe('function');
    expect(result(5)).toBe(50);
  });

  it('should serialize nested closures', async () => {
    const result = await testCode(`(() => {
      const a = 1;
      return function(b) {
        return function(c) {
          return a + b + c;
        };
      };
    })()`);
    expect(typeof result).toBe('function');
    const inner = result(2);
    expect(typeof inner).toBe('function');
    expect(inner(3)).toBe(6);
  });

  // Classes
  it('should serialize basic classes', async () => {
    const result = await testCode(`class MyClass {
      constructor(value) {
        this.value = value;
      }
      getValue() {
        return this.value;
      }
      static staticMethod() {
        return "static";
      }
    }`);
    expect(typeof result).toBe('function');
    expect(result.name).toBe("MyClass");
    const instance = new result(42);
    expect(instance.value).toBe(42);
    expect(instance.getValue()).toBe(42);
    expect(result.staticMethod()).toBe("static");
    expect(() => result()).toThrow();
  });

  it('should serialize classes with circular scope dependencies', async () => {
    const result = await testCode(`
      (() => {
        class A {
          constructor(x) {
            this.x = x;
            this.b = x > 10 ? null : new B(x + 1);
          }
        }
        class B {
          constructor(x) {
            this.x = x;
            this.a = new A(2 * x);
          }
        }
        return [A, B];
      })()
    `);
    expect(typeof result[0]).toBe('function');
    expect(typeof result[1]).toBe('function');
    expect(new result[0](1).x).toBe(1);
    expect(new result[0](1).b.x).toBe(2);
    expect(new result[0](1).b.a.x).toBe(4);
    expect(new result[0](1).b.a.b.x).toBe(5);
    expect(new result[0](1).b.a.b.a.x).toBe(10);
    expect(new result[0](1).b.a.b.a.b.x).toBe(11);
    expect(new result[0](1).b.a.b.a.b.a.x).toBe(22);
    expect(new result[0](1).b.a.b.a.b.a.b).toBe(null);
    expect(new result[1](2).x).toBe(2);
    expect(new result[1](2).a.x).toBe(4);
    expect(new result[1](2).a.b.x).toBe(5);
    expect(new result[1](2).a.b.a.x).toBe(10);
    expect(new result[1](2).a.b.a.b.x).toBe(11);
    expect(new result[1](2).a.b.a.b.a.x).toBe(22);
    expect(new result[1](2).a.b.a.b.a.b).toBe(null);
  });

  it('should serialize classes that have a field equal to the class itself', async () => {
    const result = await testCode(`
      class A {
        static self = A;
        constructor() {
          this.x = 42;
        }
      }
    `);
    expect(typeof result).toBe('function');
    expect(result.self).toBe(result);
    expect(new result().x).toBe(42);
  });

  it('should serialize class inheritance', async () => {
    const result = await testCode(`(() => {
      class Animal {
        constructor(name) {
          this.name = name;
        }
        speak() {
          return this.name + " makes a sound";
        }
      }
      
      class Dog extends Animal {
        constructor(name, breed) {
          super(name);
          this.breed = breed;
        }
        speak() {
          return this.name + " barks";
        }
      }
      
      return Dog;
    })()`);
    expect(typeof result).toBe('function');
    const dog = new result("Max", "Golden Retriever");
    expect(dog.name).toBe("Max");
    expect(dog.breed).toBe("Golden Retriever");
    expect(dog.speak()).toBe("Max barks");
  });

  it('should serialize class inheritance when the superclass references the subclass', async () => {
    const result = await testCode(`(() => {
      class Animal {
        constructor(name) {
          this.name = name;
          this.dogConstructor = Dog;
        }
        speak() {
          return this.name + " makes a sound";
        }
      }
      
      class Dog extends Animal {
        constructor(name, breed) {
          super(name);
          this.breed = breed;
        }
        speak() {
          return this.name + " barks";
        }
      }
      
      return Dog;
    })()`);
    expect(typeof result).toBe('function');
    const dog = new result("Max", "Golden Retriever");
    console.log(dog);
    expect(dog.name).toBe("Max");
    expect(dog.breed).toBe("Golden Retriever");
    expect(dog.speak()).toBe("Max barks");
  });

  it('should serialize class inheritance when the superclass references the subclass and the superclass is the one being serialized', async () => {
    const result = await testCode(`(() => {
      class Animal {
        constructor(name) {
          this.name = name;
          this.dogConstructor = Dog;
        }
        speak() {
          return this.name + " makes a sound";
        }
      }
      
      class Dog extends Animal {
        constructor(name, breed) {
          super(name);
          this.breed = breed;
        }
        speak() {
          return this.name + " barks";
        }
      }
      
      return Animal;
    })()`);
    expect(typeof result).toBe('function');
    const animal = new result("Sam the Squirrel");
    expect(animal.name).toBe("Sam the Squirrel");
    expect(animal.speak()).toBe("Sam the Squirrel makes a sound");
    expect(typeof animal.dogConstructor).toBe('function');
    expect(animal.dogConstructor.name).toBe("Dog");
    expect(new animal.dogConstructor("Max", "Golden Retriever").speak()).toBe("Max barks");
  });

  it('should serialize class instances', async () => {
    const result = await testCode(`(() => {
      class Person {
        constructor(name, age) {
          this.name = name;
          this.age = age;
        }
        greet() {
          return "Hello, I'm " + this.name;
        }
      }
      return new Person("Alice", 30);
    })()`);
    expect(result.name).toBe("Alice");
    expect(result.age).toBe(30);
    expect(result.greet()).toBe("Hello, I'm Alice");
  });

  // Object descriptors
  it('should serialize getters and setters', async () => {
    const result = await testCode(`{
      _value: 10,
      get value() {
        return this._value;
      },
      set value(v) {
        this._value = v;
      }
    }`);
    expect(result.value).toBe(10);
    result.value = 20;
    expect(result.value).toBe(20);
    expect(result._value).toBe(20);
  });

  it('should serialize non-enumerable properties', async () => {
    const result = await testCode(`(() => {
      const obj = {};
      Object.defineProperty(obj, 'hidden', {
        value: 'secret',
        enumerable: false,
        writable: true,
        configurable: true
      });
      Object.defineProperty(obj, 'visible', {
        value: 'public',
        enumerable: true
      });
      return obj;
    })()`);
    expect(result.hidden).toBe('secret');
    expect(result.visible).toBe('public');
    expect(Object.keys(result)).toEqual(['visible']);
  });

  it('should serialize non-writable properties', async () => {
    const result = await testCode(`(() => {
      const obj = {};
      Object.defineProperty(obj, 'constant', {
        value: 42,
        writable: false
      });
      return obj;
    })()`);
    expect(result.constant).toBe(42);
    expect(() => {
      result.constant = 100;
    }).toThrow();
  });

  it('should serialize non-configurable properties', async () => {
    const result = await testCode(`(() => {
      const obj = {};
      Object.defineProperty(obj, 'fixed', {
        value: 'immutable',
        configurable: false
      });
      return obj;
    })()`);
    expect(result.fixed).toBe('immutable');
    expect(() => {
      delete result.fixed;
    }).toThrow();
  });

  it('should serialize frozen objects', async () => {
    const result = await testCode(`Object.freeze({ a: 1, b: 2 })`);
    expect(result).toEqual({ a: 1, b: 2 });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('should serialize sealed objects', async () => {
    const result = await testCode(`Object.seal({ x: 10, y: 20 })`);
    expect(result).toEqual({ x: 10, y: 20 });
    expect(Object.isSealed(result)).toBe(true);
  });

  it('should serialize non-extensible objects', async () => {
    const result = await testCode(`(() => {
      const obj = { prop: 'value' };
      Object.preventExtensions(obj);
      return obj;
    })()`);
    expect(result.prop).toBe('value');
    expect(Object.isExtensible(result)).toBe(false);
  });

  // Edge cases
  it('should handle circular references', async () => {
    const result = await testCode(`(() => {
      const obj = { a: 1 };
      obj.self = obj;
      return obj;
    })()`);
    expect(result.a).toBe(1);
    expect(result.self).toBe(result);
  });

  it('should handle mutual references', async () => {
    const result = await testCode(`(() => {
      const obj1 = { name: 'obj1' };
      const obj2 = { name: 'obj2' };
      obj1.ref = obj2;
      obj2.ref = obj1;
      return { obj1, obj2 };
    })()`);
    expect(result.obj1.name).toBe('obj1');
    expect(result.obj2.name).toBe('obj2');
    expect(result.obj1.ref).toBe(result.obj2);
    expect(result.obj2.ref).toBe(result.obj1);
  });

  it('should serialize objects with symbol keys', async () => {
    const result = await testCode(`(() => {
      const sym1 = Symbol('key1');
      const sym2 = Symbol.for('key2');
      const obj = {
        [sym1]: 'value1',
        [sym2]: 'value2',
        normal: 'value3'
      };
      return obj;
    })()`);
    expect(result.normal).toBe('value3');
    const symbols = Object.getOwnPropertySymbols(result);
    expect(symbols.length).toBe(2);
  });

  it('should serialize complex nested structures', async () => {
    const result = await testCode(`{
      data: {
        users: [
          { id: 1, name: "Alice", tags: new Set(["admin", "user"]) },
          { id: 2, name: "Bob", tags: new Set(["user"]) }
        ],
        index: new Map([
          [1, "Alice"],
          [2, "Bob"]
        ]),
        metadata: {
          created: new Date("2024-01-01"),
          pattern: /user-\\d+/,
          transform: (x) => x.toUpperCase()
        }
      }
    }`);
    expect(result.data.users[0].name).toBe("Alice");
    expect(result.data.users[0].tags.has("admin")).toBe(true);
    expect(result.data.index.get(1)).toBe("Alice");
    expect(result.data.metadata.created.getFullYear()).toBe(2024);
    expect(result.data.metadata.pattern.test("user-123")).toBe(true);
    expect(result.data.metadata.transform("hello")).toBe("HELLO");
  });

  it('should serialize objects with mixed property types', async () => {
    const result = await testCode(`(() => {
      const obj = {
        normal: 'prop',
        123: 'numeric',
        [Symbol('sym')]: 'symbol',
        get computed() { return 'getter'; },
        method() { return 'method'; }
      };
      Object.defineProperty(obj, 'hidden', {
        value: 'non-enumerable',
        enumerable: false
      });
      return obj;
    })()`);
    expect(result.normal).toBe('prop');
    expect(result[123]).toBe('numeric');
    expect(result.computed).toBe('getter');
    expect(result.method()).toBe('method');
    expect(result.hidden).toBe('non-enumerable');
  });

  it('should serialize async generator functions', async () => {
    const result = await testCode(`async function* asyncGen() {
      yield 1;
      yield 2;
      yield 3;
    }`);
    expect(typeof result).toBe('function');
    const generator = result();
    return await (async () => {
      expect((await generator.next()).value).toBe(1);
      expect((await generator.next()).value).toBe(2);
      expect((await generator.next()).value).toBe(3);
      expect((await generator.next()).done).toBe(true);
    })();
  });

  it('should serialize promises (with rejection)', async () => {
    const result = await testCode(`Promise.resolve(42)`);
    expect(result.constructor.name).toBe("Promise");
    // Note: Promises can't be fully serialized, they should reject
    return await expect(result).rejects.toThrow();
  });

  it('should serialize proxy objects', async () => {
    const result = await testCode(`(() => {
      const target = { value: 42 };
      const handler = {
        get(target, prop) {
          if (prop === 'doubled') {
            return target.value * 2;
          }
          return target[prop];
        }
      };
      return new Proxy(target, handler);
    })()`);
    // Note: Proxies may not serialize perfectly, but basic functionality should work
    expect(result.value).toBe(42);
  });

  it('should handle objects with null prototype', async () => {
    const result = await testCode(`Object.create(null)`);
    expect(Object.getPrototypeOf(result)).toBe(null);
  });

  it('should serialize WeakMap and WeakSet', async () => {
    const result = await testCode(`{
      weakMap: new WeakMap(),
      weakSet: new WeakSet()
    }`);
    expect(result.weakMap.constructor.name).toBe("WeakMap");
    expect(result.weakSet.constructor.name).toBe("WeakSet");
  });

  it('should serialize primitive wrapper objects', async () => {
    const result = await testCode(`{
      num: new Number(42),
      str: new String("hello"),
      bool: new Boolean(true)
    }`);
    expect(typeof result.num).toBe("object");
    expect(typeof result.str).toBe("object");
    expect(typeof result.bool).toBe("object");
    expect(result.num.valueOf()).toBe(42);
    expect(result.str.valueOf()).toBe("hello");
    expect(result.bool.valueOf()).toBe(true);
  });

  it('should handle very deeply nested objects', async () => {
    const result = await testCode(`(() => {
      let obj = { value: 0 };
      let current = obj;
      for (let i = 1; i <= 100; i++) {
        current.next = { value: i };
        current = current.next;
      }
      return obj;
    })()`);
    let current = result;
    for (let i = 0; i <= 100; i++) {
      expect(current.value).toBe(i);
      current = current.next;
      if (i === 100) {
        expect(current).toBeUndefined();
      }
    }
  });

  it('should serialize functions that reference each other', async () => {
    const result = await testCode(`(() => {
      function isEven(n) {
        if (n === 0) return true;
        return isOdd(n - 1);
      }
      
      function isOdd(n) {
        if (n === 0) return false;
        return isEven(n - 1);
      }
      
      return { isEven, isOdd };
    })()`);
    expect(result.isEven(4)).toBe(true);
    expect(result.isEven(5)).toBe(false);
    expect(result.isOdd(3)).toBe(true);
    expect(result.isOdd(6)).toBe(false);
  });

  it('should handle computed property names', async () => {
    const result = await testCode(`(() => {
      const key1 = 'dynamic';
      const key2 = 'Key';
      return {
        [key1 + key2]: 'value',
        ['computed' + 123]: 'another'
      };
    })()`);
    expect(result.dynamicKey).toBe('value');
    expect(result.computed123).toBe('another');
  });

  it('should serialize template literal functions', async () => {
    const result = await testCode(`(strings, ...values) => {
      return strings.join('') + values.join('');
    }`);
    expect(typeof result).toBe('function');
    expect(result(['Hello ', ' world'], 'beautiful')).toBe('Hello  worldbeautiful');
  });

  it('should handle object spread and rest', async () => {
    const result = await testCode(`(() => {
      const base = { a: 1, b: 2 };
      const extended = { ...base, c: 3, a: 10 };
      return extended;
    })()`);
    expect(result).toEqual({ a: 10, b: 2, c: 3 });
  });

  it('should serialize objects with toJSON method', async () => {
    const result = await testCode(`{
      value: 42,
      toJSON() {
        return { custom: this.value * 2 };
      }
    }`);
    expect(result.value).toBe(42);
    expect(result.toJSON()).toEqual({ custom: 84 });
  });

  // Bound functions and context
  it('should serialize bound functions', async () => {
    const result = await testCode(`(() => {
      const obj = {
        value: 42,
        getValue: function() {
          return this.value;
        }
      };
      return obj.getValue.bind(obj);
    })()`);
    expect(typeof result).toBe('function');
    expect(result()).toBe(42);
  });

  it('should serialize functions with call/apply', async () => {
    const result = await testCode(`(() => {
      function greet(greeting, punctuation) {
        return greeting + ", " + this.name + punctuation;
      }
      return greet;
    })()`);
    expect(typeof result).toBe('function');
    expect(result.call({ name: "Alice" }, "Hello", "!")).toBe("Hello, Alice!");
    expect(result.apply({ name: "Bob" }, ["Hi", "?"])).toBe("Hi, Bob?");
  });

  it('should serialize partially applied functions', async () => {
    const result = await testCode(`(() => {
      function add(a, b, c) {
        return a + b + c;
      }
      return add.bind(null, 1, 2);
    })()`);
    expect(typeof result).toBe('function');
    expect(result(3)).toBe(6);
  });

  // Iterators and iterables
  it('should serialize custom iterators', async () => {
    const result = await testCode(`(() => {
      const obj = {
        values: [1, 2, 3],
        [Symbol.iterator]: function() {
          let index = 0;
          const values = this.values;
          return {
            next() {
              if (index < values.length) {
                return { value: values[index++], done: false };
              }
              return { done: true };
            }
          };
        }
      };
      return obj;
    })()`);
    const values = [];
    for (const value of result) {
      values.push(value);
    }
    expect(values).toEqual([1, 2, 3]);
  });

  it('should serialize async iterators', async () => {
    const result = await testCode(`(() => {
      const obj = {
        values: [1, 2, 3],
        [Symbol.asyncIterator]: async function*() {
          for (const value of this.values) {
            yield value;
          }
        }
      };
      return obj;
    })()`);
    const values = [];
    for await (const value of result) {
      values.push(value);
    }
    expect(values).toEqual([1, 2, 3]);
  });

  it('should serialize Map iterators', async () => {
    const result = await testCode(`(() => {
      const map = new Map([['a', 1], ['b', 2]]);
      return {
        keys: [...map.keys()],
        values: [...map.values()],
        entries: [...map.entries()]
      };
    })()`);
    expect(result.keys).toEqual(['a', 'b']);
    expect(result.values).toEqual([1, 2]);
    expect(result.entries).toEqual([['a', 1], ['b', 2]]);
  });

  // String edge cases
  it('should serialize strings with special characters', async () => {
    const result = await testCode(`"Hello\\nWorld\\t\\r\\0\\x00\\u0000"`);
    expect(result).toBe("Hello\nWorld\t\r\0\x00\u0000");
  });

  it('should serialize template literals', async () => {
    const result = await testCode(`(() => {
      const name = "World";
      const num = 42;
      return \`Hello \${name}, the answer is \${num}\`;
    })()`);
    expect(result).toBe("Hello World, the answer is 42");
  });

  // Number edge cases
  it('should serialize MAX_SAFE_INTEGER and beyond', async () => {
    expect(await testCode(`Number.MAX_SAFE_INTEGER`)).toBe(Number.MAX_SAFE_INTEGER);
    expect(await testCode(`Number.MIN_SAFE_INTEGER`)).toBe(Number.MIN_SAFE_INTEGER);
    expect(await testCode(`Number.MAX_VALUE`)).toBe(Number.MAX_VALUE);
    expect(await testCode(`Number.MIN_VALUE`)).toBe(Number.MIN_VALUE);
    expect(await testCode(`Number.EPSILON`)).toBe(Number.EPSILON);
  });

  // Object property edge cases
  it('should serialize property accessors with side effects', async () => {
    const result = await testCode(`(() => {
      let count = 0;
      const obj = {
        get counter() {
          return ++count;
        }
      };
      return obj;
    })()`);
    const val1 = result.counter;
    const val2 = result.counter;
    expect(val2).toBeGreaterThan(val1);
  });

  it('should serialize objects with numeric string keys', async () => {
    const result = await testCode(`{
      "0": "zero",
      "1": "one",
      "10": "ten",
      "2": "two"
    }`);
    expect(result["0"]).toBe("zero");
    expect(result["1"]).toBe("one");
    expect(result["10"]).toBe("ten");
    expect(result["2"]).toBe("two");
  });

  // Function edge cases
  it('should serialize functions with default parameters', async () => {
    const result = await testCode(`(function(a = 1, b = 2) {
      return a + b;
    })`);
    expect(result()).toBe(3);
    expect(result(5)).toBe(7);
    expect(result(5, 5)).toBe(10);
  });

  it('should serialize functions with rest parameters', async () => {
    const result = await testCode(`(function(...args) {
      return args.reduce((a, b) => a + b, 0);
    })`);
    expect(result(1, 2, 3, 4, 5)).toBe(15);
  });

  it('should serialize functions with destructuring parameters', async () => {
    const result = await testCode(`(function({ x, y = 10 }) {
      return x + y;
    })`);
    expect(result({ x: 5 })).toBe(15);
    expect(result({ x: 5, y: 3 })).toBe(8);
  });

  // Class edge cases
  it('should serialize private class fields', async () => {
    const result = await testCode(`(() => {
      class Counter {
        #count = 0;
        
        increment() {
          return ++this.#count;
        }
        
        getCount() {
          return this.#count;
        }
      }
      return new Counter();
    })()`);
    expect(result.increment()).toBe(1);
    expect(result.increment()).toBe(2);
    expect(result.getCount()).toBe(2);
  });

  it('should serialize static class fields', async () => {
    const result = await testCode(`class MyClass {
      static staticField = "static value";
      static #privateStatic = "private";
      
      static getPrivate() {
        return this.#privateStatic;
      }
    }`);
    expect(result.staticField).toBe("static value");
    expect(result.getPrivate()).toBe("private");
  });

  it('should serialize class with getters/setters', async () => {
    const result = await testCode(`(() => {
      class Temperature {
        constructor(celsius) {
          this._celsius = celsius;
        }
        
        get fahrenheit() {
          return this._celsius * 9/5 + 32;
        }
        
        set fahrenheit(value) {
          this._celsius = (value - 32) * 5/9;
        }
        
        get celsius() {
          return this._celsius;
        }
      }
      return new Temperature(0);
    })()`);
    expect(result.celsius).toBe(0);
    expect(result.fahrenheit).toBe(32);
    result.fahrenheit = 212;
    expect(result.celsius).toBe(100);
  });

  it('should serialize class with getters accessing private fields', async () => {
    const result = await testCode(`(() => {
      class Temperature {
        #celsius;
        constructor(celsius) {
          this.#celsius = celsius;
        }
        
        get fahrenheit() {
          return this.#celsius * 9/5 + 32;
        }
        
        set fahrenheit(value) {
          this.#celsius = (value - 32) * 5/9;
        }
        
        get celsius() {
          return this.#celsius;
        }
      }
      return new Temperature(0);
    })()`);
    expect(result.fahrenheit).toBe(32);
    result.fahrenheit = 212;
    expect(result.celsius).toBe(100);
  });

  it('should serialize class with static getters/setters accessing static private fields', async () => {
    const result = await testCode(`(() => {
      class Temperature {
        static #celsius = 0;
        
        static get fahrenheit() {
          return this.#celsius * 9/5 + 32;
        }
        
        static set fahrenheit(value) {
          this.#celsius = (value - 32) * 5/9;
        }
        
        static get celsius() {
          return this.#celsius;
        }
      }
      return Temperature;
    })()`);
    expect(result.fahrenheit).toBe(32);
    result.fahrenheit = 212;
    expect(result.celsius).toBe(100);
    expect(result.fahrenheit).toBe(212);
  });

  it('should serialize class methods correctly even after they are no longer on the class prototype', async () => {
    const result = await testCode(`(() => {
      class MyClass {
        method() {
          return "Hello";
        }
      }
      const method = MyClass.prototype.method;
      MyClass.prototype.method = () => "Goodbye";
      return [method, MyClass.prototype.method];
    })()`);
    expect(result[0]()).toBe("Hello");
    expect(result[1]()).toBe("Goodbye");
  });

  // Promise edge cases
  it('should serialize rejected promises', async () => {
    const result = await testCode(`Promise.reject(new Error("Test error"))`);
    expect(result.constructor.name).toBe("Promise");
    return await expect(result).rejects.toThrow();
  });

  it('should serialize promise chains', async () => {
    const result = await testCode(`(() => {
      return Promise.resolve(1)
        .then(x => x * 2)
        .then(x => x + 3);
    })()`);
    expect(result.constructor.name).toBe("Promise");
    // Can't fully serialize promise chains
    return await expect(result).rejects.toThrow();
  });

  // RegExp edge cases
  it('should serialize complex regex patterns', async () => {
    const result = await testCode(`/^(?:(?:https?|ftp):\\/\\/)(?:\\S+(?::\\S*)?@)?(?:(?!10(?:\\.\\d{1,3}){3}))/gim`);
    expect(result.constructor.name).toBe("RegExp");
    expect(result.global).toBe(true);
    expect(result.ignoreCase).toBe(true);
    expect(result.multiline).toBe(true);
  });

  it('should serialize regex with unicode flag', async () => {
    const result = await testCode(`/\\p{Emoji}/gu`);
    expect(result.constructor.name).toBe("RegExp");
    expect(result.unicode).toBe(true);
    expect(result.global).toBe(true);
  });

  // Error edge cases
  it('should serialize custom error types', async () => {
    const result = await testCode(`(() => {
      class CustomError extends Error {
        constructor(message, code) {
          super(message);
          this.name = "CustomError";
          this.code = code;
        }
      }
      const err = new CustomError("Something went wrong", 404);
      return err;
    })()`);
    expect(result.message).toBe("Something went wrong");
    expect(result.name).toBe("CustomError");
    expect(result.code).toBe(404);
  });

  it('should serialize error with cause', async () => {
    const result = await testCode(`(() => {
      const cause = new Error("Root cause");
      const error = new Error("High level error", { cause });
      return error;
    })()`);
    expect(result.message).toBe("High level error");
    expect(result.cause.message).toBe("Root cause");
  });

  // Typed arrays edge cases
  it('should serialize different typed arrays', async () => {
    expect(Array.from(await testCode(`new Int8Array([127, -128, 0])`))).toEqual([127, -128, 0]);
    expect(Array.from(await testCode(`new Uint16Array([0, 65535, 32768])`))).toEqual([0, 65535, 32768]);
    expect(Array.from(await testCode(`new Float32Array([3.14, -0, Infinity])`))).toEqual([3.140000104904175, -0, Infinity]);
    expect(Array.from(await testCode(`new BigInt64Array([123n, -456n])`))).toEqual([123n, -456n]);
  });

  it('should serialize DataView', async () => {
    const result = await testCode(`(() => {
      const buffer = new ArrayBuffer(8);
      const view = new DataView(buffer);
      view.setInt32(0, 42);
      view.setFloat32(4, 3.14);
      return view;
    })()`);
    expect(result.constructor.name).toBe("DataView");
    expect(result.getInt32(0)).toBe(42);
    expect(result.getFloat32(4)).toBeCloseTo(3.14);
  });

  // Collection edge cases
  it('should serialize Maps with object keys', async () => {
    const result = await testCode(`(() => {
      const key1 = { id: 1 };
      const key2 = { id: 2 };
      const map = new Map([
        [key1, "value1"],
        [key2, "value2"]
      ]);
      return { map, key1, key2 };
    })()`);
    expect(result.map.get(result.key1)).toBe("value1");
    expect(result.map.get(result.key2)).toBe("value2");
  });

  it('should serialize recursive Maps', async () => {
    const result = await testCode(`(() => {
      const map = new Map();
      map.set("key1", "value1");
      map.set("key2", 42);
      map.set(3, "three");
      map.set(map, map);
      return map;
    })()`);
    expect(result.constructor.name).toBe("Map");
    expect(result.size).toBe(3);
    expect(result.get("key1")).toBe("value1");
    expect(result.get("key2")).toBe(42);
    expect(result.get(3)).toBe("three");
    expect(result.get(result)).toBe(result);
  });

  it('should serialize Sets with object values', async () => {
    const result = await testCode(`(() => {
      const obj1 = { id: 1 };
      const obj2 = { id: 2 };
      const set = new Set([obj1, obj2, obj1]);
      return { set, obj1, obj2 };
    })()`);
    expect(result.set.size).toBe(2);
    expect(result.set.has(result.obj1)).toBe(true);
    expect(result.set.has(result.obj2)).toBe(true);
  });

  // Object.create edge cases
  it('should serialize objects with custom prototypes', async () => {
    const result = await testCode(`(() => {
      const proto = {
        greet() {
          return "Hello, " + this.name;
        }
      };
      const obj = Object.create(proto);
      obj.name = "World";
      return obj;
    })()`);
    expect(result.name).toBe("World");
    expect(result.greet()).toBe("Hello, World");
  });

  it('should serialize prototype chains', async () => {
    const result = await testCode(`(() => {
      const grandparent = { level: "grandparent" };
      const parent = Object.create(grandparent);
      parent.level = "parent";
      const child = Object.create(parent);
      child.level = "child";
      return child;
    })()`);
    expect(result.level).toBe("child");
  });

  // Destructuring edge cases
  it('should handle destructured function returns', async () => {
    const result = await testCode(`(() => {
      function getCoords() {
        return { x: 10, y: 20, z: 30 };
      }
      const { x, y } = getCoords();
      return { x, y };
    })()`);
    expect(result).toEqual({ x: 10, y: 20 });
  });

  // Multiple inheritance patterns
  it('should serialize mixins', async () => {
    const result = await testCode(`(() => {
      const canFly = {
        fly() { return this.name + " flies"; }
      };
      
      const canSwim = {
        swim() { return this.name + " swims"; }
      };
      
      function createDuck(name) {
        return Object.assign(
          { name },
          canFly,
          canSwim
        );
      }
      
      return createDuck("Donald");
    })()`);
    expect(result.name).toBe("Donald");
    expect(result.fly()).toBe("Donald flies");
    expect(result.swim()).toBe("Donald swims");
  });

  // Object.assign and spread edge cases
  it('should handle property override order', async () => {
    const result = await testCode(`(() => {
      const obj1 = { a: 1, b: 2 };
      const obj2 = { b: 3, c: 4 };
      const obj3 = { c: 5, d: 6 };
      return Object.assign({}, obj1, obj2, obj3);
    })()`);
    expect(result).toEqual({ a: 1, b: 3, c: 5, d: 6 });
  });

  // Global objects
  it('should handle references to global objects', async () => {
    const result = await testCode(`{
      objProto: Object.prototype,
      arrProto: Array.prototype,
      funcProto: Function.prototype
    }`);
    expect(result.objProto.constructor.name).toBe("Object");
    expect(result.arrProto.constructor.name).toBe("Array");
    expect(result.funcProto.constructor.name).toBe("Function");
  });

  // Arguments object
  it('should serialize arguments object', async () => {
    const result = await testCode(`(function() {
      return arguments;
    })(1, 2, 3)`);
    expect(result[0]).toBe(1);
    expect(result[1]).toBe(2);
    expect(result[2]).toBe(3);
    expect(result.length).toBe(3);
  });

  // Tagged template literals
  it('should serialize tagged template functions', async () => {
    const result = await testCode(`(() => {
      function tag(strings, ...values) {
        return {
          strings: [...strings],
          values: [...values]
        };
      }
      return tag;
    })()`);
    const tagged = result`Hello ${"World"} and ${42}!`;
    expect(tagged.strings).toEqual(["Hello ", " and ", "!"]);
    expect(tagged.values).toEqual(["World", 42]);
  });

  // Object.is edge cases
  it('should preserve Object.is semantics', async () => {
    const result = await testCode(`{
      zero: 0,
      negZero: -0,
      nan1: NaN,
      nan2: 0/0
    }`);
    expect(Object.is(result.zero, 0)).toBe(true);
    expect(Object.is(result.negZero, -0)).toBe(true);
    expect(Object.is(result.zero, result.negZero)).toBe(false);
    expect(Object.is(result.nan1, NaN)).toBe(true);
    expect(Object.is(result.nan1, result.nan2)).toBe(true);
  });

  // WeakMap operations
  it('should serialize WeakMap with operations', async () => {
    const result = await testCode(`(() => {
      const wm = new WeakMap();
      const key1 = { id: 1 };
      const key2 = { id: 2 };
      wm.set(key1, "value1");
      wm.set(key2, "value2");
      return { wm, key1, key2 };
    })()`);
    expect(result.wm.constructor.name).toBe("WeakMap");
    expect(result.wm.has(result.key1)).toBe(true);
    expect(result.wm.has(result.key2)).toBe(true);
    expect(result.wm.get(result.key1)).toBe("value1");
    expect(result.wm.get(result.key2)).toBe("value2");
  });

  // WeakSet operations
  it('should serialize WeakSet with operations', async () => {
    const result = await testCode(`(() => {
      const ws = new WeakSet();
      const obj1 = { id: 1 };
      const obj2 = { id: 2 };
      ws.add(obj1);
      ws.add(obj2);
      ws.add(obj1); // Adding twice, should still only be there once
      return { ws, obj1, obj2 };
    })()`);
    expect(result.ws.constructor.name).toBe("WeakSet");
    expect(result.ws.has(result.obj1)).toBe(true);
    expect(result.ws.has(result.obj2)).toBe(true);
  });

  // WeakRef
  it('should serialize WeakRef', async () => {
    const result = await testCode(`(() => {
      const target = { value: 42 };
      const ref = new WeakRef(target);
      return { ref, target };
    })()`);
    expect(result.ref.constructor.name).toBe("WeakRef");
    expect(result.ref.deref()).toBe(result.target);
    expect(result.ref.deref().value).toBe(42);
  });

  // FinalizationRegistry
  it('should serialize FinalizationRegistry', async () => {
    const result = await testCode(`(() => {
      let cleanupCalled = false;
      const registry = new FinalizationRegistry((heldValue) => {
        cleanupCalled = true;
      });
      const target = { data: "test" };
      registry.register(target, "cleanup value");
      return { registry, target, getCleanupStatus: () => cleanupCalled };
    })()`);
    expect(result.registry.constructor.name).toBe("FinalizationRegistry");
    expect(result.target.data).toBe("test");
    expect(result.getCleanupStatus()).toBe(false); // Won't be called immediately
  });

  // WeakMap with complex values
  it('should serialize WeakMap with complex values', async () => {
    const result = await testCode(`(() => {
      const wm = new WeakMap();
      const key = { name: "key" };
      const value = {
        data: [1, 2, 3],
        nested: { prop: "value" },
        fn: function() { return this.data.length; }
      };
      wm.set(key, value);
      return { wm, key };
    })()`);
    const value = result.wm.get(result.key);
    expect(value.data).toEqual([1, 2, 3]);
    expect(value.nested.prop).toBe("value");
    expect(value.fn()).toBe(3);
  });

  // Multiple WeakRefs to same object
  it('should serialize multiple WeakRefs to same target', async () => {
    const result = await testCode(`(() => {
      const target = { shared: "data" };
      const ref1 = new WeakRef(target);
      const ref2 = new WeakRef(target);
      return { ref1, ref2, target };
    })()`);
    expect(result.ref1.deref()).toBe(result.target);
    expect(result.ref2.deref()).toBe(result.target);
    expect(result.ref1.deref()).toBe(result.ref2.deref());
  });

  // WeakMap/WeakSet edge cases
  it('should handle WeakMap/WeakSet with deleted keys', async () => {
    const result = await testCode(`(() => {
      const wm = new WeakMap();
      const ws = new WeakSet();
      const key1 = { id: 1 };
      const key2 = { id: 2 };
      
      wm.set(key1, "value1");
      wm.set(key2, "value2");
      ws.add(key1);
      ws.add(key2);
      
      wm.delete(key1);
      ws.delete(key1);
      
      return { wm, ws, key1, key2 };
    })()`);
    expect(result.wm.has(result.key1)).toBe(false);
    expect(result.wm.has(result.key2)).toBe(true);
    expect(result.ws.has(result.key1)).toBe(false);
    expect(result.ws.has(result.key2)).toBe(true);
  });

  // WeakRef deref returning undefined
  it('should handle WeakRef with nullified target', async () => {
    const result = await testCode(`(() => {
      let target = { value: 42 };
      const ref = new WeakRef(target);
      // Note: In real scenarios, target might be garbage collected
      // For testing, we just simulate the scenario
      return { ref, hasTarget: () => ref.deref() !== undefined };
    })()`);
    expect(result.ref.constructor.name).toBe("WeakRef");
    expect(result.hasTarget()).toBe(true); // In test, target is kept alive
  });

  // FinalizationRegistry with unregister
  it('should serialize FinalizationRegistry with unregister', async () => {
    const result = await testCode(`(() => {
      const registry = new FinalizationRegistry((heldValue) => {
        console.log("Cleanup:", heldValue);
      });
      const target1 = { id: 1 };
      const target2 = { id: 2 };
      const token1 = {};
      const token2 = {};
      
      registry.register(target1, "value1", token1);
      registry.register(target2, "value2", token2);
      registry.unregister(token1);
      
      return { registry, target1, target2, token1, token2 };
    })()`);
    expect(result.registry.constructor.name).toBe("FinalizationRegistry");
    expect(result.target1.id).toBe(1);
    expect(result.target2.id).toBe(2);
  });

  // Combinations of weak references
  it('should serialize combinations of weak collections', async () => {
    const result = await testCode(`(() => {
      const shared = { shared: true };
      const wm = new WeakMap();
      const ws = new WeakSet();
      const wr = new WeakRef(shared);
      
      wm.set(shared, "in WeakMap");
      ws.add(shared);
      
      return {
        shared,
        wm,
        ws,
        wr,
        check: () => ({
          inMap: wm.has(shared),
          inSet: ws.has(shared),
          deref: wr.deref() === shared
        })
      };
    })()`);
    const check = result.check();
    expect(check.inMap).toBe(true);
    expect(check.inSet).toBe(true);
    expect(check.deref).toBe(true);
  });

  // WeakMap as value in another WeakMap
  it('should serialize nested weak collections', async () => {
    const result = await testCode(`(() => {
      const outer = new WeakMap();
      const inner = new WeakMap();
      const key1 = { level: "outer" };
      const key2 = { level: "inner" };
      
      inner.set(key2, "inner value");
      outer.set(key1, inner);
      
      return { outer, key1, key2 };
    })()`);
    const inner = result.outer.get(result.key1);
    expect(inner.constructor.name).toBe("WeakMap");
    expect(inner.get(result.key2)).toBe("inner value");
  });

  // Symbol as WeakMap value (not key)
  it('should serialize symbols in weak collections', async () => {
    const result = await testCode(`(() => {
      const wm = new WeakMap();
      const key = { id: "key" };
      const sym = Symbol("mySymbol");
      wm.set(key, sym);
      return { wm, key, sym };
    })()`);
    expect(result.wm.get(result.key)).toBe(result.sym);
    expect(typeof result.wm.get(result.key)).toBe("symbol");
  });

  // WeakRef in arrays and objects
  it('should serialize WeakRefs in collections', async () => {
    const result = await testCode(`(() => {
      const targets = [
        { id: 1 },
        { id: 2 },
        { id: 3 }
      ];
      const refs = targets.map(t => new WeakRef(t));
      const refMap = new Map(targets.map((t, i) => [i, new WeakRef(t)]));
      
      return { targets, refs, refMap };
    })()`);
    expect(result.refs[0].deref().id).toBe(1);
    expect(result.refs[1].deref().id).toBe(2);
    expect(result.refs[2].deref().id).toBe(3);
    expect(result.refMap.get(0).deref().id).toBe(1);
  });

  // Circular references with WeakMap
  it('should handle circular references in WeakMaps', async () => {
    const result = await testCode(`(() => {
      const wm = new WeakMap();
      const obj = { name: "circular" };
      obj.weakMap = wm;
      wm.set(obj, obj);
      return { wm, obj };
    })()`);
    expect(result.wm.get(result.obj)).toBe(result.obj);
    expect(result.obj.weakMap).toBe(result.wm);
  });

  // WeakSet with functions
  it('should serialize functions in WeakSet', async () => {
    const result = await testCode(`(() => {
      const ws = new WeakSet();
      const fn1 = function() { return 1; };
      const fn2 = () => 2;
      const fn3 = async function() { return 3; };
      
      ws.add(fn1);
      ws.add(fn2);
      ws.add(fn3);
      
      return { ws, fn1, fn2, fn3 };
    })()`);
    expect(result.ws.has(result.fn1)).toBe(true);
    expect(result.ws.has(result.fn2)).toBe(true);
    expect(result.ws.has(result.fn3)).toBe(true);
  });

  // FinalizationRegistry with multiple registrations
  it('should handle FinalizationRegistry with multiple targets', async () => {
    const result = await testCode(`(() => {
      const cleanups = [];
      const registry = new FinalizationRegistry((heldValue) => {
        cleanups.push(heldValue);
      });
      
      const targets = [
        { id: 1 },
        { id: 2 },
        { id: 3 }
      ];
      
      targets.forEach((target, i) => {
        registry.register(target, "cleanup-" + i);
      });
      
      return { registry, targets, getCleanups: () => [...cleanups] };
    })()`);
    expect(result.registry.constructor.name).toBe("FinalizationRegistry");
    expect(result.targets.length).toBe(3);
    expect(result.getCleanups()).toEqual([]); // No cleanups yet
  });
});
