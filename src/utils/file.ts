import { bindNodeCallback, Observable, of } from 'rxjs';
import fs = require('fs');
import { map, catchError } from 'rxjs/operators';

export function fileExists(
  fileName: string,
): Observable<boolean> {
    const fileExistsAsObservable = bindNodeCallback(
      (dir: string, callback: (error: Error) => void) =>
        fs.access(dir, fs.constants.F_OK, callback),
    );
    return fileExistsAsObservable(fileName).pipe(
      map(() => true),
      catchError(() => of(false)),
    );
}

export function mkdir(dirName: string, options?: any): Observable<string> {
  const mkdirAsObservable = bindNodeCallback(fs.mkdir);
  const mkdirWithOptionAsObservable = bindNodeCallback(
    (dir: string, opts: any, callback: (error: Error) => void) =>
      fs.mkdir(dir, opts, callback),
  );
  if (options) {
    return mkdirWithOptionAsObservable(dirName, options).pipe(
      map(() => dirName),
    );
  }
  return mkdirAsObservable(dirName).pipe(
    map(() => dirName),
  );
}

export function readFile(fileName: string, encoding = 'utf8'): Observable<string> {
  // use `encoding = 'base64'` to base-64 encode
  const readFileAsObservable = bindNodeCallback(fs.readFile);
  return readFileAsObservable(fileName).pipe(
    map(data => data.toString(encoding)),
  );
}

export function writeFile(fileName: string, content: string): Observable<string> {
  const writeFileAsObservable = bindNodeCallback(fs.writeFile);
  return writeFileAsObservable(fileName, content).pipe(
    map(() => fileName),
  );
}

export function appendFile(fileName: string, content: string): Observable<string> {
  const appendFileAsObservable = bindNodeCallback(fs.appendFile);
  return appendFileAsObservable(fileName, content).pipe(
    map(() => fileName),
  )
}

export function mkdtemp(prefix: string): Observable<string> {
  const mkdtempAsObservable = bindNodeCallback(fs.mkdtemp);
  return mkdtempAsObservable(prefix);
}

export function deleteFile(fileName: string): Observable<string> {
  const unlinkAsObservable = bindNodeCallback(fs.unlink);
  return unlinkAsObservable(fileName).pipe(
    map(() => fileName),
  );
}

export function stat(fileName: string): Observable<fs.Stats> {
  const statAsObservable = bindNodeCallback(
    (path: fs.PathLike, options: fs.StatOptions, callback: (err: Error, stats: fs.Stats) => void) =>
      fs.stat(path, options, callback));

  return statAsObservable(fileName, { bigint: false });
}
