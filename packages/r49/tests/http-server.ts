import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A local HTTP server over files in memory, for reading an archive over a URL. */
export interface Served {
  url: string;
  /** Each path requested, decoded, in order. */
  requests: string[];
  close(): Promise<void>;
}

/** Serves `files` by path; answers 500 for a path in `failing`, 404 for the rest. */
export async function serve(files: Record<string, Uint8Array>, failing: readonly string[] = []): Promise<Served> {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).replace(/^\//, '');
    requests.push(path);
    const body = files[path];
    if (failing.includes(path)) res.writeHead(500).end();
    else if (body === undefined) res.writeHead(404).end();
    else res.writeHead(200).end(body);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close(err => (err ? reject(err) : resolve()));
      }),
  };
}
