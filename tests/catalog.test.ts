import { describe, expect, it } from "vitest";
import { findScreenerFields, loadScreenerCatalog, validateScreenerFilters } from "../src/catalog.js";

describe("screener catalog", () => {
  it("loads all extracted request fields", async () => {
    const catalog = await loadScreenerCatalog();
    expect(catalog.summary).toEqual({ groupCount: 7, controlCount: 54, requestFieldCount: 216 });
    expect(catalog.requestFields).toHaveLength(216);
  });

  it("searches by Chinese label", async () => {
    const result = await findScreenerFields("晨星评级");
    expect(result.fields.length).toBeGreaterThan(0);
    expect(result.fields.some((field) => field.labels.some((label) => label.includes("晨星评级")))).toBe(true);
  });

  it("accepts known fields and rejects arbitrary fields", async () => {
    const catalog = await loadScreenerCatalog();
    const field = catalog.requestFields[0]?.field;
    expect(field).toBeTruthy();
    await expect(validateScreenerFilters({ [field as string]: "test" })).resolves.toBeUndefined();
    await expect(validateScreenerFilters({ __proto_pollution: "x" })).rejects.toThrow(
      "Unknown screener filter field",
    );
  });
});
