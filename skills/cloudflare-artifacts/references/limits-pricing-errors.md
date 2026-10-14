# Limits, pricing, errors and gotchas

Sources: [Limits](https://developers.cloudflare.com/artifacts/platform/limits/),
[Pricing](https://developers.cloudflare.com/artifacts/platform/pricing/),
[Errors](https://developers.cloudflare.com/artifacts/api/errors/),
[Metrics](https://developers.cloudflare.com/artifacts/observability/metrics/).
All as of October 11, 2026. Beta terms change; re-check before quoting numbers.

The skill as a whole was last checked on October 12, 2026, against the live
docs, `wrangler` 4.149.0 and `@cloudflare/workers-types` 5.20261012.1.

## Limits

| Item | Limit |
|---|---|
| Control-plane requests | 2,000 per 10 s **per namespace** |
| Git requests | 2,000 per 10 s **per repo** |
| Storage per repo | 1 GB |
| Single file or blob | 32 MB |
| Storage per account | 1 TB (can be raised on request) |
| Repos, namespaces | Unlimited |
| Namespace name | 2 to 63 characters |
| Namespace and repo names | Start with a letter or digit; then letters, digits, `.`, `_`, `-` |

Repo names are unique within a namespace, not across the account.

## Pricing

Workers Paid plan only. Not available on Workers Free. Billing for operations
and storage applies from **October 14, 2026**; check the pricing page for
changes.

| Unit | Included per month | Then |
|---|---|---|
| Operations (e.g. create, push, pull, clone; the launch post adds forks) | 10,000 | $0.15 per 1,000 |
| Storage (GB-month, average of daily peak over 30 days) | 1 GB | $0.50 per GB-month |

Replicas are not billed separately. Repos are stored, and billed, until you
delete them. The docs don't say exactly which control-plane reads (such as
`readTree`, `log` or token minting) count as operations. Measure with metrics
before you design something that polls.

Cost habits: don't create a repo per HTTP request, reuse a session's token
rather than minting one per git command, delete finished forks, and cache
object reads by hash.

## Metrics

GraphQL Analytics dataset `artifactsEventsAdaptiveGroups` (31 days of
history, filter by `accountTag`). Dimensions include `repositoryNamespace`,
`repositoryName`, `eventKind` (`action` or `error`), `eventType` and
`errorMessage`. Fields include `count` and duration quantiles.

## Error codes

The REST `errors[].code` value and the binding's `ArtifactsError.numericCode`
are the same number. The binding also exposes the string `code`.

| Code | Name | Meaning | Action |
|---|---|---|---|
| 10100 | `INVALID_INPUT` | Missing, malformed or out-of-range parameter | Fix the request |
| 10101 | `INVALID_REPO_NAME` | Name breaks the naming rules | Sanitize ids before building names |
| 10103 | `INVALID_TTL` | TTL outside 60 to 31,536,000 s | Clamp |
| 10104 | `INVALID_URL` | Import source is not a Git repo | Check the URL |
| 10106 | `REMOTE_AUTH_REQUIRED` | Import source needs auth | Only public HTTPS remotes can be imported |
| 10200 | `NOT_FOUND` | Repo or remote missing | |
| 10201 | `ALREADY_EXISTS` | Target name taken | Use unique names; treat as success only if you own the existing repo |
| 10302 | `IMPORT_IN_PROGRESS` | Import still running | Retry with backoff (REST returns `409`) |
| 10303 | `FORK_IN_PROGRESS` | Fork still running | Retry with backoff (REST returns `409`) |
| 10400 | `INTERNAL_ERROR` | Unexpected failure | Retry a bounded number of times |
| 10401 | `UPSTREAM_UNAVAILABLE` | Import source unreachable | Retry later |
| 10402 | `MEMORY_LIMIT` | Operation too large for the service | Use a smaller `depth` or read through Git |
| n/a | `CREATE_IN_PROGRESS` | Repo still being created | In the binding types only, not the errors page. Retry |

## Gotchas

- **Jurisdiction is permanent.** Creating a repo in a namespace that does not
  exist yet creates it implicitly. The docs give no way to set a jurisdiction
  on that path, and an omitted jurisdiction means unrestricted, so assume the
  implicit namespace is unrestricted. Create `eu` or `us` namespaces
  explicitly with REST before any repo goes in them.
- **The docs disagree about namespace creation.** "How Artifacts works" says
  namespaces are not provisioned separately. The REST reference, the
  Namespaces page and Data localization document
  `POST /artifacts/namespaces`. The explicit route is current.
- **The token format in the docs is stale.** Every example shows
  `art_v1_<40 hex>?expires=<unix>`. Tokens issued in October 2026 (binding
  `createToken()` and `wrangler artifacts repos issue-token`) are
  `art_v2_<letter>_<40 hex>?expires=<unix>`. Code that checks the `art_v1_`
  prefix, or redacts with an `art_v1_` pattern, misses real tokens.
- **`using` plus `return` without `await` disposes the handle early.** In
  `using repo = await artifacts.get(name); return guard(() => ...)`, the handle
  is disposed when the function returns, before the inner async code reaches its
  second call, which then fails with "RPC stub used after being disposed".
  Write `return await ...` in any function that holds a handle with `using`.
- **`list()` has no typed `status`.** The binding docs show `status` on each
  listed repo, but `@cloudflare/workers-types` has no such field, so reading it
  fails type checking. Use `get()` and its `*_IN_PROGRESS` errors for
  readiness, or validate the runtime value before you trust it.
- **`get()` returns a handle, not metadata.** The Sandbox SDK example reads
  `repo.remote` and `repo.defaultBranch` from the handle. The binding reference
  and the type declarations say to call `repo.info()`. Use `info()`.
- **Some best-practice snippets skip `using`.** Dispose handles anyway.
- **Stale launch-era examples.** The April 2026 changelog shows a REST host of
  `artifacts.cloudflare.net/v1/api/...`, a remote without `/git/`, and
  `created.repo.info()`. Current docs use `api.cloudflare.com/client/v4/...`,
  `<ACCOUNT_ID>.artifacts.cloudflare.net/git/<ns>/<repo>.git`, and a flat
  create result.
- **The launch post says the REST API can make commits.** No such route is in
  the REST reference. Plan on Git for every write.
- **Partial clone vs ArtifactFS.** The Git protocol page says `filter` is
  unsupported, yet ArtifactFS "starts with a blobless clone" and says it works
  with Artifacts remotes. Don't rely on `--filter=blob:none` until you have
  tested it against your repo.
- **Workflow trigger config.** The build-on-push guide's
  `filter.repoName` / `target.scriptName` shape fails Wrangler's schema, which
  expects `filter.repo_name` and `targets[].workflow_name` (see `events.md`).
- **Default token is write.** `createToken()` with no arguments, REST
  `/tokens` without `scope`, and the token returned by create, fork and import
  can all push.
- **REST is snake_case, the binding camelCase.** `default_branch` vs
  `defaultBranch`, `expires_at` vs `expiresAt`.
- **`log()` follows first parents only** and returns `[]` for an unknown ref
  rather than throwing.
- **`readTree` is one level.** Recurse, and stop early on equal hashes.
- **Local dev hits production** when the binding has `remote: true`.
- **Import is public HTTPS only,** and may still be running after the call
  returns.
- **Workers Builds treats only `main` as production** for Artifacts-connected
  Workers.
