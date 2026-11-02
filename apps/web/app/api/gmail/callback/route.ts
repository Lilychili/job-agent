import { connectGmail, GmailError } from "@jobagent/core";
import { route } from "@/lib/route";
import { getCtx } from "@/lib/server";

const backToSettings = (query = "") =>
  new Response(null, {
    status: 302,
    headers: { location: `/settings${query}`, "set-cookie": "gmail_state=; HttpOnly; SameSite=Lax; Path=/api/gmail; Max-Age=0" },
  });

/** Google sends the owner back here. Only an answer to this browser's own request is accepted. */
export const GET = route(async (req) => {
  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const cookie = req.headers.get("cookie")?.match(/(?:^|;\s*)gmail_state=([^;]+)/)?.[1];
  const code = url.searchParams.get("code");
  if (!state || state !== cookie || !code) return backToSettings("?gmail=failed");
  try {
    await connectGmail((await getCtx()).pool, code);
  } catch (err) {
    if (!(err instanceof GmailError)) throw err;
    return backToSettings("?gmail=failed");
  }
  return backToSettings();
});
