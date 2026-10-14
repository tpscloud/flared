# Git access and repo tokens

Source: [Git protocol](https://developers.cloudflare.com/artifacts/api/git-protocol/),
[Authentication](https://developers.cloudflare.com/artifacts/guides/authentication/),
[Best practices](https://developers.cloudflare.com/artifacts/concepts/best-practices/).
Git behavior below was checked with git 2.55.

## Remote URL

```
https://<ACCOUNT_ID>.artifacts.cloudflare.net/git/<namespace>/<repo>.git
```

Take it from the `remote` field of a create, fork, import, get or `info()`
response. The docs say to use the exact hostname returned. Older launch-era
examples show other hosts and paths (`artifacts.cloudflare.net/<ns>/<repo>.git`,
`/git/repo-<id>.git`); don't copy those.

## Tokens

- Format: `art_v2_<letter>_<40 hex>?expires=<unix seconds>` as issued in
  October 2026; the docs still show `art_v1_<40 hex>`. Secret scanners and
  log redaction should match both, e.g.
  `art_v\d+_(?:[a-z]+_)?[0-9a-fA-F]{40}(\?expires=\d+)?`. The whole string,
  suffix included, is the Bearer value. The part before `?expires=` is the
  "secret" used in the Basic-auth URL form.
- Expiry: `expires=${ARTIFACTS_TOKEN##*expires=}`, or `expiresAt` /
  `expires_at` from the mint response.
- Scopes: `read` allows clone, fetch and pull. `write` allows those plus push.
- Scope is one repo. A token for one repo does not open another, even in the
  same namespace. A fork gets its own tokens.
- Defaults if you omit them: scope `write`, TTL 86,400 s. Range 60 s to
  31,536,000 s. Pass both every time.
- Revoke: binding `repo.revokeToken(plaintextOrId)`, REST
  (the token routes in [rest-api.md](rest-api.md)), or let it expire. Deleting a repo
  deletes its tokens.
- Wrangler: `wrangler artifacts repos issue-token <repo> --namespace <ns> --scope read --ttl 900`.

Policy that follows from Cloudflare's guidance: read tokens for cloning,
indexing and review; write tokens only for the session that must push; short
TTLs; a fresh token per agent session; never one long-lived write token shared
by every agent.

## Passing the token

Recommended, per command, nothing written to disk:

```sh
auth="http.extraHeader=Authorization: Bearer $ARTIFACTS_TOKEN"
git -c "$auth" clone "$REMOTE" work
git -C work -c "$auth" fetch origin
git -C work -c "$auth" push origin HEAD:main
```

`-c` puts the token in the process arguments, which other local users can see
with `ps`. For shared hosts or programmatic callers, pass the same setting
through the environment instead (git 2.31 or later):

```sh
GIT_CONFIG_COUNT=1 \
GIT_CONFIG_KEY_0=http.extraHeader \
GIT_CONFIG_VALUE_0="Authorization: Bearer $ARTIFACTS_TOKEN" \
GIT_TERMINAL_PROMPT=0 \
git push origin HEAD:main
```

`GIT_TERMINAL_PROMPT=0` makes an expired or wrong token fail fast instead of
waiting for a username prompt, which matters for agents.

### Several Artifacts repos in one checkout

`http.extraHeader` applies to every remote the command touches. When a
checkout has two Artifacts remotes (say a fork as `origin` and the trunk as
`trunk`), each with its own token, scope the header to the URL:

```sh
git -c "http.$TRUNK_REMOTE.extraHeader=Authorization: Bearer $TRUNK_TOKEN" fetch trunk
git -c "http.$FORK_REMOTE.extraHeader=Authorization: Bearer $FORK_TOKEN" push origin HEAD:main
```

Git matches `http.<url>.*` against the request URL, so the trunk token is never
sent to the fork. Running one remote per command also works.

### From Go

Keep git calls in one wrapper, inject the token only into that child's
environment, and scope the header to the repo's URL as in the section above:

```go
// examples/cloudflare-artifacts/go/gitx.go
// gitWithToken sends the token only to requests under remote, the repo URL
// from the create, fork, or get response, so other remotes and submodules in
// the same checkout never see it. It replaces any GIT_CONFIG_COUNT/KEY/VALUE
// already in the environment, so callers must not rely on their own
// GIT_CONFIG_* settings.
func gitWithToken(ctx context.Context, dir, remote, token string, args ...string) ([]byte, error) {
	if len(args) == 0 {
		return nil, errors.New("git: no subcommand")
	}
	u, err := url.Parse(remote)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
		return nil, fmt.Errorf("git: remote must be an https URL without credentials: %q", remote)
	}
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_CONFIG_COUNT=1",
		"GIT_CONFIG_KEY_0=http."+remote+".extraHeader",
		"GIT_CONFIG_VALUE_0=Authorization: Bearer "+token,
		"GIT_TERMINAL_PROMPT=0",
	)
	out, err := cmd.CombinedOutput()
	// git does not echo extraHeader values, but scrub anyway before the output
	// reaches a caller or a log line.
	out = bytes.ReplaceAll(out, []byte(token), []byte("***"))
	if err != nil {
		return nil, fmt.Errorf("git %s: %w: %s", args[0], err, out)
	}
	return out, nil
}
```

If the environment already sets `GIT_CONFIG_COUNT`, merge the indices instead of
overwriting them.

### URL form (only for short-lived, self-contained commands)

```sh
secret="${ARTIFACTS_TOKEN%%\?expires=*}"
git push "https://x:${secret}@${REMOTE#https://}" HEAD:main
```

The username is ignored; any non-empty value works. Never `git remote add` or
`git clone` with this URL in a working copy you keep: git stores the clone URL
in `.git/config`. The Sandbox SDK and ArtifactFS examples use this form
because they pass a remote string into another process; keep the TTL short
when you do the same.

### Inside a Worker (isomorphic-git)

`isomorphic-git` takes credentials from `onAuth`. Use the secret part as the
password, as Cloudflare's example does:

```ts
// excerpt: the isomorphic-git onAuth option
onAuth: () => ({ username: "x", password: token.split("?expires=")[0] })
```

## Protocol support

| Operation | Support |
|---|---|
| Clone, fetch (`git-upload-pack`) | Protocol v1 and v2. v2 supports `ls-refs` and `fetch`. |
| Shallow clone and deepen | Supported (`--depth`, `--deepen`, `--shallow-since`). |
| Push (`git-receive-pack`) | Protocol v1 only. v2 receive-pack is not supported. Stock `git push` works. |
| Partial clone (`filter`, e.g. `--filter=blob:none`) | Not supported. Use `--depth` or `readFile` instead. |
| `include-tag` | Not supported. If annotated tags are missing after a fetch, fetch them explicitly (`git fetch origin 'refs/tags/*:refs/tags/*'`). |

## Git notes

Cloudflare recommends git notes for harness metadata (prompts, model output,
run ids) so it stays out of the tree. The launch post says notes are supported
natively. Notes live on their own refs and are not pushed or fetched by
default:

```sh
git notes --ref=agent add -m '{"run":"r-42","prompt":"..."}' HEAD
git -c http.extraHeader="Authorization: Bearer $ARTIFACTS_TOKEN" push origin 'refs/notes/*'
git -c http.extraHeader="Authorization: Bearer $ARTIFACTS_TOKEN" fetch origin 'refs/notes/*:refs/notes/*'
```

The Git protocol page does not mention notes. Push and read back one note
against your account before you build on them.

## Common failures

| Symptom | Likely cause |
|---|---|
| Push rejected with an auth error, clone works | Token scope is `read`. Mint a `write` token. |
| Every request fails with an auth error | Token expired (check `?expires=`), revoked, minted for a different repo, or a Cloudflare API token was used instead of a repo token. |
| Git prompts for a username | No header reached the request. Check the `-c` placement (before the subcommand) or URL scoping. Set `GIT_TERMINAL_PROMPT=0`. |
| `--filter` clone fails or falls back | Partial clone is unsupported. |
| `! [rejected] ... (fetch first)` | Someone else pushed the same ref. Fetch, rebase or merge, push again, or move to repo-per-agent. |
| Push fails on a very large file | 32 MB per-file limit; 1 GB per repo. |
