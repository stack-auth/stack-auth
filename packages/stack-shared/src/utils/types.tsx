import { DeepPartial } from "./objects";
import { Join } from "./strings";

export type IsAny<T> = 0 extends (1 & T) ? true : false;
export type IsNever<T> = [T] extends [never] ? true : false;
export type IsNullish<T> = [T] extends [null | undefined] ? true : false;
export type IsUnion<T, U = T> =
  IsNever<T> extends true ? false
  : IsAny<T> extends true ? false
    : T extends U // distributive conditional https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types
        ? /* if the *whole* original type (`U`) still fits inside the current variant, then `T` wasn’t a union */ ([U] extends [T] ? false : true)
        : never;

export type NullishCoalesce<T, U> = T extends null | undefined ? U : T;

export type LastUnionElement<U> = UnionToIntersection<U extends any ? (x: U) => 0 : never> extends (x: infer L) => 0 ? L & U : never;

/**
 * Makes a type prettier by recursively expanding all object types. For example, `Omit<{ a: 1 }, "a">` becomes just `{}`.
 */
export type Expand<T> = T extends object ? { [K in keyof T]: Expand<T[K]> } : T;


/**
 * Removes all optional undefined/never keys from an object.
 */
export type DeepRemoveOptionalUndefined<T> = T extends object ? { [K in keyof T]: DeepRemoveOptionalUndefined<T[K]> } : T;

// why this works: https://stackoverflow.com/a/50375286
export type UnionToIntersection<U> =
  (U extends any ? (x: U) => void : never) extends ((x: infer I) => void) ? I : never

type _UnionToTupleInner<U, R extends any[], Last> = UnionToTuple<Exclude<U, Last>, [...R, Last]>
export type UnionToTuple<U, R extends any[] = []> = [U] extends [never] ? R : _UnionToTupleInner<U, R, LastUnionElement<U>>;

export type CollapseObjectUnion<T extends object> = {
  [K in AllUnionKeys<T>]?: T extends Record<K, infer V> ? V : never;
};
typeAssertIs<CollapseObjectUnion<{ a: string } | { b: number }>, { a?: string, b?: number }>()();
typeAssertIs<CollapseObjectUnion<{ a: string } | { a: number }>, { a?: string | number }>()();

export type IntersectAll<T extends any[]> = UnionToIntersection<T[number]>;

export type OptionalKeys<T> = {
  [K in keyof T]: {} extends Pick<T, K> ? K : never;
}[keyof T];
export type RequiredKeys<T> = {
  [K in keyof T]: {} extends Pick<T, K> ? never : K;
}[keyof T];

/**
 * Returns ALL keys of all union elements.
 */
export type AllUnionKeys<T extends object> = T extends T ? keyof T : never;
typeAssertIs<AllUnionKeys<{ a: string } | { b: number }>, "a" | "b">()();

export type SubtractType<T, U> = T extends object ? { [K in keyof T]: K extends keyof U ? SubtractType<T[K], U[K]> : T[K] } : (T extends U ? never : T); // note: this only works due to the distributive property of conditional types https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types


type _AntiIntersectInner<T, U> = T extends object ? (
  & Omit<U, keyof T>
  & { [K in keyof Pick<U, { [K in keyof T & keyof U]: U[K] extends T[K] ? (T[K] extends U[K] ? never : K) : never }[keyof T & keyof U]>]: PseudoAntiIntersect<T[K], U[K]> }
  & { [K in keyof Pick<U, keyof T & keyof U>]?: PseudoAntiIntersect<T[K], U[K]> }
) : U;
/**
 * Returns a type R such that T & R = U.
 */
export type AntiIntersect<T, U> = U extends T ? _AntiIntersectInner<T, U> : "Cannot anti-intersect a type with a type that is not a subtype of it"; // NOTE: This type is mostly untested — not sure how well it works on the edge cases
export type PseudoAntiIntersect<T, U> = _AntiIntersectInner<T, T & U>;

