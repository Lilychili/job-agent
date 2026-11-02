import { describe, expect, it } from "vitest";
import { alertSource, gmailAuthUrl, gmailConfigured, messageBody } from "../src/gmail";

describe("alertSource", () => {
  it("goes by the address, not the display name", () => {
    expect(alertSource("Indeed <alert@indeed.com>")).toBe("indeed_alert");
    expect(alertSource("alert@match.indeed.com")).toBe("indeed_alert");
    expect(alertSource('"alert@indeed.com" <someone@evil.com>')).toBeNull();
    expect(alertSource("Indeed <alert@indeed.com.evil.com>")).toBeNull();
    expect(alertSource("Indeed <alert@notindeed.com>")).toBeNull();
  });

  it("leaves out Indeed's application confirmations", () => {
    expect(alertSource("Indeed Apply <indeedapply@indeed.com>")).toBeNull();
  });

  it("takes only LinkedIn's job alert senders, not its other mail", () => {
    expect(alertSource("LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>")).toBe("linkedin_alert");
    expect(alertSource("LinkedIn <JOBS-LISTINGS@linkedin.com>")).toBe("linkedin_alert");
    expect(alertSource("LinkedIn <messages-noreply@linkedin.com>")).toBeNull();
    expect(alertSource("LinkedIn <invitations@linkedin.com>")).toBeNull();
    expect(alertSource('"jobalerts-noreply@linkedin.com" <someone@evil.com>')).toBeNull();
  });
});

describe("messageBody", () => {
  const b64 = (s: string) => Buffer.from(s).toString("base64url");
  it("prefers HTML, however deep it sits", () => {
    const body = messageBody({
      mimeType: "multipart/alternative",
      parts: [{ mimeType: "text/plain", body: { data: b64("plain") } }, { mimeType: "multipart/related", parts: [{ mimeType: "text/html", body: { data: b64("<b>html</b>") } }] }],
    });
    expect(body).toBe("<b>html</b>");
  });
  it("falls back to plain text, then nothing", () => {
    expect(messageBody({ mimeType: "text/plain", body: { data: b64("plain") } })).toBe("plain");
    expect(messageBody({ mimeType: "image/png" })).toBeNull();
  });
});

describe("gmailAuthUrl", () => {
  it("asks for read-only access and a lasting token", () => {
    const old = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    const url = new URL(gmailAuthUrl("state"));
    expect(gmailConfigured()).toBe(true);
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.toString()).not.toContain("secret");
    process.env.GOOGLE_CLIENT_ID = old.id ?? "";
    process.env.GOOGLE_CLIENT_SECRET = old.secret ?? "";
  });
});
