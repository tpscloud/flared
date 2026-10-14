# Security

## Reporting a problem

Report a security issue in these skills or their examples by email to
[security@tpscloud.services](mailto:security@tpscloud.services) rather than in a
public issue.

## Independent reports

Vercel's [skills.sh](https://skills.sh) runs three security audits on each
published skill, and [Tessl.io](https://tessl.io) reviews each skill's
quality. Results from 2026-10-14 are below. Each result links to that skill's
live report; the README badges link to the same pages.

| Skill | Gen Agent Trust Hub | Socket | Snyk | Tessl quality |
|---|---|---|---|---|
| [cloudflare-artifacts](skills/cloudflare-artifacts/SKILL.md) | [pass](https://www.skills.sh/tpscloud/flared/cloudflare-artifacts/security/agent-trust-hub) | [pass](https://www.skills.sh/tpscloud/flared/cloudflare-artifacts/security/socket) | [warn](https://www.skills.sh/tpscloud/flared/cloudflare-artifacts/security/snyk) | [100/100](https://tessl.io/registry/tpscloud/flared/quality/cloudflare-artifacts) |

Snyk rated cloudflare-artifacts medium risk with one finding, W011
(third-party content exposure). The skill shows how to consume Artifacts
events from Queues and Workflows, and those messages carry text written by
whoever pushed to the repo, such as commit messages and author names. An
agent that reads that text could meet an indirect prompt injection, so treat
it as untrusted data.

For the whole plugin, Tessl also publishes
[eval results](https://tessl.io/registry/tpscloud/flared/0.1.0/evals)
and a [security report](https://tessl.io/registry/tpscloud/flared/0.1.0/security)
for 0.1.0. Its security review rated the plugin low risk.
