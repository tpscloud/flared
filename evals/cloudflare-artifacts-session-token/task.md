# A per-agent workspace with its own token

A Cloudflare Worker has an Artifacts binding `ARTIFACTS` on the namespace
`agents`, which holds a reviewed repo named `baseline`. Write a function that
gives a new coding agent its own workspace to push to, and returns what the
agent needs to clone and push with `git`. Agents run for at most an hour.

Return the TypeScript function and the two shell commands the agent runs to
clone and push.
