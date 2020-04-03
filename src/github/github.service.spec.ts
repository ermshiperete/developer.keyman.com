import { AxiosResponse } from 'axios';
import { forkJoin, Observable, of, Scheduler, throwError, VirtualTimeScheduler } from 'rxjs';
import { map, switchMap, tap } from 'rxjs/operators';
import { CommitSummary } from 'simple-git/typings/response';

import { HttpService } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ConfigModule } from '../config/config.module';
import { GitService } from '../git/git.service';
import { GitHubTreeModes } from '../interfaces/git-hub-tree-modes.enum';
import { GitHubTree } from '../interfaces/git-hub-tree.interface';
import { TokenService } from '../token/token.service';
import { deleteFolderRecursive } from '../utils/delete-folder';
import { appendFile, deleteFile, mkdir, mkdtemp, writeFile } from '../utils/file';
import { GithubService } from './github.service';

import os = require('os');
import path = require('path');

describe('GitHub Service', () => {
  const projectFromGitHub = {
    name: 'foo',
    'full_name': 'jdoe/foo',
    private: false,
    owner: {
      login: 'jdoe',
      type: 'User',
      'site_admin': false,
    },
    'html_url': 'https://github.com/jdoe/foo',
    description: null,
    fork: false,
    url: 'https://api.github.com/repos/jdoe/foo',
    size: 11195,
    'default_branch': 'master',
  };
  const resultSuccess: AxiosResponse = {
    data: '<html><body>Some text</body></html>',
    status: 200,
    statusText: '',
    headers: {},
    config: {},
  };
  const resultError: AxiosResponse = {
    data: '<html><body>Repo does not exist</body></html>',
    status: 404,
    statusText: '',
    headers: {},
    config: {},
  };

  let sut: GithubService;
  let spyHttpService: HttpService;
  let gitService: GitService;

  beforeEach(async () => {
    jest.setTimeout(10000 /* 10s */);
    jest.useFakeTimers();
    const testingModule: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule],
      providers: [
        GitService,
        GithubService,
        {
          provide: TokenService,
          useFactory: (): any => ({
            createRandomString: jest.fn(() => '9876543210'),
          }),
        },
        {
          provide: HttpService,
          useFactory: (): any => ({
            get: jest.fn(() => of({})),
            post: jest.fn(() => of({})),
          }),
        },
        {
          provide: Scheduler,
          useValue: new VirtualTimeScheduler(),
        },
      ],
    }).compile();

    sut = testingModule.get<GithubService>(GithubService);
    spyHttpService = testingModule.get<HttpService>(HttpService);
    gitService = testingModule.get<GitService>(GitService);
  });

  it('should be defined', () => {
    expect.assertions(1);
    expect(sut).toBeDefined();
  });

  describe('login', () => {
    it('should return url', async () => {
      expect.assertions(1);
      await expect(sut.login({ state: '' }).toPromise()).resolves.toEqual({
        url:
          'https://github.com/login/oauth/authorize?client_id=abcxyz&redirect_uri=' +
          'http://localhost:3000/index.html&scope=repo read:user user:email&state=9876543210',
      });
    });
  });

  describe('getAccessToken', () => {
    it('should invoke get on HttpService', async () => {
      expect.assertions(1);
      await sut.getAccessToken('code987', '9876543210').toPromise();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(spyHttpService.get)
        .toHaveBeenCalledWith(
          'https://github.com/login/oauth/access_token' +
          '?client_id=abcxyz&client_secret=secret&code=code987&state=9876543210',
          { headers: { accept: 'application/json' }},
        );
    });
  });

  describe('logout', () => {
    it('returns URL of homepage', async () => {
      expect.assertions(1);
      await expect(sut.logout().toPromise()).resolves.toEqual({
        url: 'http://localhost:3000/',
      });
    });
  });

  describe('getUserInformation', () => {
    it('should invoke GET on HttpService', async () => {
      expect.assertions(1);
      await sut.getUserInformation('12345').toPromise();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(spyHttpService.get).toHaveBeenCalledWith(
        'https://api.github.com/user',
        { headers: { Authorization: '12345'} },
      );
    });

    it('should return null when token is null', async () => {
      expect.assertions(1);
      const result = await sut.getUserInformation(null).toPromise();
      expect(result).toBeNull();
    });

    it('should return null when token is empty', async () => {
      expect.assertions(1);
      const result = await sut.getUserInformation('').toPromise();
      expect(result).toBeNull();
    });
  });

  describe('getRepos', () => {
    it('should return null when token is null', async () => {
      expect.assertions(1);
      const result = await sut.getRepos(null, 1, 100).toPromise();
      expect(result).toBeNull();
    });

    it('should return null when token is empty', async () => {
      expect.assertions(1);
      const result = await sut.getRepos('', 1, 100).toPromise();
      expect(result).toBeNull();
    });

    it('should invoke GET on HttpService', async () => {
      expect.assertions(1);
      const result: AxiosResponse = {
        data: [],
        status: 200,
        statusText: '',
        headers: {},
        config: {},
      };
      jest.spyOn(spyHttpService, 'get').mockImplementationOnce(() => of(result));
      await sut.getRepos('12345', 1, 100).toPromise();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(spyHttpService.get).toHaveBeenCalledWith(
        'https://api.github.com/user/repos?type=public&sort=full_name&page=1&per_page=100',
        { headers: { Authorization: '12345' } },
      );
    });

    it('should return GitHub projects - fits in one page', () => {
      expect.assertions(1);
      const result: AxiosResponse = {
        data: [projectFromGitHub],
        status: 200,
        statusText: '',
        headers: {
          link:
            '<https://api.github.com/user/repos?type=public&sort=full_name&page=1>; rel="last",' +
            '<https://api.github.com/user/repos?type=public&sort=full_name&page=1>; rel="first"',
        },
        config: {},
      };
      jest.spyOn(spyHttpService, 'get').mockImplementationOnce(() => of(result));

      return expect(sut.getRepos('token 12345', 1, 100).toPromise())
        .resolves.toEqual(projectFromGitHub);
    });

    it('should return GitHub projects - two pages', done => {
      expect.assertions(5);
      const result1: AxiosResponse = {
        data: [projectFromGitHub],
        status: 200,
        statusText: '',
        headers: {
          link:
            '<https://api.github.com/user/repos?type=public&sort=full_name&page=2>; rel="last",' +
            '<https://api.github.com/user/repos?type=public&sort=full_name&page=2>; rel="next"',
        },
        config: {},
      };
      const result2: AxiosResponse = {
        data: [projectFromGitHub],
        status: 200,
        statusText: '',
        headers: {
          link:
            '<https://api.github.com/user/repos?type=public&sort=full_name&page=1>; rel="prev",' +
            '<https://api.github.com/user/repos?type=public&sort=full_name&page=1>; rel="first"',
        },
        config: {},
      };
      jest.spyOn(spyHttpService, 'get')
        .mockImplementationOnce(() => of(result1))
        .mockImplementationOnce(() => of(result2));

      let count = 0;
      const subscription = sut.getRepos('token 12345', 1, 100).subscribe({
        next: val => {
          expect(val).toEqual(projectFromGitHub);
          count++;
        },
        complete: () => {
          expect(count).toEqual(2);
          // eslint-disable-next-line @typescript-eslint/unbound-method
          expect(spyHttpService.get).toHaveBeenCalledWith(
            'https://api.github.com/user/repos?type=public&sort=full_name&page=1&per_page=100',
            { headers: { Authorization: 'token 12345' } },
          );
          // eslint-disable-next-line @typescript-eslint/unbound-method
          expect(spyHttpService.get).toHaveBeenCalledWith(
            'https://api.github.com/user/repos?type=public&sort=full_name&page=2',
            { headers: { Authorization: 'token 12345' } },
          );
          done();
        },
      });
      subscription.unsubscribe();
    });
  });

  describe('fork repo', () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    it('creates a fork', async () => {
      // Setup
      expect.assertions(2);

      const result: AxiosResponse = {
        data: projectFromGitHub,
        status: 200,
        statusText: '',
        headers: {},
        config: {},
      };
      jest.spyOn(spyHttpService, 'post').mockImplementationOnce(() => of(result));
      jest
        .spyOn(spyHttpService, 'get')
        .mockImplementationOnce(() => throwError(resultError))
        .mockImplementationOnce(() => throwError(resultError))
        .mockImplementationOnce(() => throwError(resultError))
        .mockImplementationOnce(() => of(resultSuccess));

      // Execute
      const gitHubProject = await sut.forkRepo('12345', 'upstreamUser', 'foo', 'jdoe')
        .toPromise();

      // Verify
      expect(gitHubProject.full_name).toEqual('jdoe/foo');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(spyHttpService.post).toHaveBeenCalledWith(
        'https://api.github.com/repos/upstreamUser/foo/forks',
        null,
        { headers: { authorization: '12345' } },
      );
    });

    it('does not fail if fork already exists', async () => {
      // Setup
      expect.assertions(2);

      const result: AxiosResponse = {
        data: projectFromGitHub,
        status: 200,
        statusText: '',
        headers: {},
        config: {},
      };
      const mock = jest.fn(() => of(result));
      jest
        .spyOn(spyHttpService, 'post')
        .mockImplementationOnce(mock);
      jest
        .spyOn(spyHttpService, 'get')
        .mockImplementationOnce(() => of(resultSuccess));

      // Execute
      const gitHubProject = await sut
        .forkRepo('12345', 'upstreamUser', 'foo', 'jdoe')
        .toPromise();

      // Verify
      expect(gitHubProject.full_name).toEqual('jdoe/foo');
      expect(mock).not.toHaveBeenCalled();
    });
  });

  describe('check existence of repo', () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    it('repo does not exist', async () => {
      // Setup
      expect.assertions(1);
      jest.spyOn(spyHttpService, 'get').mockImplementationOnce(() => throwError(resultError) );

      // Execute
      const exists = await sut.repoExists('owner', 'repo').toPromise();

      // Verify
      expect(exists).toBe(false);
    });

    it('repo exists', async () => {
      // Setup
      expect.assertions(1);
      jest.spyOn(spyHttpService, 'get').mockImplementationOnce(() => of(resultSuccess));

      // Execute
      const exists = await sut.repoExists('owner', 'repo').toPromise();

      // Verify
      expect(exists).toBe(true);
    });
  });

  describe('wait for existence of repo', () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    it('waits until repo exists', async () => {
      // Setup
      expect.assertions(1);
      jest
        .spyOn(spyHttpService, 'get')
        .mockImplementationOnce(() => throwError(resultError))
        .mockImplementationOnce(() => throwError(resultError))
        .mockImplementationOnce(() => throwError(resultError))
        .mockImplementationOnce(() => of(resultSuccess));

      // Execute
      await sut.waitForRepoToExist('owner', 'repo', 4).toPromise();

      // Verify
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(spyHttpService.get).toHaveBeenCalledTimes(4);
    });

    it('times out if repo does not exist', async () => {
      // Setup
      expect.assertions(1);
      jest
        .spyOn(spyHttpService, 'get')
        .mockImplementationOnce(() => throwError(resultError))
        .mockImplementationOnce(() => throwError(resultError))
        .mockImplementationOnce(() => throwError(resultError))
        .mockImplementationOnce(() => of(resultSuccess));

      // Execute/Verify
      try {
        await sut.waitForRepoToExist('owner', 'repo', 3).toPromise();
      } catch (error) {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(spyHttpService.get).toHaveBeenCalledTimes(3);
      }
    });

    it('repo exists right away still allows pipe', async () => {
      // Setup
      expect.assertions(2);
      jest
        .spyOn(spyHttpService, 'get')
        .mockImplementationOnce(() => of(resultSuccess))
        .mockImplementationOnce(() => of(resultSuccess));
      let tapCalled = false;

      // Execute
      await sut.waitForRepoToExist('owner', 'repo', 4).pipe(
        tap(() => tapCalled = true),
      ).toPromise();

      // Verify
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(spyHttpService.get).toHaveBeenCalledTimes(2);
      expect(tapCalled).toBe(true);
    });
  });

  describe('createPullRequest', () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    it('creates a PR', async () => {
      // Setup
      expect.assertions(2);

      const result: AxiosResponse = {
        data: {
          url: 'https://api.github.com/repos/keymanapp/keyboards/pulls/1347',
          'number': 1347,
          state: 'open',
          locked: true,
          title: 'the title of the PR',
          body: 'This is the description of the PR',
        },
        status: 201,
        statusText: 'Created',
        headers: {},
        config: {},
      };
      jest.spyOn(spyHttpService, 'post').mockImplementationOnce(() => of(result));

      // Execute
      const pullRequest = await sut.createPullRequest(
        '12345',
        'keymanapp',
        'keyboards',
        'foo:foo-myKeyboard',
        'master',
        'the title of the PR',
        'This is the description of the PR')
        .toPromise();

      // Verify
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(spyHttpService.post).toHaveBeenCalledWith(
        'https://api.github.com/repos/keymanapp/keyboards/pulls',
        null,
        {
          headers: { authorization: '12345' },
          data: {
            title: 'the title of the PR',
            head: 'foo:foo-myKeyboard',
            base: 'master',
            body: 'This is the description of the PR',
          },
        },
      );
      expect(pullRequest).toEqual({
        url: 'https://api.github.com/repos/keymanapp/keyboards/pulls/1347',
        'number': 1347,
        state: 'open',
      });
    });
  });

  const gitTree: GitHubTree = {
    // #region nested GitHub tree object for Shan keyboard
    'base_tree': null,
    sha: '9fb037999f264ba9a7fc6274d15fa3ae2ab98312',
    url: 'https://api.github.com/repos/foo/keyboards/trees/9fb037999f264ba9a7fc6274d15fa3ae2ab98312',
    tree: [
      {
        path: 'build.sh',
        mode: GitHubTreeModes.executableBlob,
        type: 'blob',
        size: 3145,
        sha: '45b983be36b73c0788dc9cbcb76cbb80fc7bb057',
        url: 'https://api.github.com/repos/foo/keyboards/git/blobs/45b983be36b73c0788dc9cbcb76cbb80fc7bb057',
        childTree: null,
        content: null,
      },
      {
        path: 'README.md',
        mode: GitHubTreeModes.subdirTree,
        type: 'blob',
        size: 2849,
        sha: '44b4fc6d56897b048c772eb4087f854f46256132',
        url: 'https://api.github.com/repos/foo/keyboards/git/blobs/44b4fc6d56897b048c772eb4087f854f46256132',
        childTree: null,
        content: null,
      },
      {
        path: 'release',
        mode: GitHubTreeModes.subdirTree,
        type: 'tree',
        sha: 'f484d249c660418515fb01c2b9662073663c242e',
        url: 'https://api.github.com/repos/foo/keyboards/git/blobs/f484d249c660418515fb01c2b9662073663c242e',
        size: null,
        content: null,
        childTree: {
          'base_tree': null,
          sha: 'f484d249c660418515fb01c2b9662073663c242e',
          url: 'https://api.github.com/repos/foo/keyboards/trees/f484d249c660418515fb01c2b9662073663c242e',
          tree: [
            {
              path: 's',
              mode: GitHubTreeModes.subdirTree,
              type: 'tree',
              sha: '8ae17eca4bbc4676a0c0c7a8e2a51375',
              url: 'https://api.github.com/repos/foo/keyboards/git/blobs/8ae17eca4bbc4676a0c0c7a8e2a51375',
              size: null,
              content: null,
              childTree: {
                'base_tree': null,
                sha: '8ae17eca4bbc4676a0c0c7a8e2a51375',
                url: 'https://api.github.com/repos/foo/keyboards/trees/8ae17eca4bbc4676a0c0c7a8e2a51375',
                tree: [
                  {
                    path: 'shan',
                    mode: GitHubTreeModes.subdirTree,
                    type: 'tree',
                    sha: 'e0307963c0c348869106747c5fe155e4',
                    size: null,
                    url: 'https://api.github.com/repos/foo/keyboards/git/blobs/e0307963c0c348869106747c5fe155e4',
                    content: null,
                    childTree: {
                      'base_tree': null,
                      sha: 'e0307963c0c348869106747c5fe155e4',
                      url: 'https://api.github.com/repos/foo/keyboards/trees/e0307963c0c348869106747c5fe155e4',
                      tree: [
                        {
                          path: 'README.md',
                          mode: GitHubTreeModes.fileBlob,
                          type: 'blob',
                          size: 438,
                          sha: '761b0e49dc264407b40e3b7ec6613a3b',
                          url: 'https://api.github.com/repos/foo/keyboards/git/blobs/761b0e49dc264407b40e3b7ec6613a3b',
                          content: null,
                          childTree: null,
                        },
                        {
                          path: 'source',
                          mode: GitHubTreeModes.subdirTree,
                          type: 'tree',
                          sha: 'aecefd114ec0427e81246386147a1d53',
                          size: null,
                          url: 'https://api.github.com/repos/foo/keyboards/git/blobs/aecefd114ec0427e81246386147a1d53',
                          content: null,
                          childTree: {
                            'base_tree': null,
                            sha: 'aecefd114ec0427e81246386147a1d53',
                            url: 'https://api.github.com/repos/foo/keyboards/trees/aecefd114ec0427e81246386147a1d53',
                            tree: [
                              {
                                path: 'shan.kps',
                                mode: GitHubTreeModes.fileBlob,
                                type: 'blob',
                                size: 4360,
                                sha: 'bb1f0dda56794a5fa2abaaa26f459d0a',
                                url: 'https://api.github.com/repos/foo/keyboards/git/blobs/bb1f0dda56794a5fa2abaaa26f459d0a',
                                content: null,
                                childTree: null,
                              },
                            ],
                            truncated: false,
                          }
                        },
                      ],
                      truncated: false,
                    },
                  },
                ],
                truncated: false,
              },
            },
            {
              path: 't',
              mode: GitHubTreeModes.subdirTree,
              type: 'tree',
              sha: '8f403a03f6974917a2ac6687f5eb88d0',
              url: 'https://api.github.com/repos/foo/keyboards/git/blobs/8f403a03f6974917a2ac6687f5eb88d0',
              size: null,
              content: null,
              childTree: null,
            },
          ],
          truncated: false,
        },
      },
    ],
    truncated: false,
    // #endregion
  };

  describe('getFullGitHubTreeForPath', () => {
    it('retrieves desired tree recursively', async () => {
      // Setup
      expect.assertions(1);

      // #region Mocked GitHub responses
      const result1: AxiosResponse = {
        data: {
          'base_tree': null,
          sha: '9fb037999f264ba9a7fc6274d15fa3ae2ab98312',
          url: 'https://api.github.com/repos/foo/keyboards/trees/9fb037999f264ba9a7fc6274d15fa3ae2ab98312',
          tree: [
            {
              path: 'build.sh',
              mode: '100755',
              type: 'blob',
              size: 3145,
              sha: '45b983be36b73c0788dc9cbcb76cbb80fc7bb057',
              url: 'https://api.github.com/repos/foo/keyboards/git/blobs/45b983be36b73c0788dc9cbcb76cbb80fc7bb057',
              childTree: null,
              content: null,
            },
            {
              path: 'README.md',
              mode: '100644',
              type: 'blob',
              size: 2849,
              sha: '44b4fc6d56897b048c772eb4087f854f46256132',
              url: 'https://api.github.com/repos/foo/keyboards/git/blobs/44b4fc6d56897b048c772eb4087f854f46256132',
              childTree: null,
              content: null,
            },
            {
              path: 'release',
              mode: '040000',
              type: 'tree',
              sha: 'f484d249c660418515fb01c2b9662073663c242e',
              url: 'https://api.github.com/repos/foo/keyboards/git/blobs/f484d249c660418515fb01c2b9662073663c242e',
              childTree: null,
              content: null,
            },
          ],
          truncated: false
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
      };
      const result2: AxiosResponse = {
        data: {
          'base_tree': null,
          sha: 'f484d249c660418515fb01c2b9662073663c242e',
          url: 'https://api.github.com/repos/foo/keyboards/trees/f484d249c660418515fb01c2b9662073663c242e',
          tree: [
            {
              path: 's',
              mode: '040000',
              type: 'tree',
              sha: '8ae17eca4bbc4676a0c0c7a8e2a51375',
              url: 'https://api.github.com/repos/foo/keyboards/git/blobs/8ae17eca4bbc4676a0c0c7a8e2a51375',
              childTree: null,
              content: null,
            },
            {
              path: 't',
              mode: '040000',
              type: 'tree',
              sha: '8f403a03f6974917a2ac6687f5eb88d0',
              url: 'https://api.github.com/repos/foo/keyboards/git/blobs/8f403a03f6974917a2ac6687f5eb88d0',
              childTree: null,
              content: null,
            },
          ],
          truncated: false
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
      };
      const result3: AxiosResponse = {
        data: {
          'base_tree': null,
          sha: '8ae17eca4bbc4676a0c0c7a8e2a51375',
          url: 'https://api.github.com/repos/foo/keyboards/trees/8ae17eca4bbc4676a0c0c7a8e2a51375',
          tree: [
            {
              path: 'shan',
              mode: '040000',
              type: 'tree',
              sha: 'e0307963c0c348869106747c5fe155e4',
              url: 'https://api.github.com/repos/foo/keyboards/git/blobs/e0307963c0c348869106747c5fe155e4',
              childTree: null,
              content: null,
            },
          ],
          truncated: false
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
      };
      const result4: AxiosResponse = {
        data: {
          'base_tree': null,
          sha: 'e0307963c0c348869106747c5fe155e4',
          url: 'https://api.github.com/repos/foo/keyboards/trees/e0307963c0c348869106747c5fe155e4',
          tree: [
            {
              path: 'README.md',
              mode: '100644',
              type: 'blob',
              size: 438,
              sha: '761b0e49dc264407b40e3b7ec6613a3b',
              url: 'https://api.github.com/repos/foo/keyboards/git/blobs/761b0e49dc264407b40e3b7ec6613a3b',
              childTree: null,
              content: null,
            },
            {
              path: 'source',
              mode: '040000',
              type: 'tree',
              sha: 'aecefd114ec0427e81246386147a1d53',
              url: 'https://api.github.com/repos/foo/keyboards/git/blobs/aecefd114ec0427e81246386147a1d53',
              childTree: null,
              content: null,
            },
          ],
          truncated: false
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
      };
      const result5: AxiosResponse = {
        data: {
          'base_tree': null,
          sha: 'aecefd114ec0427e81246386147a1d53',
          url: 'https://api.github.com/repos/foo/keyboards/trees/aecefd114ec0427e81246386147a1d53',
          tree: [
            {
              path: 'shan.kps',
              mode: '100644',
              type: 'blob',
              size: 4360,
              sha: 'bb1f0dda56794a5fa2abaaa26f459d0a',
              url: 'https://api.github.com/repos/foo/keyboards/git/blobs/bb1f0dda56794a5fa2abaaa26f459d0a',
              childTree: null,
              content: null,
            },
          ],
          truncated: false
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
      };
      // #endregion
      jest.spyOn(spyHttpService, 'get').mockImplementationOnce(() => of(result1));
      jest.spyOn(spyHttpService, 'get').mockImplementationOnce(() => of(result2));
      jest.spyOn(spyHttpService, 'get').mockImplementationOnce(() => of(result3));
      jest.spyOn(spyHttpService, 'get').mockImplementationOnce(() => of(result4));
      jest.spyOn(spyHttpService, 'get').mockImplementationOnce(() => of(result5));

      // Execute
      const result = await sut.getFullGitHubTreeForPath(
        '12345',
        'foo',
        'keyboards',
        '9fb037999f264ba9a7fc6274d15fa3ae2ab98312',
        'release/s/shan',
      ).toPromise();

      // Verify
      expect(result).toEqual(gitTree);
    });
  });

  describe('createTree', () => {
    let tmpDir: string;
    let repoDir: string;

    beforeEach(async () => {
      const prefix = path.join(os.tmpdir(), 'gitHubCreateTreeTests-');
      tmpDir = await mkdtemp(prefix).toPromise();
      repoDir = path.join(tmpDir, 'keyboards');
      jest.setTimeout(10000/* 10s */);
    });

    afterEach(() => {
      deleteFolderRecursive(tmpDir);
    });

    function createInitialRepo(): Observable<CommitSummary> {
      return gitService.createRepo(repoDir).pipe(
        switchMap(dir => {
          const release = path.join(dir, 'release');
          const shan = path.join(release, 's', 'shan');
          const source = path.join(shan, 'source');
          const t = path.join(release, 't');
          return forkJoin({
            release: mkdir(release),
            shan: mkdir(shan, { recursive: true }),
            source: mkdir(source, { recursive: true }),
            t: mkdir(t, { recursive: true }),
          });
        }),
        switchMap(dirs => {
          const buildsh = path.join(repoDir, 'build.sh');
          const readme = path.join(repoDir, 'README.md');
          const shanReadme = path.join(dirs.shan, 'README.md');
          const shankps = path.join(dirs.source, 'shan.kps');

          return forkJoin({
            buildsh: writeFile(buildsh, 'This pretends to be build.sh'),
            readme: writeFile(readme, 'This is the readme'),
            shanReadme: writeFile(shanReadme, 'Readme for Shan keyboard'),
            shankps: writeFile(shankps, 'The KPS file for shan'),
          });
        }),
        switchMap(files => forkJoin({
          buildsh: gitService.addFile(repoDir, files.buildsh),
          readme: gitService.addFile(repoDir, files.readme),
          shanReadme: gitService.addFile(repoDir, files.shanReadme),
          shankps: gitService.addFile(repoDir, files.shankps),
        })),
        switchMap(() => gitService.commit(repoDir, 'Initial commit')),
      );
    }

    function modifyRepo(): Observable<void> {
      return mkdir(path.join(repoDir, 'release', 's', 'shan', 'source', 'welcome')).pipe(
        switchMap(welcomeDir => writeFile(path.join(welcomeDir, 'welcome.htm'), 'This is welcome.htm')),
        switchMap(() => appendFile(path.join(repoDir, 'release', 's', 'shan', 'README.md'), '\nAddition to readme\n')),
        map(() => null),
      );
    }

    it('creates a new updated tree', async () => {
      // Setup
      // expect.assertions(1);
      await createInitialRepo().toPromise();
      await modifyRepo().toPromise();

      // #region Mocked GitHub responses
      const ghWelcomeTree: AxiosResponse = {
        data: {
          'base_tree': null,
          sha: '5cd1b6ee3b1e4ecfa467126f495b9efc',
          url: 'https://api.github.com/repos/foo/keyboards/trees/5cd1b6ee3b1e4ecfa467126f495b9efc',
          tree: [
            {
              path: 'welcome.htm',
              mode: GitHubTreeModes.fileBlob,
              type: 'blob',
              size: 2849,
              sha: '7a75e69975e048208f2bd04bb06a5a48',
              url: 'https://api.github.com/repos/foo/keyboards/git/blobs/7a75e69975e048208f2bd04bb06a5a48',
              childTree: null,
              content: null,
            },
          ],
          truncated: false
        },
        status: 201,
        statusText: 'Created',
        headers: {},
        config: {},
      };
      const ghSourceTree: AxiosResponse = {
        data: {
          'base_tree': null,
          sha: '9e1189ba907f4cfc900d93ebd62c3da3',
          url: 'https://api.github.com/repos/foo/keyboards/trees/9e1189ba907f4cfc900d93ebd62c3da3',
          tree: [
            {
              path: 'shan.kps',
              mode: GitHubTreeModes.fileBlob,
              type: 'blob',
              size: 4360,
              sha: 'bb1f0dda56794a5fa2abaaa26f459d0a',
              url: 'https://api.github.com/repos/foo/keyboards/git/blobs/bb1f0dda56794a5fa2abaaa26f459d0a',
              content: null,
              childTree: null,
            },
            {
              path: 'welcome',
              mode: GitHubTreeModes.subdirTree,
              type: 'tree',
              size: 0,
              sha: '5cd1b6ee3b1e4ecfa467126f495b9efc',
              url: 'https://api.github.com/repos/foo/keyboards/git/blobs/5cd1b6ee3b1e4ecfa467126f495b9efc',
              childTree: null,
              content: null,
            },
          ],
          truncated: false
        },
        status: 201,
        statusText: 'Created',
        headers: {},
        config: {},
      };
      const ghShanTree: AxiosResponse = {
        data: {
          'base_tree': null,
          sha: 'fead1f4a648a44e5a2f634c8ce0aea17',
          url: 'https://api.github.com/repos/foo/keyboards/trees/fead1f4a648a44e5a2f634c8ce0aea17',
          tree: [
            {
              path: 'README.md',
              mode: GitHubTreeModes.fileBlob,
              type: 'blob',
              size: 1234,
              sha: '9999f0fd2c924610be0763f99f06800b',
              url: 'https://api.github.com/repos/foo/keyboards/git/blobs/9999f0fd2c924610be0763f99f06800b',
              childTree: null,
              content: null,
            },
            {
              path: 'source',
              mode: GitHubTreeModes.subdirTree,
              type: 'tree',
              size: 0,
              sha: '9e1189ba907f4cfc900d93ebd62c3da3',
              url: 'https://api.github.com/repos/foo/keyboards/git/blobs/9e1189ba907f4cfc900d93ebd62c3da3',
              childTree: null,
              content: null,
            },
          ],
          truncated: false
        },
        status: 201,
        statusText: 'Created',
        headers: {},
        config: {},
      };
      const ghSTree: AxiosResponse = {
        data: {
          'base_tree': null,
          sha: 'b7fbe645bc1e4429b2a65c5bca7b3765',
          url: 'https://api.github.com/repos/foo/keyboards/trees/b7fbe645bc1e4429b2a65c5bca7b3765',
          tree: [
            {
              path: 'shan',
              mode: GitHubTreeModes.subdirTree,
              type: 'tree',
              size: 0,
              sha: 'fead1f4a648a44e5a2f634c8ce0aea17',
              url: 'https://api.github.com/repos/foo/keyboards/git/blobs/fead1f4a648a44e5a2f634c8ce0aea17',
              childTree: null,
              content: null,
            },
          ],
          truncated: false
        },
        status: 201,
        statusText: 'Created',
        headers: {},
        config: {},
      };
      const ghReleaseTree: AxiosResponse = {
        data: {
          'base_tree': null,
          sha: '6ccc6a1ab6c24ca8a0d0ab44f0ecd948',
          url: 'https://api.github.com/repos/foo/keyboards/trees/6ccc6a1ab6c24ca8a0d0ab44f0ecd948',
          tree: [
            {
              path: 's',
              mode: GitHubTreeModes.subdirTree,
              type: 'tree',
              size: 0,
              sha: 'b7fbe645bc1e4429b2a65c5bca7b3765',
              url: 'https://api.github.com/repos/foo/keyboards/git/blobs/b7fbe645bc1e4429b2a65c5bca7b3765',
              childTree: null,
              content: null,
            },
            {
              path: 't',
              mode: GitHubTreeModes.subdirTree,
              type: 'tree',
              sha: '8f403a03f6974917a2ac6687f5eb88d0',
              url: 'https://api.github.com/repos/foo/keyboards/git/blobs/8f403a03f6974917a2ac6687f5eb88d0',
              size: null,
              content: null,
              childTree: null,
            },
          ],
          truncated: false
        },
        status: 201,
        statusText: 'Created',
        headers: {},
        config: {},
      };
      const ghKeyboardsTree: AxiosResponse = {
        data: {
          'base_tree': null,
          sha: '6ccc6a1ab6c24ca8a0d0ab44f0ecd948',
          url: 'https://api.github.com/repos/foo/keyboards/trees/6ccc6a1ab6c24ca8a0d0ab44f0ecd948',
          tree: [
            {
              path: 'build.sh',
              mode: GitHubTreeModes.executableBlob,
              type: 'blob',
              size: 3145,
              sha: '45b983be36b73c0788dc9cbcb76cbb80fc7bb057',
              url: 'https://api.github.com/repos/foo/keyboards/git/blobs/45b983be36b73c0788dc9cbcb76cbb80fc7bb057',
              childTree: null,
              content: null,
            },
            {
              path: 'README.md',
              mode: GitHubTreeModes.subdirTree,
              type: 'blob',
              size: 2849,
              sha: '44b4fc6d56897b048c772eb4087f854f46256132',
              url: 'https://api.github.com/repos/foo/keyboards/git/blobs/44b4fc6d56897b048c772eb4087f854f46256132',
              childTree: null,
              content: null,
            },
            {
              path: 'release',
              mode: GitHubTreeModes.subdirTree,
              type: 'tree',
              size: 0,
              sha: '6ccc6a1ab6c24ca8a0d0ab44f0ecd948',
              url: 'https://api.github.com/repos/foo/keyboards/git/blobs/6ccc6a1ab6c24ca8a0d0ab44f0ecd948',
              childTree: null,
              content: null,
            },
          ],
          truncated: false
        },
        status: 201,
        statusText: 'Created',
        headers: {},
        config: {},
      };
      // #endregion
      jest.spyOn(spyHttpService, 'get').mockImplementationOnce(() => of(ghWelcomeTree));
      jest.spyOn(spyHttpService, 'get').mockImplementationOnce(() => of(ghSourceTree));
      jest.spyOn(spyHttpService, 'get').mockImplementationOnce(() => of(ghShanTree));
      jest.spyOn(spyHttpService, 'get').mockImplementationOnce(() => of(ghSTree));
      jest.spyOn(spyHttpService, 'get').mockImplementationOnce(() => of(ghReleaseTree));
      jest.spyOn(spyHttpService, 'get').mockImplementationOnce(() => of(ghKeyboardsTree));

      console.log(`repoDir=${repoDir}`);

      // Execute
      const result = await sut.createTree(
        repoDir,
        {
          changed: 2,
          deletions: 1,
          insertions: 2,
          files: [
            {
              file: 'release/s/shan/README.md',
              changes: 3,
              insertions: 2,
              deletions: 1,
              binary: false,
            },
            {
              file: 'release/s/shan/source/welcome/welcome.htm',
              changes: 1,
              insertions: 1,
              deletions: 0,
              binary: false,
            },
          ],
        },
        gitTree,
        'release/s/shan',
      ).toPromise();

      // Verify
      const expected = {
        // #region Expected created GitHub tree
        'base_tree': '9fb037999f264ba9a7fc6274d15fa3ae2ab98312',
        sha: '6ccc6a1ab6c24ca8a0d0ab44f0ecd948',
        url: 'https://api.github.com/repos/foo/keyboards/trees/6ccc6a1ab6c24ca8a0d0ab44f0ecd948',
        tree: [
          {
            path: 'release',
            mode: GitHubTreeModes.subdirTree,
            type: 'tree',
            size: 0,
            sha: '6ccc6a1ab6c24ca8a0d0ab44f0ecd948',
            url: 'https://api.github.com/repos/foo/keyboards/git/blobs/6ccc6a1ab6c24ca8a0d0ab44f0ecd948',
            childTree: {
              'base_tree': 'f484d249c660418515fb01c2b9662073663c242e',
              sha: '6ccc6a1ab6c24ca8a0d0ab44f0ecd948',
              url: 'https://api.github.com/repos/foo/keyboards/trees/6ccc6a1ab6c24ca8a0d0ab44f0ecd948',
              tree: [
                {
                  path: 's',
                  mode: GitHubTreeModes.subdirTree,
                  type: 'tree',
                  size: 0,
                  sha: 'b7fbe645bc1e4429b2a65c5bca7b3765',
                  url: 'https://api.github.com/repos/foo/keyboards/git/blobs/b7fbe645bc1e4429b2a65c5bca7b3765',
                  childTree: {
                    'base_tree': '8ae17eca4bbc4676a0c0c7a8e2a51375',
                    sha: 'b7fbe645bc1e4429b2a65c5bca7b3765',
                    url: 'https://api.github.com/repos/foo/keyboards/trees/b7fbe645bc1e4429b2a65c5bca7b3765',
                    tree: [
                      {
                        path: 'shan',
                        mode: GitHubTreeModes.subdirTree,
                        type: 'tree',
                        size: 0,
                        sha: 'fead1f4a648a44e5a2f634c8ce0aea17',
                        url: 'https://api.github.com/repos/foo/keyboards/git/blobs/fead1f4a648a44e5a2f634c8ce0aea17',
                        childTree: {
                          'base_tree': 'e0307963c0c348869106747c5fe155e4',
                          sha: 'fead1f4a648a44e5a2f634c8ce0aea17',
                          url: 'https://api.github.com/repos/foo/keyboards/trees/fead1f4a648a44e5a2f634c8ce0aea17',
                          tree: [
                            {
                              path: 'README.md',
                              mode: GitHubTreeModes.fileBlob,
                              type: 'blob',
                              size: 1234,
                              sha: '9999f0fd2c924610be0763f99f06800b',
                              url: 'https://api.github.com/repos/foo/keyboards/git/blobs/9999f0fd2c924610be0763f99f06800b',
                              childTree: null,
                              content: null,
                            },
                            {
                              path: 'source',
                              mode: GitHubTreeModes.subdirTree,
                              type: 'tree',
                              size: 0,
                              sha: '9e1189ba907f4cfc900d93ebd62c3da3',
                              url: 'https://api.github.com/repos/foo/keyboards/git/blobs/9e1189ba907f4cfc900d93ebd62c3da3',
                              childTree: {
                                'base_tree': 'aecefd114ec0427e81246386147a1d53',
                                sha: '9e1189ba907f4cfc900d93ebd62c3da3',
                                url: 'https://api.github.com/repos/foo/keyboards/trees/9e1189ba907f4cfc900d93ebd62c3da3',
                                tree: [
                                  {
                                    path: 'welcome',
                                    mode: GitHubTreeModes.subdirTree,
                                    type: 'tree',
                                    size: 0,
                                    sha: '5cd1b6ee3b1e4ecfa467126f495b9efc',
                                    url: 'https://api.github.com/repos/foo/keyboards/git/blobs/5cd1b6ee3b1e4ecfa467126f495b9efc',
                                    childTree: {
                                      'base_tree': null,
                                      sha: '5cd1b6ee3b1e4ecfa467126f495b9efc',
                                      url: 'https://api.github.com/repos/foo/keyboards/trees/5cd1b6ee3b1e4ecfa467126f495b9efc',
                                      tree: [
                                        {
                                          path: 'welcome.htm',
                                          mode: GitHubTreeModes.fileBlob,
                                          type: 'blob',
                                          size: 2849,
                                          sha: '7a75e69975e048208f2bd04bb06a5a48',
                                          url: 'https://api.github.com/repos/foo/keyboards/git/blobs/7a75e69975e048208f2bd04bb06a5a48',
                                          childTree: null,
                                          content: null,
                                        },
                                      ],
                                      truncated: false

                                    },
                                    content: null,
                                  },
                                ],
                                truncated: false
                              },
                              content: null,
                            },
                          ],
                          truncated: false
                        },
                        content: null,
                      },
                    ],
                    truncated: false
                  },
                  content: null,
                },
              ],
              truncated: false

            },
            content: null,
          },
        ],
        truncated: false
        // # endregion
      }

      expect(result).toEqual(expected);
    });

    it('creates new updated tree when files got deleted', () => {
      // test with deleted files
      expect(true).toBe(false);
    });

    it('fails if commit has changes outside of path', async () => {
      // Setup
      expect.assertions(1);

      // Execute
      const result = await sut.createTree(
        repoDir,
        {
          changed: 1,
          deletions: 0,
          insertions: 1,
          files: [
            {
              file: 'README.md',
              changes: 1,
              insertions: 1,
              deletions: 0,
              binary: false,
            },
          ],
        },
        gitTree,
        'release/s/shan',
      ).toPromise();

      // Verify
      // verify that we get a failure
    });
  });

  describe('addTree', () => {
    let tmpDir: string;
    let repoDir: string;

    beforeEach(async () => {
      const prefix = path.join(os.tmpdir(), 'gitHubAddTreeTests-');
      tmpDir = await mkdtemp(prefix).toPromise();
      repoDir = path.join(tmpDir, 'keyboards');
      jest.setTimeout(10000/* 10s */);
    });

    afterEach(() => {
      deleteFolderRecursive(tmpDir);
    });

    function createInitialDir(): Observable<string> {
      return mkdir(path.join(repoDir, 'release', 's', 'shan'), { recursive: true }).pipe(
        switchMap(dir => {
          const shanReadme = path.join(dir, 'README');

          return writeFile(shanReadme, 'Readme for Shan keyboard');
        }),
      );
    }

    it('constructs tree', async () => {
      // Setup
      await createInitialDir().toPromise();

      // Execute
      const result = await sut.addTree(repoDir, {}, '', 'release/s/shan/README', {
        file: 'release/s/shan/README',
        changes: 3,
        insertions: 2,
        deletions: 1,
        binary: false,
      }).toPromise();

      // Verify
      expect(result).toEqual({
        release: {
          s: {
            shan: {
              README: {
                content: 'Readme for Shan keyboard',
                mode: '100644',
                path: 'README',
                sha: null,
                size: 24,
                type: 'blob',
              }
            }
          }
        }
      });
    });
  });

  describe('isFileAdded', () => {
    let tmpDir: string;

    beforeEach(async () => {
      const prefix = path.join(os.tmpdir(), 'gitHubIsFileAddedTests-');
      tmpDir = await mkdtemp(prefix).toPromise();
      const file = path.join(tmpDir, 'README.md');
      await writeFile(file, 'First line').toPromise();
    });

    afterEach(() => {
      deleteFolderRecursive(tmpDir);
    });

    it('returns true for an added text file', () => {
      // Setup
      expect.assertions(1);

      // Execute/Verify
      expect(sut.isFileAdded(
        tmpDir,
        {
          file: 'README.md',
          changes: 1,
          insertions: 1,
          deletions: 0,
          binary: false,
        },
      )).toBe(true);
    });

    it('returns true for an added binary file', () => {
      // Setup
      expect.assertions(1);

      // Execute/Verify
      expect(sut.isFileAdded(
        tmpDir,
        {
          file: 'lib.so',
          before: 0,
          after: 34548,
          binary: true,
        },
      )).toBe(true);
    });

    it('returns false for a changed text file', () => {
      // Setup
      expect.assertions(1);

      // Execute/Verify
      expect(sut.isFileAdded(
        tmpDir,
        {
          file: 'README.md',
          changes: 2,
          insertions: 1,
          deletions: 1,
          binary: false,
        })).toBe(false);
    });

    it('returns false for a changed binary file', () => {
      // Setup
      expect.assertions(1);

      // Execute/Verify
      expect(sut.isFileAdded(
        tmpDir,
        {
          file: 'lib.so',
          before: 69486,
          after: 34548,
          binary: true,
        },
      )).toBe(false);
    });

    it('returns false for a changed text file with one line removed', () => {
      // Setup
      expect.assertions(1);

      // Execute/Verify
      expect(sut.isFileAdded(
        tmpDir,
        {
          file: 'README.md',
          changes: 1,
          insertions: 0,
          deletions: 1,
          binary: false,
        },
      )).toBe(false);
    });

    it('returns false for a deleted text file', async () => {
      // Setup
      expect.assertions(1);
      const file = path.join(tmpDir, 'README.md');
      await deleteFile(file).toPromise();

      // Execute/Verify
      expect(sut.isFileAdded(
        tmpDir,
        {
          file: 'README.md',
          changes: 1,
          insertions: 0,
          deletions: 1,
          binary: false,
        },
      )).toBe(false);
    });

    it('returns false for a deleted binary file', () => {
      // Setup
      expect.assertions(1);

      // Execute/Verify
      expect(sut.isFileAdded(
        tmpDir,
        {
          file: 'lib.so',
          before: 69486,
          after: 0,
          binary: true,
        },
      )).toBe(false);
    });
  });

  describe('isFileModified', () => {
    let tmpDir: string;

    beforeEach(async () => {
      const prefix = path.join(os.tmpdir(), 'gitHubIsFileModifiedTests-');
      tmpDir = await mkdtemp(prefix).toPromise();
      const file = path.join(tmpDir, 'README.md');
      await writeFile(file, 'First line').toPromise();
    });

    afterEach(() => {
      deleteFolderRecursive(tmpDir);
    });

    it('returns false for an added text file', () => {
      // Setup
      expect.assertions(1);

      // Execute/Verify
      expect(sut.isFileModified(
        tmpDir,
        {
          file: 'README.md',
          changes: 1,
          insertions: 1,
          deletions: 0,
          binary: false,
        },
      )).toBe(false);
    });

    it('returns false for an added binary file', () => {
      // Setup
      expect.assertions(1);

      // Execute/Verify
      expect(sut.isFileModified(
        tmpDir,
        {
          file: 'lib.so',
          before: 0,
          after: 34548,
          binary: true,
        },
      )).toBe(false);
    });

    it('returns true for a changed text file', () => {
      // Setup
      expect.assertions(1);

      // Execute/Verify
      expect(sut.isFileModified(
        tmpDir,
        {
          file: 'README.md',
          changes: 2,
          insertions: 1,
          deletions: 1,
          binary: false,
        },
      )).toBe(true);
    });

    it('returns true for a changed binary file', () => {
      // Setup
      expect.assertions(1);

      // Execute/Verify
      expect(sut.isFileModified(
        tmpDir,
        {
          file: 'lib.so',
          before: 69486,
          after: 34548,
          binary: true,
        },
      )).toBe(true);
    });

    it('returns true for a changed text file with one line removed', () => {
      // Setup
      expect.assertions(1);

      // Execute/Verify
      expect(sut.isFileModified(
        tmpDir,
        {
          file: 'README.md',
          changes: 1,
          insertions: 0,
          deletions: 1,
          binary: false,
        },
      )).toBe(true);
    });

    it('returns false for a deleted text file', async () => {
      // Setup
      expect.assertions(1);
      const file = path.join(tmpDir, 'README.md');
      await deleteFile(file).toPromise();

      // Execute/Verify
      expect(sut.isFileModified(
        tmpDir,
        {
          file: 'README.md',
          changes: 1,
          insertions: 0,
          deletions: 1,
          binary: false,
        },
      )).toBe(false);
    });

    it('returns false for a deleted binary file', () => {
      // Setup
      expect.assertions(1);

      // Execute/Verify
      expect(sut.isFileModified(
        tmpDir,
        {
          file: 'lib.so',
          before: 69486,
          after: 0,
          binary: true,
        },
      )).toBe(false);
    });
  });

  describe('isFileDeleted', () => {
    let tmpDir: string;

    beforeEach(async () => {
      const prefix = path.join(os.tmpdir(), 'gitHubIsFileDeletedTests-');
      tmpDir = await mkdtemp(prefix).toPromise();
      const file = path.join(tmpDir, 'README.md');
      await writeFile(file, 'First line').toPromise();
    });

    afterEach(() => {
      deleteFolderRecursive(tmpDir);
    });

    it('returns false for an added text file', () => {
      // Setup
      expect.assertions(1);

      // Execute/Verify
      expect(sut.isFileDeleted(
        tmpDir,
        {
          file: 'README.md',
          changes: 1,
          insertions: 1,
          deletions: 0,
          binary: false,
        },
      )).toBe(false);
    });

    it('returns false for an added binary file', () => {
      // Setup
      expect.assertions(1);

      // Execute/Verify
      expect(sut.isFileDeleted(
        tmpDir,
        {
          file: 'lib.so',
          before: 0,
          after: 34548,
          binary: true,
        },
      )).toBe(false);
    });

    it('returns false for a changed text file', () => {
      // Setup
      expect.assertions(1);

      // Execute/Verify
      expect(sut.isFileDeleted(
        tmpDir,
        {
          file: 'README.md',
          changes: 2,
          insertions: 1,
          deletions: 1,
          binary: false,
        },
      )).toBe(false);
    });

    it('returns false for a changed binary file', () => {
      // Setup
      expect.assertions(1);

      // Execute/Verify
      expect(sut.isFileDeleted(
        tmpDir,
        {
          file: 'lib.so',
          before: 69486,
          after: 34548,
          binary: true,
        },
      )).toBe(false);
    });

    it('returns false for a changed text file with one line removed', () => {
      // Setup
      expect.assertions(1);

      // Execute/Verify
      expect(sut.isFileDeleted(
        tmpDir,
        {
          file: 'README.md',
          changes: 1,
          insertions: 0,
          deletions: 1,
          binary: false,
        },
      )).toBe(false);
    });

    it('returns true for a deleted text file', async () => {
      // Setup
      expect.assertions(1);
      const file = path.join(tmpDir, 'README.md');
      await deleteFile(file).toPromise();

      // Execute/Verify
      expect(sut.isFileDeleted(
        tmpDir,
        {
          file: 'README.md',
          changes: 1,
          insertions: 0,
          deletions: 1,
          binary: false,
        },
      )).toBe(true);
    });

    it('returns true for a deleted binary file', () => {
      // Setup
      expect.assertions(1);

      // Execute/Verify
      expect(sut.isFileDeleted(
        tmpDir,
        {
          file: 'lib.so',
          before: 69486,
          after: 0,
          binary: true,
        },
      )).toBe(true);
    });
  });
});
