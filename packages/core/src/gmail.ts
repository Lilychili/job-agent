// Read-only Gmail, for job alerts. Plain fetch keeps the token handling visible, as in the Claude client.
// Google's scope can read the whole mailbox, so what is actually read is limited here, in code:
// only job alerts from Indeed and LinkedIn, and nothing else is fetched or stored.
import type pg from "pg";
import { ConfigError, decryptSecret, encryptionKeyFromEnv, encryptSecret } from "./secrets";

const GMAIL_REDIRECT_URI = "http://127.0.0.1:3000/api/gmail/callback";
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
/** Exact addresses, because the rest of linkedin.com's mail is messages and notifications. */
const LINKEDIN_ALERT_SENDERS = ["jobalerts-noreply@linkedin.com", "jobs-listings@linkedin.com", "jobs-noreply@linkedin.com"];
/** Confirms applications, so it holds no new jobs. */
const INDEED_APPLY_SENDER = "indeedapply@indeed.com";
const ALERT_SEARCHES: { source: AlertSource; from: string }[] = [
  { source: "indeed_alert", from: `from:indeed.com -from:${INDEED_APPLY_SENDER}` },
  { source: "linkedin_alert", from: `from:(${LINKEDIN_ALERT_SENDERS.join(" OR ")})` },
];
const MAX_ALERTS_PER_SOURCE = 8;
const REQUEST_TIMEOUT_MS = 20_000;

export type AlertSource = "indeed_alert" | "linkedin_alert";

export interface AlertEmail {
  source: AlertSource;
  html: string;
}

export class GmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailError";
  }
}

export function gmailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.GOOGLE_CLIENT_ID?.trim() && !!env.GOOGLE_CLIENT_SECRET?.trim();
}

function credentials(env: NodeJS.ProcessEnv = process.env) {
  if (!gmailConfigured(env)) throw new ConfigError("Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env to connect Gmail.");
  return { clientId: env.GOOGLE_CLIENT_ID!.trim(), clientSecret: env.GOOGLE_CLIENT_SECRET!.trim() };
}

/** Where the owner approves access. `state` ties Google's answer to this browser. */
export function gmailAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: credentials().clientId,
    redirect_uri: GMAIL_REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline", // a refresh token, so Search can read alerts later
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function tokenRequest(body: Record<string, string>): Promise<{ access_token?: string; refresh_token?: string }> {
  const res = await fetch(TOKEN_URL, { method: "POST", body: new URLSearchParams(body), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const json = (await res.json().catch(() => null)) as { access_token?: string; refresh_token?: string; error?: string } | null;
  if (json?.error === "invalid_grant") throw new GmailError("Google no longer accepts the Gmail connection. Connect Gmail again in Settings.");
  if (!res.ok || !json) throw new GmailError(`Google answered ${res.status}.`);
  return json;
}

export async function connectGmail(pool: pg.Pool, code: string): Promise<void> {
  const { clientId, clientSecret } = credentials();
  const { refresh_token } = await tokenRequest({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: GMAIL_REDIRECT_URI, grant_type: "authorization_code" });
  if (!refresh_token) throw new GmailError("Google didn't give a lasting token. Remove the app's access in your Google account and connect again.");
  await pool.query("insert into settings (id) values (gen_random_uuid()) on conflict do nothing");
  await pool.query("update settings set encrypted_gmail_token = $1", [encryptSecret(refresh_token, encryptionKeyFromEnv())]);
}

async function storedToken(pool: pg.Pool): Promise<string | null> {
  const { rows } = await pool.query<{ encrypted_gmail_token: string | null }>("select encrypted_gmail_token from settings limit 1");
  const stored = rows[0]?.encrypted_gmail_token;
  return stored ? decryptSecret(stored, encryptionKeyFromEnv()) : null;
}

/** Forget the token here, and ask Google to cancel it. The local part happens whatever Google says. */
export async function disconnectGmail(pool: pg.Pool): Promise<void> {
  const token = await storedToken(pool);
  await pool.query("update settings set encrypted_gmail_token = null");
  if (token) await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", body: new URLSearchParams({ token }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }).catch(() => {});
}

interface MessagePart {
  mimeType?: string;
  body?: { data?: string };
  parts?: MessagePart[];
  headers?: { name: string; value: string }[];
}

/** The address in a From header decides, because Gmail's `from:` search also matches the display name. */
export function alertSource(from: string): AlertSource | null {
  const address = (from.match(/<([^>]+)>\s*$/)?.[1] ?? from).trim().toLowerCase();
  if (address === INDEED_APPLY_SENDER) return null;
  if (/@([a-z0-9-]+\.)*indeed\.com$/.test(address)) return "indeed_alert";
  return LINKEDIN_ALERT_SENDERS.includes(address) ? "linkedin_alert" : null;
}

/** The HTML of a message, or its plain text if that's all it has. */
export function messageBody(part: MessagePart): string | null {
  const find = (p: MessagePart, type: string): string | null => {
    if (p.mimeType === type && p.body?.data) return p.body.data;
    for (const child of p.parts ?? []) {
      const hit = find(child, type);
      if (hit) return hit;
    }
    return null;
  };
  const data = find(part, "text/html") ?? find(part, "text/plain");
  return data === null ? null : Buffer.from(data, "base64url").toString("utf8");
}

async function gmailGet<T>(url: string, accessToken: string, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!res.ok) throw new GmailError(`Gmail answered ${res.status}.`);
  return (await res.json()) as T;
}

/** Recent alerts, newest first for each source. Null when Gmail isn't connected. Untrusted text. */
export async function readAlertEmails(pool: pg.Pool, signal?: AbortSignal): Promise<AlertEmail[] | null> {
  const refreshToken = await storedToken(pool);
  if (!refreshToken) return null;
  const { clientId, clientSecret } = credentials();
  const { access_token } = await tokenRequest({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" });
  if (!access_token) throw new GmailError("Google didn't give an access token.");

  // One search per source, so a busy sender can't use up the other's share.
  const perSource = await Promise.all(
    ALERT_SEARCHES.map(async ({ source, from: sender }) => {
      const query = new URLSearchParams({ q: `${sender} newer_than:14d`, maxResults: String(MAX_ALERTS_PER_SOURCE) });
      const { messages } = await gmailGet<{ messages?: { id: string }[] }>(`${API}/messages?${query}`, access_token, signal);
      return Promise.all(
        (messages ?? []).map(async ({ id }): Promise<AlertEmail | null> => {
          const { payload } = await gmailGet<{ payload?: MessagePart }>(`${API}/messages/${encodeURIComponent(id)}?format=full`, access_token, signal);
          const from = payload?.headers?.find((h) => h.name.toLowerCase() === "from")?.value ?? "";
          const html = payload && alertSource(from) === source ? messageBody(payload) : null;
          return html ? { source, html } : null;
        }),
      );
    }),
  );
  return perSource.flat().filter((e): e is AlertEmail => e !== null);
}