/**
 * A variation of TypeScript's conditionals with slightly different semantics. It is the perfect type for cases where:
 *
 * - If all possible values are contained in `Extends`, then it will be mapped to `Then`.
 * - If all possible values are not contained in `Extends`, then it will be mapped to `Otherwise`.
 * - If some possible values are contained in `Extends` and some are not, then it will be mapped to `Then | Otherwise`.
 *
 * This is different from TypeScript's built-in conditional types (`Value extends Extends ? Then : Otherwise`), which
 * returns `Otherwise` for the third case (causing unsoundness in many real-world cases).
 */
export type IfAndOnlyIf<Value, Extends, Then, Otherwise> =
  | (Value extends Extends ? never : Otherwise)
  | (Value & Extends extends never ? never : Then);


/**
 * Can be used to prettify a type in the IDE; for example, some complicated intersected types can be flattened into a single type.
 */
export type PrettifyType<T> = T extends object ? { [K in keyof T]: T[K] } & {} : T;

type _ToStringAndJoin<T extends any[], Separator extends string> =
  T extends [infer U, ...infer Rest extends any[]]
    ? `${TypeToString<U>}${Rest extends [any, ...any[]] ? `${Separator}${_ToStringAndJoin<Rest, Separator>}` : ""}`
    : "<error-joining-tuple-elements>";
type _TypeToStringInner<T> =
  IsAny<T> extends true ? "any"
  : IsNever<T> extends true ? "never"
  : IsUnion<T> extends true ? _ToStringAndJoin<UnionToTuple<T>, " | ">
  : [T] extends [number] ? (number extends T ? "number" : `${T}`)
  : [T] extends [boolean] ? `${T}`
  : [T] extends [undefined] ? "undefined"
  : [T] extends [null] ? "null"
  : [T] extends [string] ? (string extends T ? "string" : `'${T}'`)
  : [T] extends [[]] ? "[]"
  : [T] extends [[any, ...any[]]] ? `[${_ToStringAndJoin<T, ", ">}]`
  : [T] extends [(infer E)[]] ? `${TypeToString<E>}[]`
  : [T] extends [Function] ? "function"
  : [T] extends [symbol] ? `symbol(${T['description']})`
  : [T] extends [object] ? `{ ${Join<UnionToTuple<{ [K in keyof T]: `${TypeToString<K>}: ${TypeToString<T[K]>}` }[keyof T]>, ", ">} }`
  : "<unknown-type>"
export type TypeToString<T> = _TypeToStringInner<T> extends `${infer S}` ? S : never;

/**
 * Can be used to create assertions on types. For example, if passed any T other than `true`, the following will
 * show a type error:
 *
 * ```ts
 * typeAssert<T>()();  // the second pair of braces is important!
 * ```
 */
export function typeAssert<T>(): (
  IsAny<T> extends true ? TypeAssertionError<`Type assertion failed. Expected true, but got any.`>
    : IsNever<T> extends true ? TypeAssertionError<`Type assertion failed. Expected true, but got never.`>
    : T extends true ? (() => undefined)
    : TypeAssertionError<`Type assertion failed. Expected true, but got: ${TypeToString<T>}`>
) {
  return (() => undefined) as any;
}
type TypeAssertionError<T> =
  & [T]
  & /* this promise makes sure that if we accidentally forget the second pair of braces, eslint will complain (if we have no-floating-promises enabled) */ Promise<any>;


typeAssertExtends<ReturnType<typeof typeAssert<true>>, () => undefined>()();
typeAssertExtends<ReturnType<typeof typeAssert<false>>, TypeAssertionError<`Type assertion failed. Expected true, but got: false`>>()();
typeAssertExtends<ReturnType<typeof typeAssert<never>>, TypeAssertionError<`Type assertion failed. Expected true, but got never.`>>()();
typeAssertExtends<ReturnType<typeof typeAssert<any>>, TypeAssertionError<`Type assertion failed. Expected true, but got any.`>>()();

/**
 * Functionally equivalent to `typeAssert<T extends S ? true : false>()()`, but with better error messages.
 */
