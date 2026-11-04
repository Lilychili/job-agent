// Links from emails, web searches and careers pages are untrusted: none may lead this machine to itself
// or its network. One check for every place that opens such a link.

/** Names that resolve to this machine or a private network, and literal IP addresses. */
const PRIVATE_HOST = /(^|\.)(localhost|local|internal|lan|home\.arpa)$|^\d+\.\d+\.\d+\.\d+$|^\[.*\]$/i;

/** Whether a link may be opened at all: https on a public name. */
export function isPublicHttps(raw: string | URL): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  // "localhost." is localhost too.
  const host = url.hostname.replace(/\.$/, "");
  return url.protocol === "https:" && host.includes(".") && !PRIVATE_HOST.test(host);
}

/** A link a card can show: http or https, never a scheme a click would hand to another app. */
export function isWebLink(raw: string): boolean {
  try {
    const { protocol } = new URL(raw);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
