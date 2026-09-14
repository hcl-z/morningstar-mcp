import { describe, expect, it, vi } from "vitest";
import { MorningstarClient } from "../src/client.js";

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("MorningstarClient", () => {
  it("uses Morningstar custom auth and request ID headers", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      response({ _meta: { response_status: "200011" }, data: { ok: true } }),
    );
    const client = new MorningstarClient({ token: "not-a-jwt", fetch: fetchMock });

    await expect(client.request("/cn-api/test", { requireAuth: true })).resolves.toEqual({ ok: true });
    const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("token")).toBe("not-a-jwt");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-api-requestid")).toMatch(/^[0-9A-F-]{36}$/);
  });

  it("maps Morningstar business failures even when HTTP status is 200", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      response({ _meta: { response_status: "400001", response_hint: "data not found" }, data: null }),
    );
    const client = new MorningstarClient({ token: "not-a-jwt", fetch: fetchMock });

    await expect(client.request("/cn-api/test")).rejects.toMatchObject({
      name: "MorningstarError",
      code: "BUSINESS_ERROR",
      message: "data not found",
    });
  });

  it("sends the configured token even for otherwise public endpoints", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      response({ _meta: { response_status: "200011" }, data: [] }),
    );
    const client = new MorningstarClient({ token: "user-token", fetch: fetchMock });

    await client.request("/cn-api/public/v1/fund-cache?match=test");
    const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(new Headers(init.headers).get("token")).toBe("user-token");
  });

  it("rejects oversized responses before parsing", async () => {
    const body = JSON.stringify({ _meta: { response_status: "200011" }, data: { value: "large" } });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(body, { headers: { "content-length": String(Buffer.byteLength(body)) } }),
    );
    const client = new MorningstarClient({ token: "not-a-jwt", fetch: fetchMock });

    await expect(client.request("/cn-api/test", { maxBytes: 10 })).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
    });
  });

  it("blocks paths outside the discovered read-only API prefix", async () => {
    const client = new MorningstarClient({ token: "not-a-jwt", fetch: vi.fn<typeof fetch>() });
    await expect(client.request("https://example.com/steal")).rejects.toMatchObject({ code: "INVALID_PATH" });
  });
});
