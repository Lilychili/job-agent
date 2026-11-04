import { greenhouse } from "./greenhouse";
import { lever } from "./lever";
import type { FormAdapter } from "./types";

export * from "./types";
export * from "./plan";
export * from "./session";
export * from "./prefill";
export * from "./windows";
export * from "./careers";
export { greenhouse, lever };

const ADAPTERS: Partial<Record<string, FormAdapter>> = { greenhouse, lever };

/** The adapter that can fill this ATS's forms, or null when there is none yet. */
export function adapterFor(ats: string): FormAdapter | null {
  return ADAPTERS[ats] ?? null;
}
