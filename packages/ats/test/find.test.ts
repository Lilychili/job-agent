import { afterEach, describe, expect, it, vi } from "vitest";
import { boardFromUrl, boardGuesses, boardHomeUrl, findBoard, followRedirects, isPublicHttps, linkedInJobUrl } from "../src/index";

afterEach(() => vi.unstubAllGlobals());

describe("linkedInJobUrl", () => {
  it("keeps the job and drops what the email added", () => {
    expect(linkedInJobUrl("https://www.linkedin.com/comm/jobs/view/123456/?trackingId=x&otpToken=secret")).toBe("https://www.linkedin.com/jobs/view/123456/");
    expect(linkedInJobUrl("https://es.linkedin.com/jobs/view/software-engineer-at-acme-123456?trk=1")).toBe("https://www.linkedin.com/jobs/view/123456/");
    expect(linkedInJobUrl("https://www.linkedin.com/comm/jobs/search?otpToken=secret")).toBe("https://www.linkedin.com/comm/jobs/search");
  });
});

/** Only the listed URL prefixes exist; anything else is a 404. */
function stub(boards: Record<string, unknown>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    const hit = Object.entries(boards).find(([prefix]) => url.startsWith(prefix));
    return new Response(JSON.stringify(hit?.[1] ?? {}), { status: hit ? 200 : 404 });
  });
  return calls;
}

const greenhouseJobs = (company: string) => ({ jobs: [{ title: "Engineer", absolute_url: "https://job-boards.greenhouse.io/x/jobs/1", company_name: company, content: "" }] });

describe("boardFromUrl", () => {
  it("reads the board out of the three ATS link shapes", () => {
    expect(boardFromUrl("https://boards.greenhouse.io/acme/jobs/123")).toEqual({ ats: "greenhouse", boardToken: "acme" });
    expect(boardFromUrl("https://job-boards.eu.greenhouse.io/acme")).toEqual({ ats: "greenhouse", boardToken: "acme" });
    expect(boardFromUrl("https://boards.greenhouse.io/embed/job_board?for=acme")).toEqual({ ats: "greenhouse", boardToken: "acme" });
    expect(boardFromUrl("https://jobs.lever.co/acme-labs/abc")).toEqual({ ats: "lever", boardToken: "acme-labs" });
    expect(boardFromUrl("https://jobs.ashbyhq.com/acme")).toEqual({ ats: "ashby", boardToken: "acme" });
  });

  it("ignores everything else", () => {
    expect(boardFromUrl("https://acme.com/careers")).toBeNull();
    expect(boardFromUrl("https://evilgreenhouse.io/acme")).toBeNull();
    expect(boardFromUrl("not a url")).toBeNull();
  });
});

describe("boardGuesses", () => {
  it("tries the joined and hyphenated name without the legal suffix", () => {
    expect(boardGuesses("Acme Labs GmbH")).toEqual(["acmelabs", "acme-labs"]);
    expect(boardGuesses("Qonto")).toEqual(["qonto"]);
    expect(boardGuesses("Rover.com")).toEqual(["rover"]);
    expect(boardGuesses("Société Générale")).toEqual(["societegenerale", "societe-generale"]);
  });
});

describe("findBoard", () => {
  it("trusts a board link Claude saw", async () => {
    stub({ "https://api.lever.co/v0/postings/acme?": [{ text: "Engineer", hostedUrl: "https://jobs.lever.co/acme/1" }] });
    const hit = await findBoard("Acme", ["https://jobs.lever.co/acme"]);
    expect(hit).toMatchObject({ outcome: "found", board: { ats: "lever", boardToken: "acme" } });
  });

  it("falls back to guessing the board name", async () => {
    stub({ "https://api.ashbyhq.com/posting-api/job-board/acmelabs": { jobs: [] }, "https://boards-api.greenhouse.io/v1/boards/acmelabs/": greenhouseJobs("Acme Labs") });
    const hit = await findBoard("Acme Labs GmbH", ["https://acme.com/careers"]);
    expect(hit).toMatchObject({ outcome: "found", board: { ats: "greenhouse", boardToken: "acmelabs" } });
  });

  it("rejects a guessed Greenhouse board that belongs to another company", async () => {
    stub({ "https://boards-api.greenhouse.io/v1/boards/acme/": greenhouseJobs("Totally Different Inc") });
    expect(await findBoard("Acme", [])).toEqual({ outcome: "none" });
  });

  it("rejects a linked board that belongs to another company", async () => {
    stub({ "https://boards-api.greenhouse.io/v1/boards/evil/": greenhouseJobs("Evil Corp") });
    expect(await findBoard("Acme", ["https://boards.greenhouse.io/evil"])).toEqual({ outcome: "none" });
  });

  it("doesn't claim there's no board when one failed to answer", async () => {
    vi.stubGlobal("fetch", async (url: string) => new Response("{}", { status: url.includes("lever") ? 429 : 404 }));
    expect(await findBoard("Acme", [])).toEqual({ outcome: "unknown" });
  });

  it("returns null when no board answers", async () => {
    stub({});
    expect(await findBoard("Nobody", [])).toEqual({ outcome: "none" });
  });
});

describe("followRedirects", () => {
  const hops = (routes: Record<string, string | number>) =>
    vi.stubGlobal("fetch", async (url: URL) => {
      const to = routes[url.toString()];
      return typeof to === "string" ? new Response(null, { status: 302, headers: { location: to } }) : new Response(null, { status: to ?? 200 });
    });

  it("ends where the tracking link ends", async () => {
    hops({ "https://cts.indeed.com/a": "https://www.indeed.com/rc/clk?jk=1", "https://www.indeed.com/rc/clk?jk=1": "https://jobs.lever.co/acme/1" });
    expect(await followRedirects("https://cts.indeed.com/a")).toBe("https://jobs.lever.co/acme/1");
  });

  it("keeps the last address when a site blocks us", async () => {
    hops({ "https://cts.indeed.com/a": "https://www.indeed.com/viewjob?jk=1", "https://www.indeed.com/viewjob?jk=1": 403 });
    expect(await followRedirects("https://cts.indeed.com/a")).toBe("https://www.indeed.com/viewjob?jk=1");
  });

  it("won't follow a link into this machine or its network", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: URL) => (seen.push(url.toString()), new Response(null, { status: 200 })));
    expect(await followRedirects("https://192.168.1.1/admin")).toBe("https://192.168.1.1/admin");
    expect(await followRedirects("http://example.com/")).toBe("http://example.com/");
    expect(seen).toEqual([]);
  });
});

describe("boardHomeUrl", () => {
  it("gives the public page of a board", () => {
    expect(boardHomeUrl({ ats: "lever", boardToken: "acme" })).toBe("https://jobs.lever.co/acme");
  });
});

describe("isPublicHttps", () => {
  it("allows only https on a public name", () => {
    expect(isPublicHttps("https://www.wizeline.ai/careers")).toBe(true);
    expect(isPublicHttps("http://www.wizeline.ai/careers")).toBe(false);
    expect(isPublicHttps("https://intranet/x")).toBe(false);
    expect(isPublicHttps("not a link")).toBe(false);
  });

  it("refuses this machine and private networks, however they are spelled", () => {
    for (const link of [
      "https://localhost/x",
      "https://localhost./x",
      "https://app.localhost/x",
      "https://printer.local/x",
      "https://db.internal/x",
      "https://router.home.arpa/x",
      "https://192.168.1.1/x",
      "https://2130706433/x",
      "https://[::1]/x",
    ]) {
      expect(isPublicHttps(link), link).toBe(false);
    }
  });
});
