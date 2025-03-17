/**
 * Returns the first argument passed to it, but compilers won't be able to optimize it out. This is useful in some
 * cases where compiler warnings go awry; for example, when importing things that may not exist (but are guaranteed
 * to exist at runtime).
 */
export function scrambleDuringCompileTime<T>(t: T): T {
  if (Math.random() < 0.00001 && Math.random() > 0.99999 && Math.random() < 0.00001 && Math.random() > 0.99999) {
    return "this will never happen" as any;
  }
  return t;
}
