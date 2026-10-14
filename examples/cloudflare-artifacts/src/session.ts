// Hand an agent its own fork of a trusted baseline and a short-lived token.
// wrangler.jsonc: "artifacts": [{ "binding": "ARTIFACTS", "namespace": "agents" }]
// Authorize the caller before this runs; it hands out a write token.
export async function startSession(env: Env, agentId: string, sessionId: string) {
  using base = await env.ARTIFACTS.get("baseline"); // a reviewed, trusted repo
  // A repeat of the same session throws ALREADY_EXISTS here, before the cleanup below.
  const fork = await base.fork(await repoName(agentId, sessionId), { defaultBranchOnly: true });
  try {
    using repo = await getWhenReady(env, fork.name);  // the fork may still be copying
    await repo.revokeToken(fork.token);               // drop the initial 24 hour token
    const token = await repo.createToken("write", 3600);
    return { remote: fork.remote, branch: fork.defaultBranch, token: token.plaintext, expiresAt: token.expiresAt };
  } catch (err) {
    // Deleting the fork also deletes its initial write token.
    await env.ARTIFACTS.delete(fork.name).catch((e) => console.error("orphaned fork", fork.name, e));
    throw err;
  }
}

// Hash the pair so ("a-b", "c") and ("a", "b-c") cannot collide.
export async function repoName(agentId: string, sessionId: string): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify([agentId, sessionId]));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return "session-" + Array.from(hash.subarray(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Retry get() with backoff while a create, import, or fork is still running.
export async function getWhenReady(env: Env, name: string, tries = 5): Promise<ArtifactsRepo> {
  for (let i = 0; ; i++) {
    try {
      return await env.ARTIFACTS.get(name);
    } catch (err) {
      const code = (err as Partial<ArtifactsError>).code;
      if (!code?.endsWith("_IN_PROGRESS") || i + 1 >= tries) throw err;
      await scheduler.wait(250 * 2 ** i);
    }
  }
}
