/**
 * Minimal mock contract server for SDK integration tests.
 * Accepts any POST /invoke request and returns a success response.
 */
import * as http from "http";

export interface MockServer {
  url: string;
  close: () => Promise<void>;
  requestCount: number;
}

export function startMockServer(port = 0): Promise<MockServer> {
  return new Promise((resolve, reject) => {
    let requestCount = 0;

    const server = http.createServer((_req, res) => {
      requestCount++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    });

    server.listen(port, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        get url() {
          return `http://127.0.0.1:${addr.port}`;
        },
        close: () =>
          new Promise((res, rej) => server.close((err) => (err ? rej(err) : res()))),
        get requestCount() {
          return requestCount;
        },
      });
    });

    server.on("error", reject);
  });
}
