# flared

[![version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ftpscloud%2Fflared%2Fmain%2F.tessl-plugin%2Fplugin.json&query=%24.version&label=version&prefix=v)](https://tessl.io/registry/tpscloud/flared)
[![Skill quality](https://github.com/tpscloud/flared/actions/workflows/skill-quality.yml/badge.svg)](https://github.com/tpscloud/flared/actions/workflows/skill-quality.yml)
[![skills.sh](https://www.skills.sh/b/tpscloud/flared?label=skills.sh)](https://www.skills.sh/tpscloud/flared)
[![tessl](https://img.shields.io/endpoint?url=https%3A%2F%2Fapi.tessl.io%2Fv1%2Fbadges%2Ftpscloud%2Fflared)](https://tessl.io/registry/tpscloud/flared)

Skills for AI coding agents that build on Cloudflare. Each skill is written
from the live documentation and the shipped type declarations. Every
TypeScript and Go block is trimmed from an example that type-checks and
passes its tests in CI against pinned versions, and the binding types a skill
quotes are checked against the pinned `@cloudflare/workers-types`. The REST
shell setup is tested against a fake `curl`; other shell and Wrangler config
snippets are checked by hand.

> [!NOTE]
> This is an early version of the skill. Cloudflare Artifacts is in beta and
> changes quickly. As CI gains more measures of how well each skill works, the
> results go into
> [SECURITY.md](https://github.com/tpscloud/flared/blob/main/SECURITY.md)
> alongside the security and quality reports.

## Skills

These are third-party skills and are not affiliated with Cloudflare.
[SECURITY.md](https://github.com/tpscloud/flared/blob/main/SECURITY.md) has the
independent security and quality reports.

**[cloudflare-artifacts](https://github.com/tpscloud/flared/blob/main/skills/cloudflare-artifacts/SKILL.md)**:
<a href="https://developers.cloudflare.com/artifacts/" target="_blank" rel="noopener noreferrer">Artifacts</a>,
Cloudflare's Git-compatible storage for agents. Create, fork, and import repos;
mint short-lived, scoped repo tokens; use plain `git` against Artifacts remotes
without leaking tokens; consume push events; and work around the missing diff,
merge, and commit-write APIs.

## Install

Install with Vercel's <a href="https://skills.sh" target="_blank" rel="noopener noreferrer">skills CLI</a>:

```sh
npx skills add tpscloud/flared
```

> [!NOTE]
> This is the recommended route. One command installs into Claude Code, Codex,
> and dozens of other agents from one shared copy, either per project (committed
> with your code) or for your user. It needs no clone, and `npx skills update`
> pulls new versions later.

It asks which skills and agents to install. Add `--skill cloudflare-artifacts`
to pick a skill, `-a claude-code` or `-a codex` to pick an agent, and `-g` to
install for your user instead of the current project. `--list` shows the
skills without installing.

### From a checkout

The skills also load straight from a clone of this repository. Replace
`/path/to/flared` with its absolute path.

Claude Code, as a plugin for one session (skills are then named
`/flared:cloudflare-artifacts`):

```sh
claude --plugin-dir /path/to/flared
```

Claude Code or Codex, as personal skills that stay installed:

```sh
# Claude Code
mkdir -p "$HOME/.claude/skills"
ln -s /path/to/flared/skills/* "$HOME/.claude/skills/"

# Codex
mkdir -p "$HOME/.agents/skills"
ln -s /path/to/flared/skills/* "$HOME/.agents/skills/"
```

Start a new session afterwards. Symlinked skills follow the checkout, so keep
it in place.

### Examples

The code the skills cite lives in `examples/<skill>/`: a TypeScript project
type-checked against a pinned `@cloudflare/workers-types` and tested with
vitest, plus a Go module where a skill shows Go. Run
`npm ci && npx tsc -p . && npx vitest run` or `go test ./...` there.

## Development

[AGENTS.md](https://github.com/tpscloud/flared/blob/main/AGENTS.md) has the
editing rules. CI uses
<a href="https://github.com/tpscloud/skillforge-ci" target="_blank" rel="noopener noreferrer">Skillforge</a>;
run `skillforge validate .` and `skillforge check .` before committing.

## License

MIT. See [LICENSE](https://github.com/tpscloud/flared/blob/main/LICENSE). Each
skill directory carries the same text in `LICENSES/MIT.txt` and a `NOTICE.md`,
so a skill installed on its own keeps its terms. Cloudflare and Artifacts are
names of Cloudflare, Inc. This project is independently maintained and is not
an official Cloudflare release or endorsement.

Badges are maintained by this project and are not provider endorsements.
[SECURITY.md](https://github.com/tpscloud/flared/blob/main/SECURITY.md) explains how to report a security issue.
