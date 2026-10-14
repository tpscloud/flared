// A Queues consumer for Artifacts events.
import type { ArtifactsEvent, RepoPushedPayload } from "./events";
import { isZeroHash } from "./changed-paths";

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
