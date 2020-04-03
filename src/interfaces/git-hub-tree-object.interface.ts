import { GitHubTreeModes } from './git-hub-tree-modes.enum';
import { GitHubTree } from './git-hub-tree.interface';

export interface GitHubTreeObject {
  path: string;
  mode: GitHubTreeModes;
  type: 'blob' | 'tree' | 'commit';
  size: number;
  url?: string;
  sha: string | null;
  content: string | null;
  childTree?: GitHubTree;
}
