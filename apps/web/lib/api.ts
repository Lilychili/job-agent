/** Tiny fetch helper for the client forms: never throws, always says whether it worked and why not. */
export async function api<T = unknown>(
  url: string,
  method: "GET" | "PUT" | "POST" | "DELETE" = "GET",
  body?: unknown,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method,
      cache: "no-store",
      headers: body !== undefined && !(body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok) return { ok: false, error: json?.error ?? `Request failed (${res.status})` };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Is `pnpm dev` running?" };
  }
}
