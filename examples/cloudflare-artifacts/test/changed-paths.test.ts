import { describe, expect, it } from "vitest";
import { changedPaths } from "../src/changed-paths";
import { fakeRepo } from "./fakes";

const ZERO = "0".repeat(40);
const blob = (name: string, hash: string) => ({ name, hash, type: "blob" as const });
const dir = (name: string, hash: string) => ({ name, hash, type: "tree" as const });

const trees = {
  t1: [blob("keep.txt", "k1"), dir("lib", "l1")],
  t2: [blob("keep.txt", "k1"), dir("lib", "l2"), blob("new.txt", "n1")],
  l1: [blob("a.go", "a1")],
  l2: [blob("a.go", "a2")],
};
const commits = [{ hash: "c1", treeHash: "t1" }, { hash: "c2", treeHash: "t2" }];

describe("changedPaths", () => {
  it("lists additions and nested modifications", async () => {
    const { repo } = fakeRepo(commits, trees);
    expect(await changedPaths(repo, "c1", "c2")).toEqual([
      { path: "lib/a.go", kind: "modified" },
      { path: "new.txt", kind: "added" },
    ]);
  });

  it("treats a zero or null before as an empty tree", async () => {
    for (const before of [ZERO, null]) {
      const { repo } = fakeRepo(commits, trees);
      expect(await changedPaths(repo, before, "c1")).toEqual([
        { path: "keep.txt", kind: "added" },
        { path: "lib/a.go", kind: "added" },
      ]);
    }
  });

  it("skips tree reads when the root hashes match", async () => {
    const { repo, treeReads } = fakeRepo([...commits, { hash: "c3", treeHash: "t1" }], trees);
    expect(await changedPaths(repo, "c1", "c3")).toEqual([]);
    expect(treeReads).toEqual([]);
  });

  it("reports a file replaced by a directory", async () => {
    const { repo } = fakeRepo(
      [{ hash: "c1", treeHash: "f" }, { hash: "c2", treeHash: "d" }],
      { f: [blob("x", "x1")], d: [dir("x", "xd")], xd: [blob("y", "y1")] },
    );
    expect(await changedPaths(repo, "c1", "c2")).toEqual([
      { path: "x/y", kind: "added" },
      { path: "x", kind: "deleted" },
    ]);
  });

  it("throws instead of inventing changes when an object is missing", async () => {
    const cases: [string, Parameters<typeof fakeRepo>][] = [
      ["before commit", [[commits[1]], trees]],
      ["after commit", [[commits[0]], trees]],
      ["old root tree", [commits, { ...trees, t1: undefined! }]],
      ["new root tree", [commits, { ...trees, t2: undefined! }]],
      ["nested tree", [commits, { ...trees, l2: undefined! }]],
    ];
    for (const [what, args] of cases) {
      const { repo } = fakeRepo(...args);
      await expect(changedPaths(repo, "c1", "c2"), what).rejects.toThrow(/not found/);
    }
  });
});
