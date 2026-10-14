# Events

Source: [Artifacts event subscriptions](https://developers.cloudflare.com/artifacts/guides/event-subscriptions/),
[Queues event subscriptions](https://developers.cloudflare.com/queues/event-subscriptions/manage-event-subscriptions/),
[Build and deploy on push](https://developers.cloudflare.com/artifacts/guides/build-and-deploy-on-push/).
Wrangler flags and trigger schema checked against `wrangler` 4.149.0.

Artifacts publishes events through Queues event subscriptions. A Worker (or an
HTTP pull consumer) reads them from the queue. There are two sources:

| Source | Scope | Event types |
|---|---|---|
| `artifacts` | Every repo in the account | `cf.artifacts.repo.created`, `.deleted`, `.forked`, `.imported` |
| `artifacts.repo` | One repo, chosen by `namespace` and `repo_name` | `cf.artifacts.repo.pushed`, `.cloned`, `.fetched`, `.token.created`, `.token.revoked` |

**Push events are per repo.** With repo-per-agent you need a subscription for
each repo you want push events from, or a Workflow trigger (below), or your
own client reporting pushes to your Worker. The docs don't state a limit on
subscriptions per account; check before creating one per short-lived repo.

## Create a subscription

```sh
wrangler queues create artifacts-events
wrangler queues create artifacts-events-dlq   # dead letters, see the consumer below

# account-level lifecycle events
wrangler queues subscription create artifacts-events \
  --source artifacts --events repo.created,repo.forked,repo.imported,repo.deleted

# one repo's pushes (flags checked in wrangler 4.149.0)
wrangler queues subscription create artifacts-events \
  --source artifacts.repo --source-namespace agents --source-repo-name trunk \
  --events pushed

wrangler queues subscription list artifacts-events
wrangler queues subscription delete artifacts-events --id <subscription-id>
```

`--events` takes short names. Wrangler's help for this flag says to use
`pushed`, not `cf.artifacts.repo.pushed`, for `artifacts.repo`. It gives no
example for the account-level `artifacts` source; the short names above follow
the Artifacts docs headings, so confirm them with `subscription list` after
creating. The dashboard (Queues > your queue > Subscriptions) works too.

To create subscriptions from code (for example when a fork is created), Wrangler
4.149.0 sends this request, which you can reproduce with an API token that has
Queues and Workers Scripts write access. The Artifacts docs don't document it
directly, so verify it against your account first:

```sh
curl -sS -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/event_subscriptions/subscriptions" \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" --header "Content-Type: application/json" \
  --data '{
    "name": "pushes agents/trunk",
    "enabled": true,
    "source": { "type": "artifacts.repo", "namespace": "agents", "repo_name": "trunk" },
    "destination": { "type": "queues.queue", "queue_id": "<queue id, not name>" },
    "events": ["pushed"]
  }'
```

## Envelope

Every message body has the same outer shape:

```ts
// examples/cloudflare-artifacts/src/events.ts
interface ArtifactsEvent<T extends string, P> {
  type: T;                                   // e.g. "cf.artifacts.repo.pushed"
  source: {
    type: "artifacts" | "artifacts.repo";
    namespace: string;
    repoName: string;
  };
  payload: P;
  metadata: {
    accountId: string;
    eventSubscriptionId: string;
    eventSchemaVersion: number;              // 1 today
    eventTimestamp: string;                  // ISO 8601
  };
}
```

## Payloads

```ts
// examples/cloudflare-artifacts/src/events.ts
// created, deleted, imported (imported adds sourceUrl and branch)
interface RepoLifecyclePayload {
  repoId: string; defaultBranch: string; description: string | null;
  readOnly: boolean; createdAt: string; updatedAt: string; lastPushAt: string | null;
  sourceUrl?: string; branch?: string;
}

// forked: `source` names the repo that was forked; the payload names the new repo
interface RepoForkedPayload extends RepoLifecyclePayload {
  namespace: string; repoName: string;
}

interface RepoPushedPayload {
  ref: string;                       // "refs/heads/main"
  before: string;                    // previous tip
  after: string;                     // new tip
  commits: {
    id: string; message: string; messageTruncated: boolean; timestamp: string;
    author: { name: string; email: string };
    committer: { name: string; email: string };
    parents: string[];
  }[];
  totalCommitsCount: number;
  commitsTruncated: boolean;         // when true, commits[] is partial
}

type ClonedPayload = Record<string, never>;   // {}
type FetchedPayload = Record<string, never>;  // {}
interface TokenCreatedPayload { tokenId: string; scope: "read" | "write"; expiresAt: string }
interface TokenRevokedPayload { tokenId: string }
```

The push payload has **no changed-file list**, and `commits[]` can be
truncated. To find changed paths, compare the trees of `before` and `after`
(see `patterns.md`). The docs don't show `before` for a created ref, `after`
for a deleted one, or `after` for an annotated tag. Git uses forty zeros for
the first two and a tag object for the third, so the consumer below handles
branches only until you have seen those payloads from your account.

## Untrusted fields

Anyone who can push to a repo writes `commits[].message`, `author` and
`committer` in its push events, and `sourceUrl` comes from whoever asked for
the import. When an agent or model reads an event, these fields can carry
an indirect prompt injection. Route on `type`, `source`, `ref`, `before` and
`after`. If a model has to see message text, pass it as quoted data with a
length limit and tell the model it is untrusted. Never paste it into a
system prompt, a shell command or a URL.

## Consumer Worker

```jsonc
// wrangler.jsonc
{
  "artifacts": [{ "binding": "ARTIFACTS", "namespace": "agents" }],
  "queues": { "consumers": [{ "queue": "artifacts-events", "max_batch_size": 10,
                             "max_retries": 5, "dead_letter_queue": "artifacts-events-dlq" }] }
}
```

`isZeroHash` is the helper from `patterns.md`.

```ts
// examples/cloudflare-artifacts/src/consumer.ts
// Your handler, for example changedPaths() from changed-paths.ts. Delivery is
// at least once: record eventId durably and skip ids already done. Don't key
// on `after` alone; pushes A to C and B to C share it but change different files.
declare function onPush(env: Env, eventId: string, namespace: string, repo: string, p: RepoPushedPayload): Promise<void>;

type Pushed = ArtifactsEvent<"cf.artifacts.repo.pushed", RepoPushedPayload>;
type AnyEvent = ArtifactsEvent<string, unknown>;

export default {
  async queue(batch: MessageBatch<AnyEvent>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const ev = msg.body;
      try {
        if (ev.type === "cf.artifacts.repo.pushed") {
          const p = (ev as Pushed).payload;
          // Branches only: a deleted ref has nothing to diff, and a tag's `after`
          // may be a tag object rather than a commit.
          if (p.ref.startsWith("refs/heads/") && !isZeroHash(p.after)) {
            await onPush(env, msg.id, ev.source.namespace, ev.source.repoName, p);
          }
        }
        msg.ack();
      } catch (err) {
        console.error("artifacts event failed", ev.type, err);
        msg.retry(); // bounded by max_retries, then the dead letter queue
      }
    }
  },
} satisfies ExportedHandler<Env, AnyEvent>;
```

A binding is fixed to one namespace. If events can come from several
namespaces, pick the binding by `ev.source.namespace` or ignore the ones you
don't serve.

## Workflow trigger on push

For CI-style work, Wrangler can start a Workflow on `cf.artifacts.repo.pushed`
without a queue. Leaving out `repo_name` matches pushes to any repo in the
namespace, which suits repo-per-agent layouts. Wrangler 4.149.0 validates
this shape:

```jsonc
{
  "workflows": [{ "name": "on-push", "binding": "ON_PUSH", "class_name": "OnPush" }],
  "triggers": {
    "events": [
      {
        "type": "cf.artifacts.repo.pushed",
        "filter": { "namespace": "agents" },          // optional; add "repo_name" to narrow
        "targets": [{ "type": "workflow", "workflow_name": "on-push" }]
      }
    ]
  }
}
```

The "Build and deploy on push" guide shows a different shape
(`"filter": { "namespace", "repoName" }` and
`"target": { "scriptName", "workflowName" }`), which Wrangler 4.149.0's
config schema rejects. Follow the `config-schema.json` that ships with your
installed Wrangler. The guide also covers `@cloudflare/ci` runners and
caching. For plain Worker builds from an Artifacts repo, use the
[Workers Builds Artifacts integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/artifacts-integration/)
instead; it treats only `main` as the production branch.
