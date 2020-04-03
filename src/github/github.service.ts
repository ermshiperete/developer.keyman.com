import { AxiosRequestConfig, AxiosResponse } from 'axios';
import { S_IXUSR } from 'constants';
import { existsSync, Stats } from 'fs';
import { empty, forkJoin, from, interval, Observable, of } from 'rxjs';
import {
  catchError, concatMap, expand, map, mapTo, switchMap, takeLast, takeWhile, tap
} from 'rxjs/operators';
import {
  DefaultLogFields, DiffResult, DiffResultBinaryFile, DiffResultTextFile
} from 'simple-git/typings/response';

import { HttpService, Injectable } from '@nestjs/common';

import { ConfigService } from '../config/config.service';
import { GitService } from '../git/git.service';
import { GitHubProject } from '../interfaces/git-hub-project.interface';
import { GitHubPullRequest } from '../interfaces/git-hub-pull-request.interface';
import { GitHubTreeModes } from '../interfaces/git-hub-tree-modes.enum';
import { GitHubTreeObject } from '../interfaces/git-hub-tree-object.interface';
import { GitHubTree } from '../interfaces/git-hub-tree.interface';
import { GitHubUser } from '../interfaces/git-hub-user.interface';
import { GitHubAccessToken } from '../interfaces/github-access-token.interface';
import { TreeDictionary } from '../interfaces/tree-dictionary.interface';
import { TokenService } from '../token/token.service';
import { readFile, stat } from '../utils/file';

import path = require('path');

const redirectUri = '/index.html';
const scope = 'repo read:user user:email';

@Injectable()
export class GithubService {
  constructor(
    private readonly config: ConfigService,
    private readonly tokenService: TokenService,
    private readonly httpService: HttpService,
    private readonly gitService: GitService,
  ) { }

