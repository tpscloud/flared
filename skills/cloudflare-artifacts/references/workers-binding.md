# Workers binding

Source: [Workers binding](https://developers.cloudflare.com/artifacts/api/workers-binding/)
and the `Artifacts` declarations in `@cloudflare/workers-types` 5.20261012.1.
Regenerate types with `wrangler types` and trust the generated
`worker-configuration.d.ts` over this file when they differ.

## Configuration

Requires Wrangler 4.145.0 or later for the generated `Artifacts` type and for
Blob-returning methods on a remote binding in local development.

```jsonc
// wrangler.jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "repo-broker",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-11",
  "artifacts": [
    { "binding": "ARTIFACTS", "namespace": "agents" },
    // One binding per namespace. This EU-only one also sets remote: true, so
    // wrangler dev uses the real service for it (see below):
    { "binding": "ARTIFACTS_EU", "namespace": "agents-eu", "remote": true }
  ]
}
```

- `binding` and `namespace` are required. The schema allows no other keys
  except `remote`.
- `remote: true` makes `wrangler dev` call the real Artifacts service. That
  touches real repos and, once billing starts, costs operations.
- The binding cannot create a namespace or set a jurisdiction. Create the
  namespace through REST first if it needs one (see `rest-api.md`).
- Like other bindings, set `artifacts` in every named Wrangler environment
  that needs it.

```ts
// examples/cloudflare-artifacts/src/env.d.ts
interface Env {
  ARTIFACTS: Artifacts;
}
```

## Namespace methods (`env.ARTIFACTS`)

| Method | Returns | Notes |
|---|---|---|
| `create(name, { readOnly?, description?, setDefaultBranch? })` | `ArtifactsCreateRepoResult` | Includes an initial `token` string. Throws `ALREADY_EXISTS`, `INVALID_REPO_NAME`. |
| `get(name)` | `ArtifactsRepo` (disposable RPC stub) | Throws `NOT_FOUND`, `CREATE_IN_PROGRESS`, `IMPORT_IN_PROGRESS`, `FORK_IN_PROGRESS`. |
| `list({ limit?, cursor? })` | `{ repos, total, cursor? }` | `limit` 1 to 200, default 50. Listed repos omit `remote`. The docs also show a `status` (`ready`, `importing`, `forking`), but the types don't have it; check readiness with `get()`. |
| `import({ source: { url, branch?, depth? }, target: { name, opts?: { description?, readOnly? } } })` | `ArtifactsCreateRepoResult` | Public HTTPS remotes only. Throws `INVALID_URL`, `REMOTE_AUTH_REQUIRED`, `UPSTREAM_UNAVAILABLE`, `MEMORY_LIMIT`. |
| `delete(name)` | `boolean` | `false` if not found. Deletes the repo's tokens too. Irreversible. |

## Repo handle methods (`using repo = await env.ARTIFACTS.get(name)`)

| Method | Returns | Notes |
|---|---|---|
| `info()` | `ArtifactsRepoInfo` | Fresh lookup each call. Metadata is not exposed as properties on the handle. |
| `createToken(scope?, ttl?)` | `{ id, plaintext, scope, expiresAt }` | Scope defaults to `"write"`. TTL in seconds, default 86,400, range 60 to 31,536,000 (`INVALID_TTL`). |
| `listTokens()` | `{ tokens: { id, scope, state, createdAt, expiresAt }[], total }` | No plaintext. |
| `revokeToken(tokenOrId)` | `boolean` | Accepts the plaintext token or its id. `false` if not found. |
| `fork(name, { description?, readOnly?, defaultBranchOnly? })` | `ArtifactsCreateRepoResult` | `defaultBranchOnly` defaults to `true` per the type docs. New repo, new token. |
| `log({ ref?, limit?, offset? })` | `ArtifactsCommitMetadata[]` | First-parent chain, newest first. `ref` defaults to `HEAD`, `limit` 50 (max 1000). Unresolvable ref returns `[]`. |
| `readCommit(hash)` | `ArtifactsCommitMetadata \| null` | |
| `readTree(hash)` | `ArtifactsTreeEntry[] \| null` | Immediate children only. Recurse yourself. |
| `readBlob(hash)` | `Blob \| null` | Untyped (`blob.type` is empty). Lowercase 40-hex SHA-1. |
| `readFile({ ref, path })` | `Blob \| null` | MIME-typed. `null` for a missing path or a directory. Throws `INVALID_INPUT` on empty args. |

Read methods can also throw `MEMORY_LIMIT` for objects too large to buffer.

### Result shapes

```ts
// examples/cloudflare-artifacts/src/binding-types.ts
interface ArtifactsCreateRepoResult {
  id: string; name: string; description: string | null;
  defaultBranch: string; remote: string;
  token: string; // "art_v2_<letter>_<40 hex>?expires=<unix>", only returned here
}
interface ArtifactsRepoInfo {
  id: string; name: string; description: string | null; defaultBranch: string;
  createdAt: string; updatedAt: string; lastPushAt: string | null;
  source: string | null; // e.g. "github:owner/repo" or "artifacts:ns/repo" for forks and imports
  readOnly: boolean; remote: string;
}
interface ArtifactsCommitMetadata {
  hash: string; treeHash: string; message: string;
  author: { name: string; email: string };
  committer: { name: string; email: string };
  parents: string[]; authoredAt: number; committedAt: number; // unix seconds
}
interface ArtifactsTreeEntry {
  name: string; mode: string; hash: string;
  type: "tree" | "blob" | "symlink" | "gitlink" | "exec";
}
```

Errors are `ArtifactsError` with a string `code` and a `numericCode` that
matches the REST `errors[].code` values (see `limits-pricing-errors.md`).

## Example: a token broker route

The Worker decides who gets which token. Authenticate the caller first; the
docs' examples omit this on purpose and so does nothing in the platform.

```ts
// examples/cloudflare-artifacts/src/broker.ts
const noStore = { "cache-control": "no-store" };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // POST only, so no link, prefetch or cache can mint a token.
    if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: { allow: "POST" } });
    const caller = await authenticate(request, env); // your auth; reject otherwise
    if (!caller) return new Response("unauthorized", { status: 401 });

    const url = new URL(request.url);
    const name = url.searchParams.get("repo");
    if (!name || !caller.mayAccess(name)) return new Response("forbidden", { status: 403 });

    const scope = caller.mayPush(name) ? "write" : "read";
    try {
      using repo = await env.ARTIFACTS.get(name);
      const { remote } = await repo.info();
      const t = await repo.createToken(scope, 900);
      return Response.json({ remote, token: t.plaintext, scope: t.scope, expiresAt: t.expiresAt }, { headers: noStore });
    } catch (err) {
      const code = (err as Partial<ArtifactsError>).code;
      if (code === "NOT_FOUND") return new Response("no such repo", { status: 404 });
      if (code?.endsWith("_IN_PROGRESS")) return new Response("not ready", { status: 409, headers: { "retry-after": "2" } });
      throw err;
    }
  },
} satisfies ExportedHandler<Env>;
```

## Example: read a file without cloning

```ts
// examples/cloudflare-artifacts/src/read-config.ts
async function readConfig(env: Env, name: string, ref = "main") {
  using repo = await env.ARTIFACTS.get(name);
  const file = await repo.readFile({ ref, path: ".app/config.json" });
  return file ? JSON.parse(await file.text()) : null;
}
```

## `using` and toolchains

The docs use `using` (explicit resource management) so the stub is released
before the request ends. If your TypeScript or bundler setup rejects it, call
`repo[Symbol.dispose]()` in a `finally` block instead. Do not keep handles in
module scope across requests.
