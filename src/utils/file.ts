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

export function mkdir(dirName: string, options?: any): Observable<void> {
  const mkdirAsObservable = bindNodeCallback(
    (dir: string, callback: (error: Error) => void) =>
      fs.mkdir(dir, callback),
  );
  const mkdirWithOptionAsObservable = bindNodeCallback(
    (dir: string, opts: any, callback: (error: Error) => void) =>
      fs.mkdir(dir, opts, callback),
  );
  if (options) {
    return mkdirWithOptionAsObservable(dirName, options);
  }
  return mkdirAsObservable(dirName);
}

export function readFile(fileName: string): Observable<string> {
  const readFileAsObservable = bindNodeCallback(fs.readFile);
  return readFileAsObservable(fileName).pipe(
    map(data => data.toString()),
  );
}

export function writeFile(fileName: string, content: string): Observable<void> {
  const writeFileAsObservable = bindNodeCallback(fs.writeFile);
  return writeFileAsObservable(fileName, content);
}

export function appendFile(fileName: string, content: string): Observable<void> {
  const appendFileAsObservable = bindNodeCallback(fs.appendFile);
  return appendFileAsObservable(fileName, content);
}

export function mkdtemp(prefix: string): Observable<string> {
  const mkdtempAsObservable = bindNodeCallback(fs.mkdtemp);
  return mkdtempAsObservable(prefix);
}
