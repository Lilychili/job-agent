import { randomBytes } from "node:crypto";
import { gmailAuthUrl } from "@jobagent/core";
import { route } from "@/lib/route";

/** Sends the owner to Google. The cookie proves the answer that comes back is one this browser asked for. */
export const GET = route(async () => {
  const state = randomBytes(24).toString("base64url");
  return new Response(null, {
    status: 302,
    headers: {
      location: gmailAuthUrl(state),
      "set-cookie": `gmail_state=${state}; HttpOnly; SameSite=Lax; Path=/api/gmail; Max-Age=600`,
    },
  });
});
