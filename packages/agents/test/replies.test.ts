import { describe, expect, it } from "vitest";
import { decide, parseKinds, type ReplyEmail } from "../src/replies";

const email = (text: string, from = "Recruiting <jobs@acme.com>", subject = "Your application"): ReplyEmail => ({
  id: "m1",
  from,
  subject,
  receivedAt: new Date("2026-11-01"),
  html: `<p>${text}</p>`,
});

describe("parseKinds", () => {
  const emails = [email("Thanks, Acme is moving forward with other candidates."), email("Hi, Acme would like a call on Monday.")];

  it("takes Claude's labels by email number", () => {
    const out = { emails: [{ number: 1, kind: "rejection" }, { number: 2, kind: "reply" }] };
    expect(parseKinds(out, emails, "Acme")).toEqual(["rejection", "reply"]);
  });

  it("treats a missing, unknown or malformed label as unrelated", () => {
    const out = { emails: [{ number: 2, kind: "offer" }, { number: "1", kind: "reply" }, null] };
    expect(parseKinds(out, emails, "Acme")).toEqual(["unrelated", "unrelated"]);
    expect(parseKinds(null, emails, "Acme")).toEqual(["unrelated", "unrelated"]);
  });

  it("ignores an email that never names the company, whatever Claude says", () => {
    const out = { emails: [{ number: 1, kind: "rejection" }] };
    expect(parseKinds(out, [email("We are moving forward with other candidates.", "Someone <hr@other.com>")], "Acme")).toEqual(["unrelated"]);
  });

  it("finds the company in the sender or the subject", () => {
    const out = { emails: [{ number: 1, kind: "reply" }] };
    expect(parseKinds(out, [email("Can we talk?", "Ana <ana@acme.com>", "Next steps")], "Acme")).toEqual(["reply"]);
    expect(parseKinds(out, [email("Can we talk?", "Ana <ana@x.com>", "Acme: next steps")], "Acme")).toEqual(["reply"]);
  });
});

describe("decide", () => {
  it("lets the newest reply or rejection decide, skipping receipts and noise", () => {
    expect(decide(["acknowledgement", "unrelated", "reply", "rejection"], "applied")).toEqual({ move: "markReplied", index: 2 });
    expect(decide(["unrelated", "rejection", "reply"], "applied")).toEqual({ move: "markRejected", index: 1 });
  });

  it("does nothing for receipts and noise alone", () => {
    expect(decide(["acknowledgement", "unrelated"], "applied")).toBeNull();
    expect(decide([], "applied")).toBeNull();
  });

  it("moves a replied card only to rejected", () => {
    expect(decide(["reply"], "replied")).toBeNull();
    expect(decide(["rejection"], "replied")).toEqual({ move: "markRejected", index: 0 });
  });
});
