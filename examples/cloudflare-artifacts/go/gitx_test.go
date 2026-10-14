package gitx

import (
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

const (
	fakeToken  = "art_v2_a_0123456789abcdef0123456789abcdef01234567?expires=1"
	fakeRemote = "https://acct.artifacts.cloudflare.net/git/agents/work.git"
)

func newRepo(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not on PATH")
	}
	dir := t.TempDir()
	if out, err := exec.Command("git", "init", "-q", dir).CombinedOutput(); err != nil {
		t.Fatalf("git init: %v: %s", err, out)
	}
	return dir
}

// authServer is a TLS server that records the Authorization header of every
// request and answers 404, so git gives up after one round trip.
func authServer(t *testing.T) (*httptest.Server, func() []string) {
	t.Helper()
	var mu sync.Mutex
	var seen []string
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		seen = append(seen, r.Header.Get("Authorization"))
		mu.Unlock()
		http.NotFound(w, r)
	}))
	t.Cleanup(srv.Close)
	return srv, func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), seen...)
	}
}

func TestHeaderReachesGitThroughEnvironment(t *testing.T) {
	dir := newRepo(t)
	out, err := gitWithToken(t.Context(), dir, fakeRemote, fakeToken, "config", "--get-urlmatch", "http.extraHeader", fakeRemote)
	if err != nil {
		t.Fatal(err)
	}
	// The value is scrubbed, so seeing the masked header proves git read it.
	if got, want := strings.TrimSpace(string(out)), "Authorization: Bearer ***"; got != want {
		t.Fatalf("http.extraHeader = %q, want %q", got, want)
	}
}

func TestHeaderGoesOnlyToItsRemote(t *testing.T) {
	dir := newRepo(t)
	t.Setenv("GIT_SSL_NO_VERIFY", "1") // the fixtures use self-signed certificates
	ours, oursSeen := authServer(t)
	other, otherSeen := authServer(t)
	remote := ours.URL + "/git/agents/work.git"

	gitWithToken(t.Context(), dir, remote, fakeToken, "ls-remote", remote)
	gitWithToken(t.Context(), dir, remote, fakeToken, "ls-remote", other.URL+"/git/agents/work.git")

	want := "Bearer " + fakeToken
	if got := oursSeen(); len(got) == 0 || got[0] != want {
		t.Fatalf("remote saw Authorization %q, want %q", got, want)
	}
	for _, h := range otherSeen() {
		if h != "" {
			t.Fatalf("another host received Authorization %q", h)
		}
	}
	if len(otherSeen()) == 0 {
		t.Fatal("the other host saw no request, so the test proves nothing")
	}
}

func TestRejectsUnsafeRemotes(t *testing.T) {
	for _, remote := range []string{"", "http://acct.artifacts.cloudflare.net/git/a/b.git", "https://x:secret@host/git/a/b.git", "/local/path"} {
		if _, err := gitWithToken(t.Context(), t.TempDir(), remote, fakeToken, "status"); err == nil {
			t.Errorf("remote %q accepted", remote)
		}
	}
}

func TestTokenStaysOutOfGitConfig(t *testing.T) {
	dir := newRepo(t)
	if _, err := gitWithToken(t.Context(), dir, fakeRemote, fakeToken, "status", "--short"); err != nil {
		t.Fatal(err)
	}
	config, err := os.ReadFile(filepath.Join(dir, ".git", "config"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(config), fakeToken) {
		t.Fatal(".git/config contains the token")
	}
}

func TestErrorOutputIsScrubbed(t *testing.T) {
	dir := newRepo(t)
	// git echoes an unknown pathspec back in its error, so the token would leak
	// into the error without scrubbing.
	_, err := gitWithToken(t.Context(), dir, fakeRemote, fakeToken, "checkout", fakeToken)
	if err == nil {
		t.Fatal("checkout of a missing path succeeded")
	}
	if strings.Contains(err.Error(), fakeToken) {
		t.Fatalf("error leaks the token: %v", err)
	}
}

func TestNoSubcommand(t *testing.T) {
	if _, err := gitWithToken(t.Context(), t.TempDir(), fakeRemote, fakeToken); err == nil {
		t.Fatal("no error for an empty argument list")
	}
}
