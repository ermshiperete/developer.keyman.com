import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { GitHubPullRequest } from '../model/git-hub-pull-request';
import { Project } from '../model/project';
import { ErrorHelper } from '../utils/error-helper';
import { UserService } from './user.service';

@Injectable({
  providedIn: 'root'
})
export class SingleProjectService {

  constructor(
    private readonly http: HttpClient,
    private readonly userService: UserService,
    private readonly errorHelper: ErrorHelper
  ) { }

  public cloneProject(name: string): Observable<Project|null> {
    return this.http.post<{ project }>(`${environment.apiUrl}/projects/${name}`, null, {
      headers: { Authorization: `token ${this.userService.accessToken}` },
    }).pipe(
      catchError(this.errorHelper.handleError(`POST projects/${name} REST API`, null)),
      map(obj => new Project(obj.name, true, name, obj.repoUrl)),
    );
  }

  public createPullRequest(repoName: string): Observable<GitHubPullRequest | null> {
    return this.http.put<{ pullRequest }>(`${environment.apiUrl}/projects/${repoName}`, null, {
      headers: { Authorization: `token ${this.userService.accessToken}` },
    }).pipe(
      catchError(this.errorHelper.handleError(`PUT projects/${repoName} REST API`, null)),
      tap(pullRequest => { console.log('pullRequest='); console.log(pullRequest); }),
      map(pullRequest => new GitHubPullRequest(repoName, pullRequest.number, pullRequest.url)),
    );
  }
}
