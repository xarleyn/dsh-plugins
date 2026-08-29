import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export function hashString(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

export async function hashFile(path: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha1');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') resolve(undefined);
      else reject(error);
    });
  });
}
