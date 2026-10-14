// REST API response shapes (snake_case), written from the REST reference.
// Every response wraps these in { success, result, errors, messages }.

export type Jurisdiction = "eu" | "us";
export interface RepoInfo {
  id: string; name: string; description: string | null; default_branch: string;
  created_at: string; updated_at: string; last_push_at: string | null;
  source: string | null; read_only: boolean;
}
export interface RepoWithRemote extends RepoInfo { remote: string }          // get, list
export interface CreateRepoResult {                                          // create, import
  id: string; name: string; description: string | null;
  default_branch: string; remote: string; token: string;
}
export interface ForkRepoResult extends CreateRepoResult { objects: number } // fork
export interface CreateTokenResult { id: string; plaintext: string; scope: "read" | "write"; expires_at: string }
export interface TokenInfo { id: string; scope: "read" | "write"; state: "active" | "expired" | "revoked"; created_at: string; expires_at: string }
