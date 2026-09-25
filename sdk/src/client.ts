import { VERSION } from "./index";

export interface RpcRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export type RpcFetch = (
  url: string,
  init: RpcRequestInit,
) => Promise<{ json(): Promise<unknown> }>;

export interface RpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class LumenFlowClient {
  private nextRequestId = 1;

  constructor(
    private readonly rpcUrl: string,
    private readonly fetcher: RpcFetch,
  ) {}

  async call(method: string, params: unknown[] = []): Promise<unknown> {
    const response = (await this.fetcher(this.rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SDK-Version": VERSION,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: this.nextRequestId++,
        method,
        params,
      }),
    })) as { json(): Promise<RpcResponse> };
    const payload = await response.json();

    if (payload.error) {
      throw new Error(payload.error.message);
    }

    return payload.result;
  }
}
