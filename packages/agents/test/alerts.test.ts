import { describe, expect, it } from "vitest";
import { ValidationError } from "@jobagent/core";
import { emailForPrompt, parseAlertJobs } from "../src/alerts";

const html = `<table><tr><td>
  <a href="https://cts.indeed.com/a?x=1&amp;y=2">Software Engineer</a><div>Acme Labs - Barcelona</div><div>€60,000 a year</div>
  <a href="mailto:x@indeed.com">Mail</a>
  <a href="https://www.indeed.com/unsubscribe">Unsubscribe</a>
</td></tr></table>`;

describe("emailForPrompt", () => {
  it("numbers the web links and decodes them", () => {
    const { text, links } = emailForPrompt(html);
    expect(links).toEqual(["https://cts.indeed.com/a?x=1&y=2", "https://www.indeed.com/unsubscribe"]);
    expect(text).toContain("[link 0] Software Engineer");
    expect(text).toContain("Acme Labs - Barcelona");
  });
});

describe("parseAlertJobs", () => {
  const { text, links } = emailForPrompt(html);
  const job = { title: "Software Engineer", company: "Acme Labs", location: "Barcelona", salary: "€60,000 a year", link: 0 };

  it("keeps what the email states", () => {
    expect(parseAlertJobs({ jobs: [job] }, text, links)).toEqual([{ title: "Software Engineer", company: "Acme Labs", location: "Barcelona", salary: "€60,000 a year", sourceUrl: links[0] }]);
  });

  it("drops a job the email doesn't mention, or a link it doesn't contain", () => {
    expect(parseAlertJobs({ jobs: [{ ...job, title: "Astronaut" }] }, text, links)).toEqual([]);
    expect(parseAlertJobs({ jobs: [{ ...job, company: "Globex" }] }, text, links)).toEqual([]);
    expect(parseAlertJobs({ jobs: [{ ...job, link: 9 }] }, text, links)).toEqual([]);
  });

  it("never keeps a salary or location that isn't in the email", () => {
    const [out] = parseAlertJobs({ jobs: [{ ...job, location: "Paris", salary: "€90,000" }] }, text, links);
    expect(out).toMatchObject({ location: null, salary: "not stated" });
  });

  it("rejects an answer that isn't a list", () => {
    expect(() => parseAlertJobs(null, text, links)).toThrow(ValidationError);
  });
});