export function typeAssertExtends<T, S>(): (
  [T] extends [S] ? (() => undefined) : TypeAssertionError<`Type assertion failed. Expected ${TypeToString<T>} to extend ${TypeToString<S>}`>
) {
  return (() => undefined) as any;
}

typeAssertExtends<ReturnType<typeof typeAssertExtends<never, true>>, () => undefined>()();
typeAssertExtends<ReturnType<typeof typeAssertExtends<any, true>>, () => undefined>()();
typeAssertExtends<ReturnType<typeof typeAssertExtends<false, false>>, () => undefined>()();
typeAssertExtends<ReturnType<typeof typeAssertExtends<"abc", string>>, () => undefined>()();
typeAssertExtends<ReturnType<typeof typeAssertExtends<{a: 1, b: 123}, {a: number}>>, () => undefined>()();
typeAssertExtends<ReturnType<typeof typeAssertExtends<never, never>>, () => undefined>()();
typeAssertExtends<ReturnType<typeof typeAssertExtends<true, any>>, () => undefined>()();

typeAssertExtends<ReturnType<typeof typeAssertExtends<{a: number}, {a: 1}>>, ["Type assertion failed. Expected { 'a': number } to extend { 'a': 1 }"]>()();
typeAssertExtends<ReturnType<typeof typeAssertExtends<any, never>>, ["Type assertion failed. Expected any to extend never"]>()();
typeAssertExtends<ReturnType<typeof typeAssertExtends<false, true>>, ["Type assertion failed. Expected false to extend true"]>()();
typeAssertExtends<ReturnType<typeof typeAssertExtends<false, never>>, ["Type assertion failed. Expected false to extend never"]>()();


export function typeAssertIs<T, U>(): (
  IsAny<T> extends true ? (IsAny<U> extends true ? (() => undefined) : TypeAssertionError<`Type assertion failed. Expected ${TypeToString<T>} to be ${TypeToString<U>}`>)
    : IsAny<U> extends true ? TypeAssertionError<`Type assertion failed. Expected ${TypeToString<T>} to be ${TypeToString<U>}`>
    : [T] extends [U] ? ([U] extends [T] ? (() => undefined) : TypeAssertionError<`Type assertion failed. Expected ${TypeToString<T>} to be ${TypeToString<U>}`>)
    : TypeAssertionError<`Type assertion failed. Expected ${TypeToString<T>} to be ${TypeToString<U>}`>
) {
  return (() => undefined) as any;
}

typeAssertExtends<ReturnType<typeof typeAssertIs<"123", "123">>, () => undefined>()();
typeAssertExtends<ReturnType<typeof typeAssertIs<{a: 1}, {a: 1}>>, () => undefined>()();
typeAssertExtends<ReturnType<typeof typeAssertIs<DeepPartial<{a: 1}>, {a?: 1}>>, () => undefined>()();
typeAssertExtends<ReturnType<typeof typeAssertIs<any, any>>, () => undefined>()();
typeAssertExtends<ReturnType<typeof typeAssertIs<never, never>>, () => undefined>()();
typeAssertExtends<ReturnType<typeof typeAssertIs<1, any>>, ["Type assertion failed. Expected 1 to be any"]>()();
typeAssertExtends<ReturnType<typeof typeAssertIs<any, 1>>, ["Type assertion failed. Expected any to be 1"]>()();
typeAssertExtends<ReturnType<typeof typeAssertIs<false, true>>, ["Type assertion failed. Expected false to be true"]>()();
typeAssertExtends<ReturnType<typeof typeAssertIs<{a: number}, {a: 1}>>, ["Type assertion failed. Expected { 'a': number } to be { 'a': 1 }"]>()();
typeAssertExtends<ReturnType<typeof typeAssertIs<any, never>>, ["Type assertion failed. Expected any to be never"]>()();
typeAssertExtends<ReturnType<typeof typeAssertIs<false, true>>, ["Type assertion failed. Expected false to be true"]>()();
typeAssertExtends<ReturnType<typeof typeAssertIs<false, never>>, ["Type assertion failed. Expected false to be never"]>()();
