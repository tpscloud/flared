// Shapes of Artifacts events delivered through Queues event subscriptions.
// Written from the event subscription docs; workers-types does not ship them.

export interface ArtifactsEvent<T extends string, P> {
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

// created, deleted, imported (imported adds sourceUrl and branch)
export interface RepoLifecyclePayload {
  repoId: string; defaultBranch: string; description: string | null;
  readOnly: boolean; createdAt: string; updatedAt: string; lastPushAt: string | null;
  sourceUrl?: string; branch?: string;
}

// forked: `source` names the repo that was forked; the payload names the new repo
export interface RepoForkedPayload extends RepoLifecyclePayload {
  namespace: string; repoName: string;
}

export interface RepoPushedPayload {
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

export type ClonedPayload = Record<string, never>;   // {}
export type FetchedPayload = Record<string, never>;  // {}
export interface TokenCreatedPayload { tokenId: string; scope: "read" | "write"; expiresAt: string }
export interface TokenRevokedPayload { tokenId: string }
