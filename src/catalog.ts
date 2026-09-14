import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ScreenerCatalog } from "./types.js";

let cachedCatalog: ScreenerCatalog | undefined;

export async function loadScreenerCatalog(): Promise<ScreenerCatalog> {
  if (cachedCatalog) return cachedCatalog;
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(currentDirectory, "../docs/screener-fields.json"),
    resolve(currentDirectory, "../../docs/screener-fields.json"),
    resolve(process.cwd(), "docs/screener-fields.json"),
  ];
  for (const path of candidates) {
    try {
      await access(path);
      cachedCatalog = JSON.parse(await readFile(path, "utf8")) as ScreenerCatalog;
      return cachedCatalog;
    } catch {
      // Try the next development or packaged location.
    }
  }
  throw new Error("Cannot locate docs/screener-fields.json");
}

export async function validateScreenerFilters(filters: Record<string, unknown>): Promise<void> {
  const catalog = await loadScreenerCatalog();
  const allowed = new Set(catalog.requestFields.map((field) => field.field));
  allowed.add("sign");
  const unknown = Object.keys(filters).filter((field) => !allowed.has(field));
  if (unknown.length > 0) {
    throw new Error(`Unknown screener filter field(s): ${unknown.join(", ")}`);
  }
}

export async function findScreenerFields(query?: string) {
  const catalog = await loadScreenerCatalog();
  const normalized = query?.trim().toLowerCase();
  const fields = normalized
    ? catalog.requestFields.filter((field) =>
        [field.field, ...field.labels].some((value) => value.toLowerCase().includes(normalized)),
      )
    : catalog.requestFields;
  return {
    summary: catalog.summary,
    fields: fields.slice(0, normalized ? 100 : 40),
    truncated: fields.length > (normalized ? 100 : 40),
  };
}
