export function decodeJwtExpiration(token: string): number | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof parsed.exp === "number" ? parsed.exp : undefined;
  } catch {
    return undefined;
  }
}

export function assertTokenUsable(token: string): void {
  const expiration = decodeJwtExpiration(token);
  if (expiration !== undefined && expiration <= Math.floor(Date.now() / 1000)) {
    throw new Error("AUTH_EXPIRED: Morningstar token has expired; refresh MORNINGSTAR_TOKEN or auth.json");
  }
}

export function normalizeIncomingToken(value: string | string[] | undefined): string | undefined {
  const token = (Array.isArray(value) ? value[0] : value)?.trim();
  if (!token) return undefined;
  assertTokenUsable(token);
  return token;
}
