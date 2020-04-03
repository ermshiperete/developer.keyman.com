import { GitHubTreeObject } from './git-hub-tree-object.interface';

export interface TreeDictionary {
  [fileName: string]: GitHubTreeObject | TreeDictionary;
}
