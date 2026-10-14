# flared

Agent skills for Cloudflare, written from the live docs and the shipped type
declarations rather than from memory. Every TypeScript or Go block in a skill
is trimmed from a file under `examples/` that must type-check or pass its
tests. If the two ever disagree, the example is right and the skill text is
wrong.

## What is in here

```
skills/<name>/SKILL.md        the skill (frontmatter plus body)
skills/<name>/references/     deep dives, loaded on demand
skills/<name>/agents/         Codex display metadata
examples/<name>/              one npm project per skill: tsc, plus vitest in test/
examples/<name>/go/           a Go module when the skill shows Go code
scripts/check.sh              tsc, vitest, gofmt, vet, go test; fence and dash sweeps
scripts/test-rest-guard.sh    runs the REST shell setup against a fake curl
evals/<name>-<scenario>/      Tessl eval scenarios
.claude-plugin/plugin.json    lets the repo install as a Claude Code plugin
.tessl-plugin/plugin.json     Tessl registry manifest
skills.sh.json                skill groupings for the skills.sh page
```

| Skill                | Covers                                         | Pins (in `examples/<skill>/`)                          |
|----------------------|------------------------------------------------|--------------------------------------------------------|
| cloudflare-artifacts | Artifacts binding, REST API, git, tokens, events | `@cloudflare/workers-types` 5.20261012.1, TypeScript 7.0.2 |

Skill names start with the product they cover (`cloudflare-<product>`), so they
read well next to Cloudflare's own skills. Each skill has its own example
project so its pins stay independent.

## Rules for editing a skill

1. Verify before you write. Cloudflare products in beta change quickly. Check
   the live docs (any page as Markdown: append `index.md`; each product has an
   `llms.txt`), the declarations in the latest `@cloudflare/workers-types`, and
   Wrangler's `config-schema.json` and CLI source. Live docs beat old notes.
   Where the docs contradict themselves or the tooling, say so in the skill's
   references rather than picking silently.
2. Bump a pin in `examples/<skill>/package.json` first, run the check, fix what
   fails, and only then edit prose. Wrangler is not a dependency: check a new
   version's CLI and `config-schema.json` by hand against the shell and jsonc
   snippets. Update the versions and the check date at the top
   of `references/limits-pricing-errors.md`. Keep versions and calendar
   dates out of `SKILL.md`; Tessl's review marks them down as time-sensitive.
3. Every `ts` or `go` block is either trimmed from a file under `examples/` or
   a short API sketch. Its first line says which:
   `// examples/<path>` or `// excerpt: ...`. The check verifies that the file
   exists and that every line of a trimmed block appears in it.
4. When a skill quotes types from `@cloudflare/workers-types`, assert them
   equal to the real declarations in an example file (see
   `examples/cloudflare-artifacts/src/binding-types.ts`), so a pin bump that
   changes a shape fails the check.
5. Write examples from scratch; do not paste Cloudflare documentation text.
   Never put a real account ID, API token, or repo token in this repository.
6. Frontmatter carries only `name`, `description`, and `license`. Double quote
   the description, keep it under 1024 characters, and say when to use the
   skill and when not to.
7. Keep SKILL.md short: a summary, the rules that prevent most mistakes, a
   minimal flow, references one level deep (each linked with a line saying
   what it holds), and a final Sources section.
8. Each skill directory carries `LICENSES/MIT.txt` and a `NOTICE.md`, so a
   skill installed on its own keeps its terms. The NOTICE says the skill is
   independent and not a Cloudflare release.
9. No em dashes or en dashes anywhere: prose, code comments, commit messages.

## Checking your work

```sh
skillforge validate .
skillforge check .
```

`check` runs `scripts/check.sh`, which needs Go, Node, bash and jq. Run both before every
commit. Install Skillforge from its
[releases](https://github.com/tpscloud/skillforge-ci/releases) or build it from
`.skill-quality/` (`go -C .skill-quality build -o /tmp/skillforge .`). CI builds
it from that vendored copy. Do not edit `.skill-quality/` by hand; update it
with `skillforge install . --update` from a newer Skillforge release.

## Commits

One skill per commit where possible. Start the subject with the skill name,
for example `cloudflare-artifacts: document the v2 token format`.

## Adding a skill

1. Write `skills/<name>/SKILL.md`, `LICENSES/MIT.txt`, and `NOTICE.md`.
2. Create `examples/<name>/` with its own `package.json` (and `go/` module if
   needed).
3. Add the skill to `.skill-quality.json`, `skills.sh.json`,
   `.tessl-plugin/plugin.json`, the table above, and README.md.
4. Add eval scenarios under `evals/<name>-<scenario>/`.
5. Run validation and the checks, then commit.

## Publishing to Tessl

The "Publish to Tessl" workflow runs on pushes to `main` that change `skills/`,
`evals/`, or `.tessl-plugin/plugin.json`, and publishes only when the version in
`.tessl-plugin/plugin.json` is not in the registry yet. It fails at its login
step until the `TESSL_TOKEN` repository secret is set. Publishing runs every eval scenario, which costs
Tessl credits, so bump the version (and the one in `.claude-plugin/plugin.json`)
only for a release. Documentation changes never publish.
