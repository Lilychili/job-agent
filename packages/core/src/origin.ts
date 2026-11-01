// The app has no login: it relies on being reachable only from this machine. Binding to 127.0.0.1
// isn't enough, because any website open in the owner's browser can talk to localhost.
// `Host` stops DNS rebinding (a foreign name resolving to 127.0.0.1); `Origin` stops cross-site writes.
const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

export interface RequestInfo {
  method: string;
  host: string | null;
  origin: string | null;
  /** The Sec-Fetch-Site header, which pages can't forge. */
  fetchSite: string | null;
}

export function isLocalRequest({ method, host, origin, fetchSite }: RequestInfo): boolean {
  if (!host || !LOCAL_HOST.test(host)) return false;
  if (method === "GET" || method === "HEAD") return true; // reads can't change state; Host already blocks rebinding
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  if (origin === null) return true; // not a browser form or fetch: a local tool such as curl
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false; // includes the opaque "null" origin of sandboxed frames
  }
}
