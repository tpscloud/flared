// A token broker: authenticate the caller, then mint a scoped, short-lived
// repo token instead of sharing one long-lived write token.

interface Caller {
  mayAccess(repo: string): boolean;
  mayPush(repo: string): boolean;
}

// Your authentication: verify a session, an Access JWT, or an API key. If it
// accepts cookies, also reject cross-origin requests.
declare function authenticate(request: Request, env: Env): Promise<Caller | null>;

const noStore = { "cache-control": "no-store" };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // POST only, so no link, prefetch or cache can mint a token.
    if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: { allow: "POST" } });
    const caller = await authenticate(request, env); // your auth; reject otherwise
    if (!caller) return new Response("unauthorized", { status: 401 });

    const url = new URL(request.url);
    const name = url.searchParams.get("repo");
    if (!name || !caller.mayAccess(name)) return new Response("forbidden", { status: 403 });

    const scope = caller.mayPush(name) ? "write" : "read";
    try {
      using repo = await env.ARTIFACTS.get(name);
      const { remote } = await repo.info();
      const t = await repo.createToken(scope, 900);
      return Response.json({ remote, token: t.plaintext, scope: t.scope, expiresAt: t.expiresAt }, { headers: noStore });
    } catch (err) {
      const code = (err as Partial<ArtifactsError>).code;
      if (code === "NOT_FOUND") return new Response("no such repo", { status: 404 });
      if (code?.endsWith("_IN_PROGRESS")) return new Response("not ready", { status: 409, headers: { "retry-after": "2" } });
      throw err;
    }
  },
} satisfies ExportedHandler<Env>;
