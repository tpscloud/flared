# Push from a Go service without leaking the token

A Go service receives a remote URL and a repo token for an Artifacts repo from
a token broker, clones it into a temporary directory, commits a generated
file, and pushes to `main`. The service's logs are shipped to a third party.

Write the Go code that runs `git` for the clone and the push.
