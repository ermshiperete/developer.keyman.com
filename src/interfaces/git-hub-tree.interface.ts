import { GitHubTreeObject } from './git-hub-tree-object.interface';

export interface GitHubTree {
  base_tree?: string;
  sha: string;
  url: string;
  tree: GitHubTreeObject[];
  truncated?: boolean;
}
