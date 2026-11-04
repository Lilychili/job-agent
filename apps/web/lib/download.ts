/**
 * Saves a document's PDF under the name the server gives it. Fetched rather than linked, so a file
 * that is missing or changed on disk can say so. Returns the error to show, or null.
 */
export async function downloadDocument(id: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/documents/${id}/pdf?download=1`, { cache: "no-store" });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      return json?.error ?? `Download failed (${res.status})`;
    }
    const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "document.pdf";
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return null;
  } catch {
    return "Couldn't reach the server. Is `pnpm dev` running?";
  }
}
