import { NextResponse, type NextRequest } from "next/server";
import { isLocalRequest } from "@jobagent/core/origin";

/** Refuse anything that isn't this machine talking to itself (see packages/core/src/origin.ts). */
export function proxy(req: NextRequest) {
  const allowed = isLocalRequest({
    method: req.method,
    host: req.headers.get("host"),
    origin: req.headers.get("origin"),
    fetchSite: req.headers.get("sec-fetch-site"),
  });
  if (allowed) return NextResponse.next();
  return NextResponse.json({ error: "Forbidden: this app only accepts requests from this computer." }, { status: 403 });
}
