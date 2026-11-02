const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", euro: "€", pound: "£" };

function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (all, dec: string, hex: string, name: string) => {
    if (name) return ENTITIES[name.toLowerCase()] ?? all;
    const code = dec ? Number(dec) : parseInt(hex, 16);
    return code <= 0x10ffff ? String.fromCodePoint(code) : all;
  });
}

/** Readable text from posting HTML. Greenhouse escapes its HTML, so it may need decoding first. */
export function htmlToText(html: string): string {
  const source = /&lt;[a-z/]/i.test(html) ? decodeEntities(html) : html;
  return decodeEntities(
    source
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Remote status from words in a location, for boards with no field for it. */
export function remoteFromLocation(location: string): "remote" | "hybrid" | "unknown" {
  if (/\bhybrid\b/i.test(location)) return "hybrid";
  return /\bremote\b/i.test(location) ? "remote" : "unknown";
}
