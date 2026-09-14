# Morningstar China MCP

[简体中文](README.zh-CN.md) | English

An MCP server for querying Morningstar China fund data. It supports fund search, screening, latest day-end ranking, performance, portfolio, fees, managers, ownership, strategy, documents, and market data.

> [!IMPORTANT]
> This project calls internal frontend APIs used by the Morningstar China website. It is not an official Morningstar SDK. The APIs may change without notice, and Morningstar data remains subject to its licensing terms. Use the server only with an account and data access you are authorized to use. Do not use it for unauthorized bulk collection or redistribution.

## Features

- 15 read-only MCP tools
- 216 allowlisted fund screener fields
- Current rolling returns from the latest trading day's `dayEnd` data
- Fund, category, and benchmark performance comparisons
- Portfolio allocation, holdings, fixed-income exposure, fees, managers, and ownership
- Stateless per-request token isolation
- Bounded pagination, concurrency, response size, and time-series output
- HTTP and Morningstar business-status validation

## Requirements

- Node.js 20 or later
- npm
- A valid Morningstar China JWT obtained through an authorized Morningstar session
- An MCP client that supports Streamable HTTP and custom request headers

## Install and run

```bash
npm install
npm run build
npm start
```

The server listens on the loopback interface by default:

```text
MCP endpoint:  http://127.0.0.1:3845/mcp
Health check:  http://127.0.0.1:3845/health
```

Set a different host or port when needed:

```bash
MCP_HOST=127.0.0.1 MCP_PORT=4000 npm start
```

`MCP_PORT` must be an integer from 1 to 65535. Keep the default loopback binding for local use. Put remote deployments behind HTTPS, authentication, request-size limits, and a trusted reverse proxy.

## Authentication

Every MCP HTTP request must include the caller's Morningstar JWT:

```http
X-Morningstar-Token: <morningstar-jwt>
```

The server maps this value to the custom `token` header expected by Morningstar. It creates a separate stateless MCP server and Morningstar client for each HTTP request, so concurrent callers do not share tokens.

The server does not acquire, refresh, persist, or log tokens. It does not read browser cookies or other server-side credential sources. Missing or expired tokens receive HTTP 401 responses.

## MCP client configuration

Start the HTTP server, then add the following Streamable HTTP server configuration to your MCP client:

```json
{
  "mcpServers": {
    "morningstar-cn": {
      "url": "http://127.0.0.1:3845/mcp",
      "headers": {
        "X-Morningstar-Token": "${MORNINGSTAR_TOKEN}"
      }
    }
  }
}
```

Set `MORNINGSTAR_TOKEN` in the environment that launches the MCP client. The client resolves the variable and sends its value as an HTTP request header; the MCP server process does not receive it as an environment variable.

Do not place a real token directly in a committed configuration file. The client must support Streamable HTTP, custom request headers configured through `headers`, and environment-variable interpolation; if its configuration format differs, use the equivalent endpoint and header settings.

## Tools

| Tool | Purpose | Main inputs |
|---|---|---|
| `search_funds` | Search mainland China funds by name or code | `query`, `limit` |
| `search_managers` | Search fund managers by name | `query`, `limit` |
| `list_screener_fields` | Find valid screener fields, types, units, and enum values | `query` |
| `screen_funds` | Screen funds with allowlisted Morningstar fields | `filters`, `pageSize`, `sortBy`, `orderBy` |
| `rank_funds_day_end` | Rank a bounded candidate set with latest day-end returns and category ranks | `category`, `periods`, `candidateLimit`, `limit` |
| `get_fund_overview` | Read NAV, category, rating, size, manager, risk level, and subscription status | `code` |
| `get_fund_performance` | Read day-end/month-end returns, ratings, risk, and investor returns | `code`, `sections` |
| `get_fund_growth` | Read a downsampled fund/category/benchmark growth series | `code`, dates, `maxPoints` |
| `get_fund_portfolio` | Read allocation, holdings, fixed-income exposure, dividends, and size history | `code`, `sections` |
| `get_fund_fees` | Read explicit, implicit, management, custody, and share-class fees | `code` |
| `get_fund_managers` | Read current and former managers and optional manager performance | `code`, `managerId`, `period` |
| `get_fund_holders` | Read institutional, individual, employee, manager, and FOF ownership | `code` |
| `get_fund_strategy` | Read strategy dates, outlook dates, and benchmark analytics | `code` |
| `list_fund_documents` | List announcements and periodic reports | `code`, `docType`, `offset`, `limit` |
| `get_market_insights` | Read fund flows, overseas trends, asset-class ranks, or fee trends | `topic` |

All tools advertise the MCP `readOnlyHint`. The server does not expose watch-list, portfolio, template, feedback, or account mutations.

## Usage examples

### Inspect one fund

```json
{
  "code": "002276",
  "sections": ["dayEnd", "monthEnd", "rating", "risk"]
}
```

Call `get_fund_performance` with these arguments.

### Discover screener fields

Before building filters, call `list_screener_fields`:

```json
{
  "query": "晨星评级"
}
```

Then pass valid fields to `screen_funds`:

```json
{
  "filters": {
    "rating3Y": ["5"],
    "returnYTD_M": ">5"
  },
  "pageSize": 20,
  "sortBy": "returnYTD_M",
  "orderBy": "desc"
}
```

The server rejects unknown filter and sort fields before it sends a request to Morningstar.

### Rank bond funds with latest day-end data

```json
{
  "category": "pureBond",
  "periods": ["M1", "M6", "Y1"],
  "candidateLimit": 60,
  "limit": 10,
  "minFundSize": "1",
  "inceptionYears": "3",
  "purchasableOnly": true
}
```

Call `rank_funds_day_end` with these arguments. Supported categories are `pureBond`, `shortBond`, `rateBond`, `creditBond`, `ordinaryBond`, `activeBond`, and `convertibleBond`.

Morningstar's bulk screener exposes month-end return fields only. This tool uses those fields to form a bounded candidate pool, then fetches each candidate's latest `performance.dayEnd` data and ranks the funds by their category percentiles. It minimizes the worst percentile across the selected periods, followed by the average percentile.

## Return-period semantics

Morningstar uses different conventions for current and standardized research data:

- `dayEnd` uses rolling periods ending on the latest available trading day.
- `monthEnd` uses the most recent completed month-end.
- `dayEnd` values for `Y3`, `Y5`, and `Y10` are cumulative returns.
- Long-period `monthEnd` values are annualized returns.

Do not compare a cumulative `dayEnd.Y3` value directly with an annualized `monthEnd.Y3` value. Use `dayEnd` for current momentum and `monthEnd` for consistent cross-sectional research.

## Development

```bash
npm run dev        # run the TypeScript source
npm run typecheck  # strict TypeScript check
npm test           # run Vitest once
npm run build      # compile to dist/
npm run check      # typecheck, test, and build
```
