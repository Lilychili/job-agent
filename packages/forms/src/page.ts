import type { Page } from "playwright";

/**
 * Run `fn` in the page. tsx (the worker) compiles functions with esbuild's keepNames, which calls a
 * `__name` helper the page doesn't have, so the source goes over as text with a local stand-in.
 */
export function inPage<A, R>(page: Page, fn: (arg: A) => R, arg: A): Promise<R> {
  return page.evaluate(`(() => { const __name = (f) => f; return (${fn.toString()})(${JSON.stringify(arg)}); })()`) as Promise<R>;
}
