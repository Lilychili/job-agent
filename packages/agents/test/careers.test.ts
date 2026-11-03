import { describe, expect, it } from "vitest";
import { ValidationError } from "@jobagent/core";
import { parseCareersLinks } from "../src/careers";

describe("parseCareersLinks", () => {
  it("keeps public https links, without fragments or repeats", () => {
    expect(parseCareersLinks({ links: ["https://www.wizeline.ai/careers#open", "https://www.wizeline.ai/careers", "https://jobs.lever.co/acme"] })).toEqual([
      "https://www.wizeline.ai/careers",
      "https://jobs.lever.co/acme",
    ]);
  });

  it("drops aggregators, plain http, private addresses and junk", () => {
    expect(
      parseCareersLinks({ links: ["https://es.indeed.com/viewjob?jk=1", "https://www.linkedin.com/jobs/view/1", "http://acme.com/careers", "https://10.0.0.1/x", "javascript:alert(1)", 42] }),
    ).toEqual([]);
  });

  it("stops at five links and refuses an answer without a list", () => {
    expect(parseCareersLinks({ links: Array.from({ length: 9 }, (_, i) => `https://acme${i}.com/jobs`) })).toHaveLength(5);
    expect(() => parseCareersLinks({})).toThrow(ValidationError);
  });
});
