// In-memory stand-ins for the binding, enough for the examples under test.

type Commit = Pick<ArtifactsCommitMetadata, "hash" | "treeHash">;
type Entry = Pick<ArtifactsTreeEntry, "name" | "hash" | "type">;

export function fakeRepo(commits: Commit[], trees: Record<string, Entry[]>) {
  const treeReads: string[] = [];
  const repo = {
    async readCommit(hash: string) {
      return commits.find((c) => c.hash === hash) ?? null;
    },
    async readTree(hash: string) {
      treeReads.push(hash);
      return trees[hash] ?? null;
    },
  };
  return { repo: repo as unknown as ArtifactsRepo, treeReads };
}

export function artifactsError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

export const dispose = { [Symbol.dispose]() {} };
