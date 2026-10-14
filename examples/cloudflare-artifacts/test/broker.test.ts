import { afterEach, describe, expect, it, vi } from "vitest";
import broker from "../src/broker";
import { dispose } from "./fakes";

afterEach(() => vi.unstubAllGlobals());

const repo = {
  ...dispose,
  async info() { return { remote: "https://x/git/agents/r.git" }; },
  async createToken(scope: string) { return { plaintext: "tok", scope, expiresAt: "later" }; },
};
const env = { ARTIFACTS: { get: async () => repo } } as unknown as Env;
const allowAll = { mayAccess: () => true, mayPush: () => false };

const call = (method: string) =>
  broker.fetch(new Request("https://broker/token?repo=r", { method }), env);

describe("broker", () => {
  it("refuses GET before authenticating", async () => {
    const authenticate = vi.fn(async () => allowAll);
    vi.stubGlobal("authenticate", authenticate);
    const res = await call("GET");
    expect(res.status).toBe(405);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("returns a read token that caches must not keep", async () => {
    vi.stubGlobal("authenticate", async () => allowAll);
    const res = await call("POST");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ token: "tok", scope: "read" });
  });

  it("rejects an unauthenticated caller", async () => {
    vi.stubGlobal("authenticate", async () => null);
    expect((await call("POST")).status).toBe(401);
  });
});
