import { afterEach, describe, expect, it, vi } from "vitest";
import consumer from "../src/consumer";

afterEach(() => vi.unstubAllGlobals());

const env = {} as Env;
const source = { type: "artifacts.repo", namespace: "agents", repoName: "work" };

function message(id: string, ref: string, before: string, after: string) {
  const body = { type: "cf.artifacts.repo.pushed", source, payload: { ref, before, after, commits: [] } };
  return { id, body, ack: vi.fn(), retry: vi.fn() };
}

async function deliver(...messages: ReturnType<typeof message>[]) {
  await consumer.queue({ messages } as unknown as MessageBatch<never>, env);
}

describe("consumer", () => {
  it("passes each message id, so pushes to the same after stay distinct", async () => {
    const onPush = vi.fn(async (..._args: unknown[]) => {});
    vi.stubGlobal("onPush", onPush);
    const a = message("m1", "refs/heads/main", "A", "C");
    const b = message("m2", "refs/heads/main", "B", "C");
    await deliver(a, b);
    expect(onPush.mock.calls.map((c) => c[1])).toEqual(["m1", "m2"]);
    expect(a.ack).toHaveBeenCalled();
    expect(b.ack).toHaveBeenCalled();
  });

  it("acks branch deletions and tags without calling the handler", async () => {
    const onPush = vi.fn(async (..._args: unknown[]) => {});
    vi.stubGlobal("onPush", onPush);
    const deleted = message("m1", "refs/heads/old", "A", "0".repeat(40));
    const tag = message("m2", "refs/tags/v1", "0".repeat(40), "T");
    await deliver(deleted, tag);
    expect(onPush).not.toHaveBeenCalled();
    expect(deleted.ack).toHaveBeenCalled();
    expect(tag.ack).toHaveBeenCalled();
  });

  it("retries a message whose handler fails", async () => {
    vi.stubGlobal("onPush", async () => { throw new Error("commit not found: A"); });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const m = message("m1", "refs/heads/main", "A", "C");
    await deliver(m);
    expect(m.retry).toHaveBeenCalled();
    expect(m.ack).not.toHaveBeenCalled();
  });
});
