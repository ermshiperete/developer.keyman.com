export class GitHubPullRequest {
  public keyboardId: string;
  public pullRequest: number;
  public url: string;

  public constructor(
    keyboardId: string,
    pullRequest: number,
    url: string,
  ) {
    this.keyboardId = keyboardId;
    this.pullRequest = pullRequest;
    this.url = url;
  }
}
