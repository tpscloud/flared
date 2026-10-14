# REST control plane

Source: [REST API](https://developers.cloudflare.com/artifacts/api/rest-api/),
[Authentication](https://developers.cloudflare.com/artifacts/guides/authentication/),
[Data localization](https://developers.cloudflare.com/artifacts/guides/data-localization/),
[Wrangler commands](https://developers.cloudflare.com/artifacts/api/wrangler/).

## Setup

```bash
set -euo pipefail
export ACCOUNT_ID=...                 # Cloudflare account ID
export CLOUDFLARE_API_TOKEN=...       # API token with Artifacts Read and/or Artifacts Edit
export NS=default
export ACCT_URL="https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/artifacts"
export NS_URL="$ACCT_URL/namespaces/$NS"
auth=(--header "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
json=(--header "Content-Type: application/json")

# Call the API: print .result on success, or the errors on stderr and fail.
cf() {
  local resp
  if ! resp=$(curl -sS --fail-with-body "${auth[@]}" "$@"); then
    printf '%s\n' "${resp:-request failed}" >&2
    return 1
  fi
  if ! jq -e '.success == true' <<<"$resp" >/dev/null; then
    jq -c '.errors' <<<"$resp" >&2
    return 1
  fi
  jq -c '.result' <<<"$resp"
}
```

`--fail-with-body` needs curl 7.76 or later. The examples below assume this
setup and run as a script; `|| exit` stops one before anything uses a failed
result.

- **Artifacts > Read** covers read routes; **Artifacts > Edit** covers write
  routes.
- The API token authenticates REST only. Git needs a repo token. A repo token
  does not authenticate REST.
- Keep the API token in the one service that brokers access (usually a Worker,
  where the binding needs no token at all). Never ship it in a client binary.
- Responses use the Cloudflare v4 envelope
  `{ "result", "success", "errors": [{ "code", "message" }], "messages", "result_info"? }`.
  `blob`, `file` and `raw` return bytes on success and the envelope on error.

## Routes

All paths are relative to `/client/v4/accounts/$ACCOUNT_ID`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/artifacts/namespaces` | Create namespace. Body `{ "namespace", "jurisdiction"?: "eu" \| "us" }` |
| GET | `/artifacts/namespaces?limit=&cursor=` | List namespaces |
| GET | `/artifacts/namespaces/:ns` | Get namespace |
| POST | `/artifacts/namespaces/:ns/repos` | Create repo. Body `{ "name", "description"?, "default_branch"?, "read_only"? }` |
| GET | `/artifacts/namespaces/:ns/repos?limit=&cursor=&search=&sort=&direction=` | List repos. `limit` default 50, max 200. `sort`: `created_at` (default), `updated_at`, `last_push_at`, `name`. `direction`: `desc` (default) or `asc` |
| GET | `/artifacts/namespaces/:ns/repos/:name` | Get repo, including `remote` |
| DELETE | `/artifacts/namespaces/:ns/repos/:name` | Delete repo. Returns `202 Accepted` with `{ "id" }` |
| POST | `/artifacts/namespaces/:ns/repos/:name/fork` | Fork `:name`. Body `{ "name", "description"?, "read_only"?, "default_branch_only"? }`. Result adds `objects` |
| POST | `/artifacts/namespaces/:ns/repos/:name/import` | Import into the **new** repo `:name`. Body `{ "url", "branch"?, "depth"?, "read_only"? }` |
| GET | `/artifacts/namespaces/:ns/repos/:name/log?ref=&limit=&offset=` | Commit history |
| GET | `/artifacts/namespaces/:ns/repos/:name/commit/:hash` | One commit |
| GET | `/artifacts/namespaces/:ns/repos/:name/tree/:hash` | One tree |
| GET | `/artifacts/namespaces/:ns/repos/:name/blob/:hash` | Raw blob bytes |
| GET | `/artifacts/namespaces/:ns/repos/:name/file?ref=&path=` | File bytes, `application/octet-stream` |
| GET | `/artifacts/namespaces/:ns/repos/:name/raw/:ref/:path` | File bytes with a sniffed `Content-Type` |
| GET | `/artifacts/namespaces/:ns/repos/:name/tokens?state=&per_page=&page=` | List tokens. `state`: `active` (default), `expired`, `revoked`, `all`. `per_page` default 30, max 100 |
| POST | `/artifacts/namespaces/:ns/tokens` | Mint token. Body `{ "repo", "scope"?, "ttl"? }` |
| DELETE | `/artifacts/namespaces/:ns/tokens/:id` | Revoke token by id |

Note the asymmetry: tokens are **listed** under the repo path but **created
and revoked** under the namespace path.

## Examples

Create a jurisdiction-bound namespace. This is permanent: the jurisdiction
cannot be changed later. Omitting `jurisdiction` makes an unrestricted
namespace.

```bash
cf -X POST "$ACCT_URL/namespaces" "${json[@]}" \
  --data '{"namespace":"agents-eu","jurisdiction":"eu"}' >/dev/null || exit
```

Create, fork and import each return an initial write token. Keep the result
in a variable and read only the fields you need; never print it whole.

Create a repo:

```bash
res=$(cf -X POST "$NS_URL/repos" "${json[@]}" --data '{"name":"trunk","default_branch":"main"}') || exit
REMOTE=$(jq -er '.remote' <<<"$res")
```

Fork for one unit of work:

```bash
res=$(cf -X POST "$NS_URL/repos/trunk/fork" "${json[@]}" \
  --data '{"name":"trunk-agent7-s42","default_branch_only":true}') || exit
FORK_REMOTE=$(jq -er '.remote' <<<"$res")
```

Import a public repo as a baseline (private remotes fail with
`REMOTE_AUTH_REQUIRED`):

```bash
res=$(cf -X POST "$NS_URL/repos/baseline/import" "${json[@]}" \
  --data '{"url":"https://github.com/example/project","branch":"main","depth":100}') || exit
BASELINE_REMOTE=$(jq -er '.remote' <<<"$res")
```

The import can still be running when the call returns. Follow-up calls may
return `409 Conflict`; retry after a short delay.

Mint a 15-minute read token, then revoke it:

```bash
tok=$(cf -X POST "$NS_URL/tokens" "${json[@]}" \
  --data '{"repo":"trunk","scope":"read","ttl":900}') || exit
ARTIFACTS_TOKEN=$(jq -er '.plaintext' <<<"$tok")
TOKEN_ID=$(jq -er '.id' <<<"$tok")
# ...use it...
cf -X DELETE "$NS_URL/tokens/$TOKEN_ID" >/dev/null
```

`scope` defaults to `write` and `ttl` to 86,400 seconds (min 60, max
31,536,000). Always pass both.

Read without cloning:

```bash
cf "$NS_URL/repos/trunk/log?ref=main&limit=10"
curl -sS --fail-with-body "$NS_URL/repos/trunk/raw/main/README.md" "${auth[@]}"   # bytes, not JSON
```

## Response types (abridged)

```ts
// examples/cloudflare-artifacts/src/rest-types.ts
type Jurisdiction = "eu" | "us";
interface RepoInfo {
  id: string; name: string; description: string | null; default_branch: string;
  created_at: string; updated_at: string; last_push_at: string | null;
  source: string | null; read_only: boolean;
}
interface RepoWithRemote extends RepoInfo { remote: string }          // get, list
interface CreateRepoResult {                                          // create, import
  id: string; name: string; description: string | null;
  default_branch: string; remote: string; token: string;
}
interface ForkRepoResult extends CreateRepoResult { objects: number } // fork
interface CreateTokenResult { id: string; plaintext: string; scope: "read" | "write"; expires_at: string }
interface TokenInfo { id: string; scope: "read" | "write"; state: "active" | "expired" | "revoked"; created_at: string; expires_at: string }
```

REST uses snake_case (`default_branch`, `read_only`, `expires_at`); the
binding uses camelCase (`defaultBranch`, `readOnly`, `expiresAt`). Map them
explicitly in shared code.

The initial `token` from create, fork and import is a bare string with expiry
only in its `?expires=` suffix and no id, and token listings carry no
plaintext, so nothing maps one to the other. The binding's `revokeToken` takes
the plaintext directly; prefer it. Over REST, list the new repo's active
tokens before you mint any other: if exactly one is listed, that is the
initial token. If not, leave it to expire or delete the repo.

## Wrangler commands

Run these with the Wrangler version pinned in the project's `package.json`
(4.149.0 or later), not an unpinned global install.

```bash
wrangler artifacts namespaces list [--json]
wrangler artifacts namespaces get <NAME> [--json]
wrangler artifacts repos create <NAME> --namespace <NS> [--description ..] [--default-branch ..] [--read-only] [--json]
wrangler artifacts repos list --namespace <NS> [--json]
wrangler artifacts repos get <NAME> --namespace <NS> [--json]
wrangler artifacts repos delete <NAME> --namespace <NS> [--force]
wrangler artifacts repos issue-token <REPO> --namespace <NS> [--scope read|write] [--ttl <seconds>] [--json]
```

Wrangler has no namespace-create, fork, import or revoke command. Use REST or
the binding for those.
