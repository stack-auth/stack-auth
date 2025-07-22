export type IsAny<T> = 0 extends (1 & T) ? true : false;
export type IsNever<T> = [T] extends [never] ? true : false;
export type IsNullish<T> = T extends null | undefined ? true : false;

export type NullishCoalesce<T, U> = T extends null | undefined ? U : T;

// distributive conditional type magic. See: https://stackoverflow.com/a/50375286
export type UnionToIntersection<U> =
  (U extends any ? (x: U) => void : never) extends ((x: infer I) => void) ? I : never

export type IntersectAll<T extends any[]> = UnionToIntersection<T[number]>;

export type OptionalKeys<T> = {
  [K in keyof T]: {} extends Pick<T, K> ? K : never;
}[keyof T];
export type RequiredKeys<T> = {
  [K in keyof T]: {} extends Pick<T, K> ? never : K;
}[keyof T];

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
