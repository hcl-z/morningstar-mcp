import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { findScreenerFields, loadScreenerCatalog, validateScreenerFilters } from "./catalog.js";
import { MorningstarClient, MorningstarError } from "./client.js";
import type { JsonRecord } from "./types.js";

const FUND_CODE = /^\d{6}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const readOnlyAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;
const outputSchema = { data: z.unknown() };

function result(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: { data },
  };
}

function toolError(error: unknown) {
  const payload =
    error instanceof MorningstarError
      ? { error: error.code, message: error.message, status: error.status, details: error.details }
      : { error: "TOOL_ERROR", message: error instanceof Error ? error.message : String(error) };
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

async function safeTool(operation: () => Promise<unknown>) {
  try {
    return result(await operation());
  } catch (error) {
    return toolError(error);
  }
}

function query(parameters: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  return search.toString();
}

function selectObject(source: unknown, keys: string[]): JsonRecord {
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const record = source as JsonRecord;
  return Object.fromEntries(keys.filter((key) => key in record).map((key) => [key, record[key]]));
}

function thinArray<T>(values: T[], maxPoints: number): T[] {
  if (values.length <= maxPoints) return values;
  if (maxPoints <= 1) return [values[values.length - 1] as T];
  return Array.from({ length: maxPoints }, (_, index) => {
    const sourceIndex = Math.round((index * (values.length - 1)) / (maxPoints - 1));
    return values[sourceIndex] as T;
  });
}

function thinGrowthData(value: unknown, maxPoints: number): unknown {
  if (!value || typeof value !== "object") return value;
  const data = structuredClone(value as JsonRecord);
  const tsData = data.tsData as JsonRecord | undefined;
  if (tsData) {
    for (const key of ["dates", "catAvg", "bmk1"]) {
      if (Array.isArray(tsData[key])) tsData[key] = thinArray(tsData[key], maxPoints);
    }
    if (Array.isArray(tsData.funds)) {
      tsData.funds = tsData.funds.map((series) =>
        Array.isArray(series) ? thinArray(series, maxPoints) : series,
      );
    }
  }
  return data;
}

function subtractDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

const dayEndPeriodToScreenerField = {
  M1: "return1Month_M",
  M3: "return3Month_M",
  M6: "return6Month_M",
  YTD: "returnYTD_M",
  Y1: "return1Year_M",
} as const;

type DayEndPeriod = keyof typeof dayEndPeriodToScreenerField;

const fundCategoryIds = {
  pureBond: "CHCA000023",
  shortBond: "PGSZB2TTTT",
  rateBond: "CHCA000048",
  creditBond: "CHCA000049",
  ordinaryBond: "PGSZA2TTTT",
  activeBond: "PGSZB5TTTT",
  convertibleBond: "CHCA000024",
} as const;

function numericValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function registerTools(server: McpServer, client: MorningstarClient): void {
  server.registerTool(
    "search_funds",
    {
      title: "搜索晨星中国基金",
      description: "按基金代码或名称搜索中国内地基金，返回基金代码、名称、内部 ID 和类型。",
      inputSchema: {
        query: z.string().trim().min(1).max(80).describe("基金代码或名称"),
        limit: z.number().int().min(1).max(50).default(20),
      },
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    ({ query: term, limit }) =>
      safeTool(async () => {
        const data = await client.request<unknown[]>(
          `/cn-api/public/v1/fund-cache?${query({ match: term })}`,
        );
        return data.slice(0, limit);
      }),
  );

  server.registerTool(
    "search_managers",
    {
      title: "搜索晨星基金经理",
      description: "按姓名搜索基金经理，返回经理 ID、姓名、基金公司和管理规模。",
      inputSchema: {
        query: z.string().trim().min(1).max(40),
        limit: z.number().int().min(1).max(50).default(20),
      },
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    ({ query: term, limit }) =>
      safeTool(async () => {
        const data = await client.request<unknown[]>(
          `/cn-api/public/v2/fund-cache?${query({ match: term, target: "manager" })}`,
        );
        return data.slice(0, limit);
      }),
  );

  server.registerTool(
    "list_screener_fields",
    {
      title: "查询基金筛选字段",
      description: "列出晨星筛选器支持的字段、中文标签、值类型、单位和枚举。可用中文或字段名检索。",
      inputSchema: { query: z.string().trim().max(80).optional() },
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    ({ query: term }) => safeTool(() => findScreenerFields(term)),
  );

  server.registerTool(
    "screen_funds",
    {
      title: "筛选晨星中国基金",
      description:
        "使用晨星筛选字段查询基金。先调用 list_screener_fields 获取合法字段。范围格式为 0~5、>1；多选传字符串数组。",
      inputSchema: {
        filters: z.record(z.string(), z.unknown()).describe("筛选字段对象，不需要传 sign"),
        pageSize: z.number().int().min(1).max(200).default(20),
        sortBy: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).optional(),
        orderBy: z.enum(["asc", "desc"]).optional(),
      },
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    ({ filters, pageSize, sortBy, orderBy }) =>
      safeTool(async () => {
        await validateScreenerFilters(filters);
        if ((sortBy && !orderBy) || (!sortBy && orderBy)) {
          throw new Error("sortBy and orderBy must be provided together");
        }
        const catalog = await loadScreenerCatalog();
        if (sortBy && !catalog.requestFields.some((field) => field.field === sortBy)) {
          throw new Error(`Unknown sortBy field: ${sortBy}`);
        }
        const search = query({ source: "local", pageSize, sortBy, orderBy });
        return client.request(`/cn-api/v2/search/es?${search}`, {
          method: "POST",
          body: { sign: "1", ...filters },
          requireAuth: true,
        });
      }),
  );

  server.registerTool(
    "rank_funds_day_end",
    {
      title: "按最新日末回报排名基金",
      description:
        "按最新交易日滚动回报和晨星同类排名筛选基金。月末筛选仅用于生成候选池，最终收益、排名和综合排序全部来自 dayEnd；Y3/Y5 等日末长期收益是累计值。",
      inputSchema: {
        category: z
          .enum(["pureBond", "shortBond", "rateBond", "creditBond", "ordinaryBond", "activeBond", "convertibleBond"])
          .default("pureBond")
          .describe("晨星基金分类；默认纯债"),
        periods: z
          .array(z.enum(["M1", "M3", "M6", "YTD", "Y1"]))
          .min(1)
          .max(5)
          .default(["M1", "M6", "Y1"]),
        candidateLimit: z
          .number()
          .int()
          .min(20)
          .max(100)
          .default(60)
          .describe("每个周期先取月末排名靠前的候选数量"),
        limit: z.number().int().min(1).max(30).default(10),
        minFundSize: z.enum(["any", "1", "5", "10"]).default("1").describe("最低基金规模，单位亿元"),
        inceptionYears: z.enum(["1", "3", "5"]).default("1").describe("至少成立年数"),
        purchasableOnly: z.boolean().default(true),
      },
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    ({ category, periods, candidateLimit, limit, minFundSize, inceptionYears, purchasableOnly }) =>
      safeTool(async () => {
        const fundSize =
          minFundSize === "any"
            ? undefined
            : minFundSize === "1"
              ? ["1~5", "5~10", "10~50", "50~100", ">100"]
              : minFundSize === "5"
                ? ["5~10", "10~50", "50~100", ">100"]
                : ["10~50", "50~100", ">100"];
        const filters: Record<string, unknown> = {
          categoryId: [fundCategoryIds[category]],
          ifOpen: "true",
          inceptionDate: `>${inceptionYears}`,
        };
        if (fundSize) filters.fundSize = fundSize;
        if (purchasableOnly) filters.subscription = ["可申购", "限大额"];

        const candidateLists = await Promise.all(
          periods.map(async (period) => {
            const sortBy = dayEndPeriodToScreenerField[period];
            const screened = await client.request<JsonRecord>(
              `/cn-api/v2/search/es?${query({ source: "local", pageSize: candidateLimit, sortBy, orderBy: "desc" })}`,
              { method: "POST", body: { sign: "1", ...filters }, requireAuth: true },
            );
            return Array.isArray(screened.rows) ? (screened.rows as JsonRecord[]) : [];
          }),
        );

        const rowByCode = new Map<string, JsonRecord>();
        const appearances = new Map<string, number>();
        for (const rows of candidateLists) {
          for (const row of rows) {
            const code = typeof row.id === "string" ? row.id : undefined;
            if (!code || !FUND_CODE.test(code)) continue;
            rowByCode.set(code, row);
            appearances.set(code, (appearances.get(code) ?? 0) + 1);
          }
        }
        const requiredAppearances = periods.length;
        let candidateCodes = [...appearances.entries()]
          .filter(([, count]) => count === requiredAppearances)
          .map(([code]) => code);
        let candidateMethod = "intersection";
        if (candidateCodes.length === 0) {
          candidateCodes = [...appearances.keys()];
          candidateMethod = "union-fallback";
        }

        const candidates = (
          await Promise.all(
            candidateCodes.map(async (code) => {
              try {
                const performance = await client.request<JsonRecord>(`/cn-api/v2/funds/${code}/performance`);
                const dayEnd = performance.dayEnd as JsonRecord | undefined;
                const returns = dayEnd?.returns as JsonRecord | undefined;
                const ranks = dayEnd?.returnRanks as JsonRecord | undefined;
                const universes = dayEnd?.investmentsInCategory as JsonRecord | undefined;
                if (!returns || !ranks || !universes) return undefined;

                const periodData: Record<string, unknown> = {};
                const percentiles: number[] = [];
                for (const period of periods) {
                  const value = numericValue(returns[period]);
                  const rank = numericValue(ranks[period]);
                  const universe = numericValue(universes[period]);
                  if (value === undefined || rank === undefined || universe === undefined || universe <= 0) {
                    return undefined;
                  }
                  const topPercent = (rank / universe) * 100;
                  percentiles.push(topPercent);
                  periodData[period] = { return: value, rank, universe, topPercent };
                }
                const source = rowByCode.get(code) ?? {};
                return {
                  code,
                  name: source.fundName,
                  category: performance.categoryName,
                  returnDate: returns.returnDate,
                  periods: periodData,
                  averageTopPercent: percentiles.reduce((sum, value) => sum + value, 0) / percentiles.length,
                  worstTopPercent: Math.max(...percentiles),
                  rating3Y: source.rating3Y,
                  rating5Y: source.rating5Y,
                  fundSize: source.fundSize,
                  subscription: source.subscription,
                  managerName: source.managerName,
                  longestTenure: source.longestTenure,
                  ihc: source.ihc,
                  maximumDrawdown3Y: source.maximumDrawdown_3Y,
                };
              } catch {
                return undefined;
              }
            }),
          )
        )
          .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined)
          .sort(
            (left, right) =>
              left.worstTopPercent - right.worstTopPercent ||
              left.averageTopPercent - right.averageTopPercent,
          );

        return {
          basis: "dayEnd",
          note: "M1/M3/M6/YTD/Y1 are rolling returns ending on returnDate. Candidate preselection uses month-end screener fields; final ranking uses Morningstar day-end category ranks.",
          category,
          categoryId: fundCategoryIds[category],
          periods,
          candidateMethod,
          candidateCount: candidateCodes.length,
          rankedCount: candidates.length,
          funds: candidates.slice(0, limit),
        };
      }),
  );

  server.registerTool(
    "get_fund_overview",
    {
      title: "获取基金概览",
      description: "返回基金状态、净值、分类、评级、规模、公司、经理、风险等级、申购状态和投资策略。",
      inputSchema: { code: z.string().regex(FUND_CODE, "必须是 6 位基金代码") },
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    ({ code }) =>
      safeTool(async () => {
        const [operation, common] = await Promise.all([
          client.request(`/cn-api/v2/funds/${code}/operation-data`),
          client.request(`/cn-api/v2/funds/${code}/common-data`),
        ]);
        return { operation, common };
      }),
  );

  server.registerTool(
    "get_fund_performance",
    {
      title: "获取基金业绩与风险",
      description: "返回所选部分的日末/月末回报、年度季度业绩、评级、风险和投资者回报。",
      inputSchema: {
        code: z.string().regex(FUND_CODE),
        sections: z
          .array(z.enum(["dayEnd", "monthEnd", "quarterly", "annual", "rating", "risk", "investorReturn"]))
          .min(1)
          .max(7)
          .default(["dayEnd", "rating", "risk"]),
      },
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    ({ code, sections }) =>
      safeTool(async () => {
        const data = await client.request<JsonRecord>(`/cn-api/v2/funds/${code}/performance`);
        const identity = selectObject(data, [
          "csdcc",
          "secId",
          "categoryId",
          "categoryName",
          "benchmarkId",
          "benchmarkName",
          "bestFitIndexId",
          "bestFitIndexName",
        ]);
        return { ...identity, ...selectObject(data, sections) };
      }),
  );

  server.registerTool(
    "get_fund_growth",
    {
      title: "获取基金收益曲线",
      description: "获取基金、同类和基准的累计回报时间序列，并按 maxPoints 均匀降采样。",
      inputSchema: {
        code: z.string().regex(FUND_CODE),
        startDate: z.string().regex(DATE).optional(),
        endDate: z.string().regex(DATE).optional(),
        maxPoints: z.number().int().min(10).max(500).default(120),
      },
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    ({ code, startDate, endDate, maxPoints }) =>
      safeTool(async () => {
        const [common, performance] = await Promise.all([
          client.request<JsonRecord>(`/cn-api/v2/funds/${code}/common-data`),
          client.request<JsonRecord>(`/cn-api/v2/funds/${code}/performance`),
        ]);
        const effectiveEnd = endDate ?? String(common.latestPerformanceDate);
        const effectiveStart = startDate ?? subtractDays(effectiveEnd, 365);
        if (effectiveStart > effectiveEnd) throw new Error("startDate must not be after endDate");
        const categoryId = String(performance.categoryId ?? "");
        const data = await client.request(`/cn-api/v2/funds/${code}/growth-data`, {
          method: "POST",
          body: {
            growthDataPoint: "cumulativeReturn",
            initValue: 10_000,
            freq: "1d",
            calcBmkSecId: "PBMK",
            currency: String(common.currencyId ?? "CNY"),
            type: "return",
            startDate: effectiveStart,
            endDate: effectiveEnd,
            catAvgSecId: categoryId,
            bmk1SecId: "PBMK",
            outputs: ["tsData", "pr", "dividend", "management"],
          },
        });
        return thinGrowthData(data, maxPoints);
      }),
  );

  server.registerTool(
    "get_fund_portfolio",
    {
      title: "获取基金投资组合",
      description: "按需返回资产配置、重仓证券、固收券种、分红拆分、规模或历史有效日期。",
      inputSchema: {
        code: z.string().regex(FUND_CODE),
        sections: z
          .array(z.enum(["allocation", "holdings", "fixedIncome", "dividends", "sizes", "historyDates"]))
          .min(1)
          .max(6)
          .default(["allocation", "holdings"]),
      },
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    ({ code, sections }) =>
      safeTool(async () => {
        const endpoints: Record<string, string> = {
          allocation: `/cn-api/v2/funds/${code}/asset-allocation`,
          holdings: `/cn-api/v2/funds/${code}/holdings`,
          fixedIncome: `/cn-api/v2/funds/${code}/fixed-income`,
          dividends: `/cn-api/v2/funds/${code}/equity`,
          sizes: `/cn-api/v2/funds/${code}/sizes`,
          historyDates: `/cn-api/v1/history/${code}/effective-list`,
        };
        const entries = await Promise.all(
          sections.map(async (section) => [section, await client.request(endpoints[section] as string)] as const),
        );
        return Object.fromEntries(entries);
      }),
  );

  server.registerTool(
    "get_fund_fees",
    {
      title: "获取基金费用",
      description: "返回综合、显性和隐性费率、分位、换手率、最低投资额和不同份额费用；移除大型同类分布数组。",
      inputSchema: { code: z.string().regex(FUND_CODE) },
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    ({ code }) =>
      safeTool(async () => {
        const data = await client.request<JsonRecord>(`/cn-api/v2/funds/${code}/fees`);
        const fees = structuredClone((data.fees ?? {}) as JsonRecord);
        for (const key of ["ihcList", "explicitCostList", "hiddenCostList"]) delete fees[key];
        return { fees, shareClassFees: data.shareClassFees };
      }),
  );

  server.registerTool(
    "get_fund_managers",
    {
      title: "获取基金经理",
      description: "返回现任和历任经理；指定 managerId 时附带在管产品与经理收益曲线。",
      inputSchema: {
        code: z.string().regex(FUND_CODE),
        managerId: z.string().trim().regex(/^\d+$/).optional(),
        period: z.enum(["1", "2", "3", "5", "25"]).default("5"),
        broadCategory: z.enum(["ALL", "$BCG$EQUTY", "$BCG$FXINC"]).default("ALL"),
      },
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    ({ code, managerId, period, broadCategory }) =>
      safeTool(async () => {
        const managers = await client.request<JsonRecord>(`/cn-api/v2/funds/${code}/managers`);
        const selectedId = managerId ?? (typeof managers.managerId === "string" ? managers.managerId.trim() : undefined);
        if (!selectedId) return { managers };
        const [detail, returns] = await Promise.all([
          client.request(`/cn-api/v2/funds/${code}/managers/${selectedId}`),
          client.request(
            `/cn-api/v2/manager/return?${query({ managerId: selectedId, period, broadCategory })}`,
          ),
        ]);
        return { managers, selectedManager: { detail, returns } };
      }),
  );

  server.registerTool(
    "get_fund_holders",
    {
      title: "获取基金持有人信息",
      description: "返回机构/个人、FOF、基金经理、员工、高管和管理人持有情况。",
      inputSchema: { code: z.string().regex(FUND_CODE), includeManagerFunds: z.boolean().default(false) },
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    ({ code, includeManagerFunds }) =>
      safeTool(async () => {
        const [owners, holder, holderList] = await Promise.all([
          client.request(`/cn-api/v2/funds/${code}/owners`),
          client.request(`/cn-api/v2/funds/${code}/holder`),
          includeManagerFunds
            ? client.request(`/cn-api/v2/funds/${code}/holder-list`)
            : Promise.resolve(undefined),
        ]);
        return { owners, holder, ...(holderList === undefined ? {} : { holderList }) };
      }),
  );

  server.registerTool(
    "get_fund_strategy",
    {
      title: "获取基金策略与基准",
      description: "返回投资策略、经理展望和最佳拟合/招募说明书/晨星分类基准指标。",
      inputSchema: { code: z.string().regex(FUND_CODE) },
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    ({ code }) =>
      safeTool(async () => {
        const [strategies, outlooks, bestFitIndex] = await Promise.all([
          client.request(`/cn-api/fund/strategies?${query({ csdcc: code })}`),
          client.request(`/cn-api/fund/outlooks?${query({ csdcc: code })}`),
          client.request(`/cn-api/v2/funds/${code}/best-fit-index`),
        ]);
        return { strategies, outlooks, bestFitIndex };
      }),
  );

  server.registerTool(
    "list_fund_documents",
    {
      title: "列出基金公告与报告",
      description: "分页列出基金公告、季报、半年报、年报和招募说明书，返回 docId 供后续使用。",
      inputSchema: {
        code: z.string().regex(FUND_CODE),
        docType: z.string().trim().max(20).optional(),
        offset: z.number().int().min(0).max(10_000).default(0),
        limit: z.number().int().min(1).max(50).default(10),
      },
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    ({ code, docType, offset, limit }) =>
      safeTool(() =>
        client.request(
          `/cn-api/v2/funds/${code}/doc-list?${query({ docType, skipNumber: offset, pageSize: limit })}`,
        ),
      ),
  );

  server.registerTool(
    "get_market_insights",
    {
      title: "获取晨星市场洞察数据",
      description: "按主题返回基金流量、海外趋势、大类排名或市场费率趋势。",
      inputSchema: {
        topic: z.enum(["chinaFundFlow", "overseasTrend", "assetClassRanks", "marketFeeTrend"]),
      },
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    ({ topic }) =>
      safeTool(async () => {
        const endpoints = {
          chinaFundFlow: "/cn-api/v2/markets/fund-cn-thematic",
          overseasTrend: "/cn-api/v2/markets/fund-oversea-trend",
          assetClassRanks: "/cn-api/v2/markets/broad-category-ranks",
          marketFeeTrend: "/cn-api/cf/market-fee-trend",
        } as const;
        return client.request(endpoints[topic]);
      }),
  );
}
