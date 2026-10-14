// Package gitx runs git against an Artifacts remote with a repo token passed
// through environment config, so the token never reaches argv, a URL, or
// .git/config.
package gitx

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
)

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
