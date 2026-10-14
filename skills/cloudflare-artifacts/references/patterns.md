# Patterns for what the API does not do

Artifacts gives you repos, objects, tokens and events. It has **no diff, no
merge, no commit-write and no ref-update API**, and Workers cannot run `git`.
The REST and binding read routes are read-only. Anything that creates commits
or moves refs goes through the Git protocol.

Where code can run Git:

| Runtime | How | Use when |
|---|---|---|
| A CLI, server or CI runner with `git` | Shell out to `git` with a per-command token | Agents on developer machines, Go or Python services. Full Git, including merge, rebase and notes. |
| Sandbox SDK or Containers | Real `git` inside a container started from a Worker | Agents that run code on Cloudflare. Cloudflare has a [Sandbox SDK example](https://developers.cloudflare.com/artifacts/examples/sandbox-sdk-artifacts/). |
| `isomorphic-git` inside a Worker | Pure-JS git with an in-memory filesystem | Small generated commits from a Worker. Cloudflare has an [isomorphic-git example](https://developers.cloudflare.com/artifacts/examples/isomorphic-git/). Workers memory limits apply, so keep repos small. |
| ArtifactFS | FUSE mount that hydrates files lazily | Large repos where clone time dominates sandbox start. Commits and pushes still use `git`. [Guide](https://developers.cloudflare.com/artifacts/guides/artifact-fs/). |

## Repo per unit of work

Cloudflare's recommended layout:

1. Keep a reviewed **baseline** (or trunk) repo, often imported from an
   existing public remote, optionally `read_only`.
2. For each agent session, **fork** the baseline into a uniquely named repo,
   e.g. `${agent}-${session}`. Names are unique per namespace; include stable
   ids to avoid collisions and to make cleanup easy.
3. Mint a short-lived **write** token for that fork only, and a **read** token
   for the baseline if the agent needs to rebase.
4. The agent clones, commits and pushes to its fork. It never holds a token
   that can push to the baseline.
5. A trusted integrator (a service, CI job or person) decides what lands on
   the baseline and does the merge in a Git client.
6. Delete or archive the fork when done. Repos stay stored, and billed, until
   deleted.

Use branches in one repo only when collaborators share a lifecycle. Do not use
one shared repo as a queue for many autonomous agents. Concurrent pushes to the
same ref are rejected as non-fast-forward, and the retries grow quickly with the
number of agents.

Split namespaces by environment, tenant or traffic class (`staging`, `prod`,
`agents-batch`, `agents-realtime`) once one namespace gets busy. The
control-plane rate limit is per namespace.

## Diff without a diff API

**In a Git client** (simplest): in a clone of the trunk, fetch the fork and
run `git diff`.

```sh
git -c "http.$FORK.extraHeader=Authorization: Bearer $FORK_READ" fetch "$FORK" main:refs/remotes/fork/main
git diff --name-status origin/main...fork/main
```

**Inside a Worker** (no clone): walk two trees with `readTree` and compare
entry hashes. Identical subtree hashes mean identical contents, so you only
descend where they differ.

```ts
// examples/cloudflare-artifacts/src/changed-paths.ts
type Change = { path: string; kind: "added" | "deleted" | "modified" };

// Git's all-zero hash: `before` of a created ref, `after` of a deleted one.
const isZeroHash = (h: string | null) => !h || /^0{40}$/.test(h);

async function changedPaths(repo: ArtifactsRepo, fromCommit: string | null, toCommit: string): Promise<Change[]> {
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
```

Each `readTree` call is a request against the repo, and possibly a billed
operation. Cap the depth or entry count for untrusted pushes, and cache results
by tree hash, since tree hashes are immutable. For line-level diffs, read both
blobs and diff them in JS, or leave it to a Git client.

A path-level diff like this is enough to classify a change by area, to detect
overlap between agents' forks, or to route a push to review.

## Changed files for a push event

`cf.artifacts.repo.pushed` carries `ref`, `before`, `after` and a `commits`
array that may be truncated, but no file list. Use `changedPaths(repo, before, after)`
from above. A newly created ref may have an all-zero `before`; the helper
treats that as an empty tree. Any other hash it cannot read throws, so the
queue retries rather than reporting files that did not change. Alternatively, have your client send its own
`git diff --name-only` with its request. Treat that as a claim to check, not a
fact.

## Merge without a merge API

Merges happen in a Git client that can read both repos and push to the target:

```sh
git -c "http.$TRUNK.extraHeader=Authorization: Bearer $TRUNK_WRITE" clone "$TRUNK" integrate
cd integrate
git -c "http.$FORK.extraHeader=Authorization: Bearer $FORK_READ" fetch "$FORK" main:refs/remotes/fork/main
git merge --no-ff fork/main -m "Merge agent-7 session 42"   # or rebase, or cherry-pick
git -c "http.$TRUNK.extraHeader=Authorization: Bearer $TRUNK_WRITE" push origin HEAD:main
```

If the push is rejected because the trunk moved, fetch, redo the merge and push
again, with a bounded retry. Serialize integrations per target repo (a queue, a
Durable Object lock, or a single integrator) to avoid that race.

Fast-forward-only landing is the same flow with `git merge --ff-only`; refuse
and ask the agent to rebase when it fails.

## Writing commits from a Worker

Use `isomorphic-git` with an in-memory filesystem. Outline:

1. `git.init({ fs, dir, defaultBranch: "main" })`, or `git.clone` with
   `singleBranch: true, depth: 1` when you need existing content.
2. Write files into the memory FS, `git.add`, `git.commit` with an explicit
   author.
3. `git.push({ fs, http, dir, url: remote, ref: "main", onAuth })`, with
   `http` from `isomorphic-git/http/web` and `onAuth` returning
   `{ username: "x", password: tokenSecret }`.

Mint the write token in the same request and give it a short TTL. Don't return
it to the caller.

## Handing off a session

To give someone else an agent's work in progress, fork the agent's repo (a
fork can be taken at any point) and give them the new remote plus a fresh
token. Metadata such as the goal, prompts or decisions can travel with it as
git notes on `refs/notes/*`, provided the fork includes those refs. Fork with
`defaultBranchOnly: false` and confirm the notes arrived, since the docs don't
say whether forks copy non-branch refs.
