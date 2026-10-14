# Which files did a push change?

A Worker consumes `cf.artifacts.repo.pushed` events from a Queue. For each
push it must post the list of changed file paths to an internal review
service with `fetch("https://review.internal/changes", ...)`. The Worker has
the Artifacts binding `ARTIFACTS` for the same namespace.

Return the queue handler and any helpers it needs.
