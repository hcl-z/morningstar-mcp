export interface ApiMeta {
  response_status?: string;
  response_hint?: string;
}

export interface ApiEnvelope<T> {
  _meta?: ApiMeta;
  data: T;
}

export interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  requireAuth?: boolean;
  maxBytes?: number;
  signal?: AbortSignal;
}

export interface ClientOptions {
  token: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxConcurrency?: number;
  fetch?: typeof globalThis.fetch;
}

export interface ScreenerCatalog {
  source: string;
  summary: {
    groupCount: number;
    controlCount: number;
    requestFieldCount: number;
  };
  groups: Array<{
    label: string;
    controls: Array<{
      label?: string;
      requestFields: Array<{ field: string }>;
    }>;
  }>;
  requestFields: Array<{
    field: string;
    labels: string[];
    valueType?: string;
    unit?: string | null;
    examples?: unknown;
  }>;
}

export type JsonRecord = Record<string, unknown>;
