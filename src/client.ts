import type { ApiEnvelope, ClientOptions, RequestOptions } from "./types.js";

const DEFAULT_BASE_URL = "https://www.morningstar.cn";
const SUCCESS_STATUS = "200011";

export class MorningstarError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "MorningstarError";
  }
}

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}

export class MorningstarClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly semaphore: Semaphore;
  private readonly token: string;

  constructor(options: ClientOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 2_000_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.semaphore = new Semaphore(options.maxConcurrency ?? 4);
    this.token = options.token;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (!path.startsWith("/cn-api/")) {
      throw new MorningstarError("Only /cn-api/ paths are allowed", "INVALID_PATH");
    }

    const token = this.token;

    return this.semaphore.run(async () => {
      const timeoutController = new AbortController();
      const timeout = setTimeout(() => timeoutController.abort(), this.timeoutMs);
      const combinedSignal = options.signal
        ? AbortSignal.any([options.signal, timeoutController.signal])
        : timeoutController.signal;
      const headers = new Headers({
        accept: "application/json, text/plain, */*",
        "user-agent": "morningstar-cn-mcp/0.1.0",
        "x-api-requestid": crypto.randomUUID().toUpperCase(),
      });
      headers.set("token", token);
      if (options.body !== undefined) headers.set("content-type", "application/json");

      try {
        const requestInit: RequestInit = {
          method: options.method ?? (options.body === undefined ? "GET" : "POST"),
          headers,
          signal: combinedSignal,
        };
        if (options.body !== undefined) requestInit.body = JSON.stringify(options.body);
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, requestInit);

        if (!response.ok) {
          const errorText = (await response.text()).slice(0, 500);
          const code = response.status === 401 || response.status === 403 ? "AUTH_FAILED" : "HTTP_ERROR";
          throw new MorningstarError(
            `Morningstar HTTP ${response.status}`,
            code,
            response.status,
            errorText,
          );
        }

        const maxBytes = options.maxBytes ?? this.maxResponseBytes;
        const text = await readTextWithLimit(response, maxBytes);
        let envelope: ApiEnvelope<T>;
        try {
          envelope = JSON.parse(text) as ApiEnvelope<T>;
        } catch {
          throw new MorningstarError("Morningstar returned invalid JSON", "INVALID_RESPONSE");
        }
        const businessStatus = envelope._meta?.response_status;
        if (businessStatus && businessStatus !== SUCCESS_STATUS) {
          throw new MorningstarError(
            envelope._meta?.response_hint ?? `Morningstar business error ${businessStatus}`,
            "BUSINESS_ERROR",
            response.status,
            envelope._meta,
          );
        }
        return envelope.data;
      } catch (error) {
        if (error instanceof MorningstarError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new MorningstarError("Morningstar request timed out or was cancelled", "TIMEOUT");
        }
        throw new MorningstarError(
          error instanceof Error ? error.message : "Morningstar request failed",
          "NETWORK_ERROR",
        );
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  async requestBinary(path: string, maxBytes = 15_000_000): Promise<Uint8Array> {
    if (!path.startsWith("/cn-api/")) {
      throw new MorningstarError("Only /cn-api/ paths are allowed", "INVALID_PATH");
    }
    const token = this.token;
    return this.semaphore.run(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const headers = new Headers({
          accept: "application/pdf, application/octet-stream",
          "user-agent": "morningstar-cn-mcp/0.1.0",
          "x-api-requestid": crypto.randomUUID().toUpperCase(),
        });
        headers.set("token", token);
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          headers,
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new MorningstarError(`Morningstar HTTP ${response.status}`, "HTTP_ERROR", response.status);
        }
        const length = Number(response.headers.get("content-length") ?? 0);
        if (length > maxBytes) {
          throw new MorningstarError(`Response exceeds ${maxBytes} bytes`, "RESPONSE_TOO_LARGE");
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > maxBytes) {
          throw new MorningstarError(`Response exceeds ${maxBytes} bytes`, "RESPONSE_TOO_LARGE");
        }
        return bytes;
      } catch (error) {
        if (error instanceof MorningstarError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new MorningstarError("Morningstar request timed out", "TIMEOUT");
        }
        throw new MorningstarError(
          error instanceof Error ? error.message : "Morningstar request failed",
          "NETWORK_ERROR",
        );
      } finally {
        clearTimeout(timeout);
      }
    });
  }
}

async function readTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) {
    throw new MorningstarError(`Response exceeds ${maxBytes} bytes`, "RESPONSE_TOO_LARGE");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let result = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new MorningstarError(`Response exceeds ${maxBytes} bytes`, "RESPONSE_TOO_LARGE");
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