  private getRedirectUri(): string {
    return `${this.config.redirectHost}${redirectUri}`;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public login(session: any): Observable<{ url: string }> {
    // session.state = this.tokenService.createRandomString(10);
    const state = this.tokenService.createRandomString(10);
    const url = {
      url:
        `https://github.com/login/oauth/authorize?client_id=${this.config.clientId}&` +
        `redirect_uri=${this.getRedirectUri()}&scope=${scope}&state=${state}`,
    };
    return of(url);
  }

  public getAccessToken(
    code: string,
    state: string,
  ): Observable<AxiosResponse<GitHubAccessToken | string>> {
    // REVIEW: The GitHub documentation
    // (https://developer.github.com/apps/building-oauth-apps/authorizing-oauth-apps/#2-users-are-redirected-back-to-your-site-by-github)
    // mentions to use POST to get the access token, but I can't get that to work whereas
    // GET works.
    /*
    const options: AxiosRequestConfig = {
      headers: {
        accept: 'application/json',
        'Content-Type': 'application/json',
      },
      data: {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code: { code },
        redirect_uri: this.getRedirectUri(),
        state: { state },
      },
    };

    return this.httpService.post(
      'https://github.com/login/oauth/access_token',
      options,
    );
    */
    const opt: AxiosRequestConfig = {
      headers: {
        accept: 'application/json',
      },
    };
    return this.httpService.get(
      'https://github.com/login/oauth/access_token' +
      `?client_id=${this.config.clientId}&client_secret=${this.config.clientSecret}` +
      `&code=${code}&state=${state}`,
      opt,
    );
  }

  public logout(): Observable<{ url: string }> {
    return of({ url: `${this.config.redirectHost}/` });
  }

  public getUserInformation(
    token: string,
  ): Observable<AxiosResponse<GitHubUser | string>> {
    if (token == null || token.length === 0) {
      return of(null);
    }
    return this.httpService.get('https://api.github.com/user', {
      headers: { Authorization: token },
    });
  }

  public getRepos(
    token: string,
    page: number,
    pageSize: number,
  ): Observable<GitHubProject> {
    if (token == null || token.length === 0) {
      return of(null);
    }

    const url = `https://api.github.com/user/repos?type=public&sort=full_name&page=${page}&per_page=${pageSize}`;
    return this.getReposPage(url, token).pipe(
      expand(({ nextPageUrl }) =>
        nextPageUrl ? this.getReposPage(nextPageUrl, token) : empty(),
      ),
      concatMap(({ content }) => content),
    );
  }

  // Get one page full of repos
  private getReposPage(
    url: string,
    token: string,
  ): Observable<{ content: GitHubProject[]; nextPageUrl: string | null }> {
    return this.httpService
      .get(url, { headers: { Authorization: token } })
      .pipe(
        map(response => ({
          content: response.data,
          nextPageUrl: this.getUrlOfNextPage(response),
        })),
      );
  }

  // Extract the URL of the next page from the headers
  private getUrlOfNextPage(response: AxiosResponse): string | null {
    let url: string | null = null;
    const link = response.headers.link;
    if (link) {
      const match = link.match(/<([^>]+)>;\s*rel="next"/);
      if (match) {
        [, url] = match;
      }
    }
    return url;
  }

  // When we fork a project on GitHub the API call immediately returns before the
  // repo actually exists. This method waits until the project appears (or timeout).
  public waitForRepoToExist(
    owner: string,
    repo: string,
    timeoutSeconds = 300,
  ): Observable<void> {
    let firstCheck = true;
    return interval(1000).pipe(
      switchMap((x: number) => {
        if (x >= timeoutSeconds) {
          throw new Error(
            `GitHubService.waitForRepoToExist(${owner}/${repo}): timeout after ${timeoutSeconds} seconds without seeing repo`,
          );
        }

        return this.repoExists(owner, repo);
      }),
      takeWhile(exists => !exists || firstCheck),
      tap(() => {
        firstCheck = false;
      }),
      takeLast(1),
      map(() => {
        return;
      }),
    );
  }

  public repoExists(owner: string, repo: string): Observable<boolean> {
    return this.httpService.get(`https://github.com/${owner}/${repo}`).pipe(
      mapTo(true),
      catchError(() => of(false)),
    );
  }

  public forkRepo(
    token: string,
    upstreamOwner: string,
    repo: string,
    user: string,
  ): Observable<GitHubProject> {
    if (token == null || token.length === 0) {
      return of(null);
    }

    return this.repoExists(user, repo).pipe(
      switchMap(exists => {
        if (exists) {
          return of({ name: repo, full_name: `${user}/${repo}` });
        }

        let project: GitHubProject = null;

        return this.httpService
          .post(
            `https://api.github.com/repos/${upstreamOwner}/${repo}/forks`,
            null,
            {
              headers: { authorization: token },
            },
          )
          .pipe(
            catchError(() => of({ data: null, full_name: 'error' })),
            switchMap(result => {
              project = result.data;
              return this.waitForRepoToExist(user, repo).pipe(
                map(() => project),
              );
            }),
            catchError(() => of({ name: null })),
          );
      }),
    );
  }

  public createPullRequest(
    token: string, // the token used to authorize with GitHub
    owner: string, // owner of the repo where the PR will be created in
    repoName: string, // name of the repo
    head: string, // name of the branch that contains the new commits. Use `username:branch` for cross-repo PRs
    base: string, // name of the branch to merge the changes in
    title: string, // title of the PR
    description: string, // description of the PR
  ): Observable<GitHubPullRequest> {
    if (token == null || token.length === 0) {
      return of(null);
    }

    return this.httpService
      .post(`https://api.github.com/repos/${owner}/${repoName}/pulls`, null, {
        headers: { authorization: token },
        data: {
          title,
          head,
          base,
          body: description,
        },
      })
      .pipe(
        map(result => ({
          number: result.data.number,
          url: result.data.url,
          state: result.data.state,
        })),
        catchError(err => {
          throw err.response.data.errors;
        }),
      );
  }

  public listPullRequests(
    token: string, // the token used to authorize with GitHub
    owner: string, // owner of the repo whose PRs to list
    repoName: string, // name of the repo
  ): Observable<GitHubPullRequest> {
    if (token == null || token.length === 0) {
      return of(null);
    }

    return this.httpService
      .get(`https://api.github.com/repos/${owner}/${repoName}/pulls`, {
        headers: {
          authorization: token,
          'Content-Type': 'application/json',
        },
      })
      .pipe(
        catchError(err => {
          throw err.response.data.errors;
        }),
        map(result => result.data),
        concatMap((pullRequests: GitHubPullRequest[]) => from(pullRequests)),
      );
  }

  public closePullRequest(
    token: string, // the token used to authorize with GitHub
    owner: string, // owner of the repo whose PRs to list
    repoName: string, // name of the repo
    pullNumber: number, // PR#
  ): Observable<GitHubPullRequest> {
    if (token == null || token.length === 0) {
      return of(null);
    }

    return this.httpService
      .patch(
        `https://api.github.com/repos/${owner}/${repoName}/pulls/${pullNumber}`,
        null,
        {
          headers: { authorization: token },
          data: { state: 'closed' },
        },
      )
      .pipe(
        map(result => ({
          number: result.data.number,
          url: result.data.url,
          state: result.data.state,
        })),
      );
  }

  // see http://www.levibotelho.com/development/commit-a-file-with-the-github-api/

  public push(
    token: string, // the token used to authorize with GitHub
    owner: string, // owner of the repo
    repoName: string, // name of the repo
    localRepo: string, // path to the local clone of the repo
    parentCommit: string, // sha1 of the parent commit
  ): Observable<void> {
    if (token == null || token.length === 0) {
      return;
    }

    // foreach commit call createCommit
    // fetch from GH
    // reset repo to remote head

    return;
  }

  private createCommit(
    token: string, // the token used to authorize with GitHub
    owner: string, // owner of the repo
    repoName: string, // name of the repo
    localRepo: string, // path to the local clone of the repo
    localCommit: string, // the sha1 of the commit in the local repo to re-create on GitHub
    gitHubParentCommit: string, // the sha1 of the parent commit on GitHub
    keyboardPath: string, // path in the repo to the directory that contains the single keyboard
  ): Observable<string> { // returns the GitHub commit sha1
    // Step 1: Get a reference to HEAD (passed in as gitHubParentCommit)
    // Step 2: Grab the commit that HEAD points to
    let fullGitHubParentCommit: { sha: string; tree: { url: string; sha: string } };
    let localCommitInfo: DefaultLogFields;
    let gitHubTree: GitHubTree;

    return this.getGitHubCommit(token, owner, repoName, gitHubParentCommit)
      .pipe(
        map(result => fullGitHubParentCommit = result),

        // Step 3: Post your new file to the server (can be done in step 5)
        // Step 4: Get a hold of the tree that the commit points to
        switchMap(() => this.getFullGitHubTreeForPath(token, owner, repoName, fullGitHubParentCommit.tree.sha, keyboardPath)),
        map(tree => gitHubTree = tree),

        // Step 5: Create a tree containing your new files
        map(() => this.gitService.checkoutCommit(localRepo, localCommit)),
        switchMap(() => this.gitService.log(localRepo, ['-1', localCommit])),
        map(logInfo => localCommitInfo = logInfo.latest),
        switchMap(() => this.gitService.getModifiedFiles(localRepo, localCommit)),




        map(() => ''),
      );
  }

  private getGitHubCommit(
    token: string, // the token used to authorize with GitHub
    owner: string, // owner of the repo
    repoName: string, // name of the repo
    commit: string, // the commit sha1 to get info for
  ): Observable<{ sha: string; tree: { url: string; sha: string } }> {
    return this.httpService.get(
      `https://api.github.com/repos/${owner}/${repoName}/git/commits/${commit}`,
      { headers: { authorization: token } },
    ).pipe(
      map(result => result.data),
    );
  }

  private getGitHubTree(
    token: string, // the token used to authorize with GitHub
    owner: string, // owner of the repo
    repoName: string, // name of the repo
    treeSha: string, // the sha of the tree
  ): Observable<GitHubTree> {
    return this.httpService.get(
      `https://api.github.com/repos/${owner}/${repoName}/git/trees/${treeSha}`,
      { headers: { authorization: token } },
    ).pipe(
      map(result => result.data),
    );
  }

  // public for unit tests
  public getFullGitHubTreeForPath(
    token: string, // the token used to authorize with GitHub
    owner: string, // owner of the repo
    repoName: string, // name of the repo
    rootTreeSha: string, // the sha of the root tree
    desiredPath: string, // the path to get the full tree for
  ): Observable<GitHubTree> {
    let resultTree: GitHubTree;
    return this.getGitHubTree(token, owner, repoName, rootTreeSha).pipe(
      tap(result => resultTree = result),
      switchMap(result => forkJoin(result.tree.map(obj => this.processTreeObject(token, owner, repoName, obj, desiredPath)))),
      map(childTree => ({
        'base_tree': resultTree.base_tree,
        sha: resultTree.sha,
        url: resultTree.url,
        tree: childTree,
        truncated: resultTree.truncated,
      })),
    );
  }

  private processTreeObject(
    token: string, // the token used to authorize with GitHub
    owner: string, // owner of the repo
    repoName: string, // name of the repo
    obj: GitHubTreeObject,
    desiredPath: string, // the path to get the full tree for
  ): Observable<GitHubTreeObject> {
    const getEverything = desiredPath.length === 0;
    if (obj.type === 'tree') {
      const pathParts = desiredPath.split(path.sep);
      if (getEverything || obj.path === pathParts[0]) {
        const restPath = getEverything ? '' : desiredPath.substring(pathParts[0].length + 1);
        return this.getFullGitHubTreeForPath(token, owner, repoName, obj.sha, restPath).pipe(
          map(ourChildTree => ({
            path: obj.path,
            mode: obj.mode,
            type: obj.type,
            size: obj.size,
            url: obj.url,
            sha: obj.sha,
            content: obj.content,
            childTree: ourChildTree,
          })),
        );
      }
    }
    return of({
      path: obj.path,
      mode: obj.mode,
      type: obj.type,
      size: obj.size,
      url: obj.url,
      sha: obj.sha,
      content: obj.content,
      childTree: null,
    });
  }

  // public for testing
  public createTree(
    repDir: string, // the path to the local repo
    commitDiff: DiffResult, // the modified files
    previousTree: GitHubTree, // the git tree
    keyboardPath: string, // path in the repo to the directory that contains the single keyboard
  ): Observable<GitHubTree> {
    const temporaryTree: GitHubTreeObject = {
      path: null,
      mode: GitHubTreeModes.subdirTree,
      type: 'tree',
      size: 0,
      url: null,
      sha: null,
      content: null,
      childTree: null,
    };

    const rootTree: GitHubTree = {
      base_tree: previousTree.sha,
      sha: null,
      url: null,
      tree: [],
    };
    // commitDiff.files.map()
    return null;
  }

  // public for testing
  public addTree(
    repoDir: string,
    parentTree: TreeDictionary,
    currentPath: string,  // path of the current directory we're processing (relative to repoDir)
    pathToProcess: string, // path to child file/directory (relative to currentPath)
    fileChanges: DiffResultTextFile | DiffResultBinaryFile,
  ): Observable<TreeDictionary> {
    const pathParts = pathToProcess.split(path.sep);
    if (pathParts.length === 1) {
      // file in local dir
      return this.addFileBlob(path.join(repoDir, currentPath), fileChanges).pipe(
        map(treeObj => {
          parentTree[pathParts[0]] = treeObj;
          return parentTree;
        }),
      );
    } else {
      // subdirectory
      return this.addSubDirectoryTree(repoDir, path.join(currentPath, pathParts[0]), fileChanges).pipe(
        map(obj => {
          parentTree[obj.fileName] = obj.tree;
          return parentTree;
        }),
      );
    }
  }

  private addFileBlob(
    dir: string,
    fileChanges: DiffResultTextFile | DiffResultBinaryFile,
  ): Observable<GitHubTreeObject> {
    const fileName = this.getFileName(fileChanges.file);
    const filePath = path.join(dir, fileName);
    return forkJoin({
      stat: stat(filePath),
      fileContent: readFile(filePath, fileChanges.binary ? 'base64' : 'utf-8'),
    }).pipe(
      map(result => ({
        path: fileName,
        // TODO: deal with symlinks
        mode: this.isExecutable(result.stat) ?
          GitHubTreeModes.executableBlob :
          GitHubTreeModes.fileBlob,
        type: 'blob',
        size: result.fileContent.length,
        sha: null,
        content: result.fileContent,
      })),
    );
  }

  private addSubDirectoryTree(
    repoDir: string,
    currentPath: string,  // path of directory we're processing (relative to repoDir)
    fileChanges: DiffResultTextFile | DiffResultBinaryFile,
  ): Observable<{ fileName: string; tree: TreeDictionary }> {
    const currentGitPath = currentPath.replace(path.sep, '/');
    if (!fileChanges.file.startsWith(currentGitPath)) {
      throw new RangeError(`file ${fileChanges.file} doesn't start with ${currentGitPath}`);
    }

    const currentDirName = this.getFileName(currentGitPath);
    const restPath = fileChanges.file.substring(`${currentGitPath}/`.length);

    return this.addTree(repoDir, {}, currentPath, restPath, fileChanges).pipe(
      map(tree => ({ fileName: currentDirName, tree })),
    );
  }

  private getFileName(gitPath: string): string {
    const parts = gitPath.split('/');
    return parts[parts.length - 1];
  }

  private isExecutable(fileStat: Stats): boolean {
    // eslint-disable-next-line no-bitwise
    return (fileStat.mode & S_IXUSR) !== 0;
  }

  // public for testing
  public isFileAdded(
    dir: string,
    file: DiffResultTextFile | DiffResultBinaryFile,
  ): boolean {
    if (file.binary) {
      const binaryFile = file as DiffResultBinaryFile;
      return binaryFile.before === 0 && binaryFile.after > 0;
    }
    const textFile = file as DiffResultTextFile;
    return textFile.insertions > 0 && textFile.deletions === 0;
  }

  // public for testing
  public isFileModified(
    dir: string,
    fileChanges: DiffResultTextFile | DiffResultBinaryFile,
  ): boolean {
    if (fileChanges.binary) {
      const binaryFileChanges = fileChanges as DiffResultBinaryFile;
      return binaryFileChanges.before > 0 && binaryFileChanges.after > 0;
    }
    const textFileChanges = fileChanges as DiffResultTextFile;
    return (textFileChanges.insertions > 0 && textFileChanges.deletions > 0) ||
      (textFileChanges.insertions === 0 && existsSync(path.join(dir, fileChanges.file)));
  }

  // public for testing
  public isFileDeleted(
    dir: string,
    fileChanges: DiffResultTextFile | DiffResultBinaryFile,
  ): boolean {
    if (fileChanges.binary) {
      const binaryFileChanges = fileChanges as DiffResultBinaryFile;
      return binaryFileChanges.before > 0 && binaryFileChanges.after === 0;
    }
    const textFileChanges = fileChanges as DiffResultTextFile;
    return textFileChanges.insertions === 0 && textFileChanges.deletions > 0 &&
      !existsSync(path.join(dir, fileChanges.file));
  }
}
