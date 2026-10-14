// The binding types as the skill quotes them, checked against the pinned
// @cloudflare/workers-types. When a bump changes a shape, tsc fails here.

namespace Quoted {
  export interface ArtifactsCreateRepoResult {
    id: string; name: string; description: string | null;
    defaultBranch: string; remote: string;
    token: string; // "art_v2_<letter>_<40 hex>?expires=<unix>", only returned here
  }
  export interface ArtifactsRepoInfo {
    id: string; name: string; description: string | null; defaultBranch: string;
    createdAt: string; updatedAt: string; lastPushAt: string | null;
    source: string | null; // e.g. "github:owner/repo" or "artifacts:ns/repo" for forks and imports
    readOnly: boolean; remote: string;
  }
  export interface ArtifactsCommitMetadata {
    hash: string; treeHash: string; message: string;
    author: { name: string; email: string };
    committer: { name: string; email: string };
    parents: string[]; authoredAt: number; committedAt: number; // unix seconds
  }
  export interface ArtifactsTreeEntry {
    name: string; mode: string; hash: string;
    type: "tree" | "blob" | "symlink" | "gitlink" | "exec";
  }
  // list(): no `status` field, although the docs show one.
  export interface ArtifactsRepoListResult {
    repos: Omit<ArtifactsRepoInfo, "remote">[]; total: number; cursor?: string;
  }
  export interface ArtifactsCreateTokenResult {
    id: string; plaintext: string; scope: "read" | "write"; expiresAt: string;
  }
  export interface ArtifactsTokenInfo { // listTokens(): no plaintext
    id: string; scope: "read" | "write"; state: "active" | "expired" | "revoked";
    createdAt: string; expiresAt: string;
  }
}

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

export type BindingTypesMatch = [
  Expect<Equal<Quoted.ArtifactsCreateRepoResult, ArtifactsCreateRepoResult>>,
  Expect<Equal<Quoted.ArtifactsRepoInfo, ArtifactsRepoInfo>>,
  Expect<Equal<Quoted.ArtifactsCommitMetadata, ArtifactsCommitMetadata>>,
  Expect<Equal<Quoted.ArtifactsTreeEntry, ArtifactsTreeEntry>>,
  Expect<Equal<Quoted.ArtifactsRepoListResult, ArtifactsRepoListResult>>,
  Expect<Equal<Quoted.ArtifactsCreateTokenResult, ArtifactsCreateTokenResult>>,
  Expect<Equal<Quoted.ArtifactsTokenInfo, ArtifactsTokenInfo>>,
];
