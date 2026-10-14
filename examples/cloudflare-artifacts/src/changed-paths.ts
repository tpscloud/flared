// List paths changed between two commits by walking both trees, since the
// binding has no diff API. Unchanged subtrees share a hash and are skipped.

export type Change = { path: string; kind: "added" | "deleted" | "modified" };

// Git's all-zero hash: `before` of a created ref, `after` of a deleted one.
export const isZeroHash = (h: string | null) => !h || /^0{40}$/.test(h);

export async function changedPaths(repo: ArtifactsRepo, fromCommit: string | null, toCommit: string): Promise<Change[]> {
  const to = await mustReadCommit(repo, toCommit);
  // Only an absent side is empty. A hash that cannot be read is an error, not a tree.
  const from = isZeroHash(fromCommit) ? null : await mustReadCommit(repo, fromCommit!);
  const out: Change[] = [];
  await walk(repo, from?.treeHash ?? null, to.treeHash, "", out);
  return out;
}

async function mustReadCommit(repo: ArtifactsRepo, hash: string) {
  const c = await repo.readCommit(hash);
  if (!c) throw new Error("commit not found: " + hash);
  return c;
}

async function mustReadTree(repo: ArtifactsRepo, hash: string | null) {
  if (!hash) return [];
  const t = await repo.readTree(hash);
  if (!t) throw new Error("tree not found: " + hash);
  return t;
}

async function walk(repo: ArtifactsRepo, a: string | null, b: string | null, prefix: string, out: Change[]) {
  if (a === b) return;
  const left = new Map((await mustReadTree(repo, a)).map((e) => [e.name, e]));
  const right = new Map((await mustReadTree(repo, b)).map((e) => [e.name, e]));
  for (const name of new Set([...left.keys(), ...right.keys()])) {
    const l = left.get(name), r = right.get(name), path = prefix + name;
    if (l?.hash === r?.hash && l?.type === r?.type) continue;
    const lDir = l?.type === "tree", rDir = r?.type === "tree";
    if (lDir || rDir) {
      await walk(repo, lDir ? l!.hash : null, rDir ? r!.hash : null, path + "/", out);
      if (l && !lDir) out.push({ path, kind: "deleted" });
      if (r && !rDir) out.push({ path, kind: "added" });
    } else {
      out.push({ path, kind: !l ? "added" : !r ? "deleted" : "modified" });
    }
  }
}
