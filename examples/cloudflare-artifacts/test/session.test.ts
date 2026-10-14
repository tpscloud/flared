import { afterEach, describe, expect, it, vi } from "vitest";
import { getWhenReady, repoName, startSession } from "../src/session";
import { artifactsError, dispose } from "./fakes";

const validName = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

afterEach(() => vi.unstubAllGlobals());

describe("repoName", () => {
  it("gives pairs that join to the same string different names", async () => {
    expect(await repoName("alpha-beta", "gamma")).not.toBe(await repoName("alpha", "beta-gamma"));
  });

  it("is valid and stable for any input", async () => {
    for (const [a, s] of [["--", "!!"], ["", ""], ["ägent", "セッション"], ["a/b", "../c"]]) {
      const name = await repoName(a, s);
      expect(name).toMatch(validName);
      expect(await repoName(a, s)).toBe(name);
    }
  });
});

function fakeEnv(opts: { getFails?: string[]; createTokenFails?: boolean }) {
  const failures = [...(opts.getFails ?? [])];
  const calls = { revoked: [] as string[], deleted: [] as string[], forkedAs: "" };
  const fork = { name: "", remote: "https://x/git/agents/f.git", defaultBranch: "main", token: "initial" };
  const repo = {
    ...dispose,
    async revokeToken(t: string) { calls.revoked.push(t); return true; },
    async createToken() {
      if (opts.createTokenFails) throw artifactsError("INTERNAL_ERROR");
      return { plaintext: "short", expiresAt: "later" };
    },
  };
  const base = { ...dispose, async fork(name: string) { calls.forkedAs = fork.name = name; return fork; } };
  const ARTIFACTS = {
    async get(name: string) {
      if (name === "baseline") return base;
      const code = failures.shift();
      if (code) throw artifactsError(code);
      return repo;
    },
    async delete(name: string) { calls.deleted.push(name); return true; },
  };
  return { env: { ARTIFACTS } as unknown as Env, calls };
}

describe("startSession", () => {
  it("revokes the initial token and returns a short-lived one", async () => {
    vi.stubGlobal("scheduler", { wait: async () => {} });
    const { env, calls } = fakeEnv({ getFails: ["FORK_IN_PROGRESS"] });
    const s = await startSession(env, "agent7", "s42");
    expect(s.token).toBe("short");
    expect(calls.revoked).toEqual(["initial"]);
    expect(calls.forkedAs).toBe(await repoName("agent7", "s42"));
    expect(calls.deleted).toEqual([]);
  });

  it("deletes the fork when a later step fails", async () => {
    const { env, calls } = fakeEnv({ createTokenFails: true });
    await expect(startSession(env, "agent7", "s42")).rejects.toThrow("INTERNAL_ERROR");
    expect(calls.deleted).toEqual([calls.forkedAs]);
  });
});

describe("getWhenReady", () => {
  it("retries only *_IN_PROGRESS, with backoff", async () => {
    const waits: number[] = [];
    vi.stubGlobal("scheduler", { wait: async (ms: number) => { waits.push(ms); } });
    const { env } = fakeEnv({ getFails: ["IMPORT_IN_PROGRESS", "FORK_IN_PROGRESS"] });
    await getWhenReady(env, "r");
    expect(waits).toEqual([250, 500]);

    const other = fakeEnv({ getFails: ["NOT_FOUND"] });
    await expect(getWhenReady(other.env, "r")).rejects.toThrow("NOT_FOUND");
  });
});
