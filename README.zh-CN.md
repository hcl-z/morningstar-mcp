# Morningstar China MCP

简体中文 | [English](README.md)

用于查询晨星中国基金数据。它支持基金搜索、基金筛选、最新日末排名、业绩、投资组合、费用、基金经理、持有人、策略、公告和市场数据的 MCP 服务。

> [!IMPORTANT]
> 本项目调用晨星中国网站使用的内部前端接口，并非晨星官方SDK。接口可能随时变化，晨星数据仍受其许可条款约束。请仅使用你获准访问的账户和数据，不要进行未经授权的批量采集或再分发。

## 功能

- 15个只读MCP工具
- 216个白名单基金筛选字段
- 基于最新交易日 `dayEnd` 数据的滚动收益
- 基金、同类和基准业绩比较
- 资产配置、持仓、固收敞口、费用、经理和持有人数据
- 每个请求使用独立Token，避免并发用户串用凭证
- 限制分页、并发数、响应体大小和时间序列长度
- 同时校验HTTP状态和晨星业务状态

## 环境要求

- Node.js 20或更高版本
- npm
- 通过合法晨星会话取得的有效晨星中国JWT
- 支持Streamable HTTP和自定义请求Header的MCP客户端

## 安装与启动

```bash
npm install
npm run build
npm start
```

服务默认只监听本机回环地址：

```text
MCP端点：  http://127.0.0.1:3845/mcp
健康检查： http://127.0.0.1:3845/health
```

需要修改地址或端口时设置环境变量：

```bash
MCP_HOST=127.0.0.1 MCP_PORT=4000 npm start
```

`MCP_PORT` 必须是1至65535之间的整数。本地使用时建议保留默认回环地址。远程部署时应配置HTTPS、访问控制、请求大小限制和可信反向代理。

## 鉴权

连接MCP、调用 `tools/list` 以及使用晨星目前允许匿名访问的工具时，可以不传 `X-Morningstar-Token`：

```http
X-Morningstar-Token: <morningstar-jwt>
```

`screen_funds` 和 `rank_funds_day_end` 必须传Header。其余13个工具目前可以匿名发现和调用。如果晨星以后收紧其中某个上游接口，该工具会返回晨星的鉴权错误。

收到Token后，服务将其映射为晨星上游要求的自定义 `token` Header。每个HTTP请求都会创建独立的无状态MCP服务器和晨星客户端，因此并发调用者不会共享Token。

服务不负责获取、续期、保存或记录Token。已传入但过期的Token会收到HTTP 401；未传Token却调用受保护工具时，会收到MCP `AUTH_REQUIRED` 工具错误。

## MCP客户端配置

先启动HTTP服务，然后在MCP客户端中添加以下Streamable HTTP服务器配置：

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

只需要查看工具或使用匿名工具时，可以省略 `headers` 配置。需要调用两个受保护的筛选工具时，请在启动MCP客户端的环境中设置 `MORNINGSTAR_TOKEN`。客户端解析变量后通过HTTP Header发送Token，MCP服务进程不会把它作为环境变量接收。

不要把真实Token直接写进提交到版本库的配置文件。客户端需要支持Streamable HTTP、通过 `headers` 配置自定义请求Header，以及环境变量插值；如客户端的配置格式不同，请使用等效的端点和Header设置。

## 工具

| 工具 | 用途 | 主要输入 |
|---|---|---|
| `search_funds` | 按名称或代码搜索中国内地基金 | `query`, `limit` |
| `search_managers` | 按姓名搜索基金经理 | `query`, `limit` |
| `list_screener_fields` | 查询筛选字段、类型、单位和枚举值 | `query` |
| `screen_funds` | 使用晨星白名单字段筛选基金，**需要Token** | `filters`, `pageSize`, `sortBy`, `orderBy` |
| `rank_funds_day_end` | 用最新日末收益和同类排名对有限候选池排序，**需要Token** | `category`, `periods`, `candidateLimit`, `limit` |
| `get_fund_overview` | 查询净值、分类、评级、规模、经理、风险等级和申购状态 | `code` |
| `get_fund_performance` | 查询日末/月末收益、评级、风险和投资者回报 | `code`, `sections` |
| `get_fund_growth` | 查询降采样后的基金、同类和基准收益曲线 | `code`, 日期, `maxPoints` |
| `get_fund_portfolio` | 查询配置、持仓、固收敞口、分红和规模历史 | `code`, `sections` |
| `get_fund_fees` | 查询显性、隐性、管理、托管和不同份额费用 | `code` |
| `get_fund_managers` | 查询现任、历任经理及可选的经理业绩 | `code`, `managerId`, `period` |
| `get_fund_holders` | 查询机构、个人、员工、经理和FOF持有情况 | `code` |
| `get_fund_strategy` | 查询策略日期、经理展望日期和基准指标 | `code` |
| `list_fund_documents` | 分页查询公告和定期报告 | `code`, `docType`, `offset`, `limit` |
| `get_market_insights` | 查询资金流、海外趋势、大类排名或费率趋势 | `topic` |

所有工具都声明MCP `readOnlyHint`。服务不会暴露观察列表、投资组合、模板、反馈或账户写操作。

## 使用示例

### 查询单只基金

调用 `get_fund_performance`：

```json
{
  "code": "002276",
  "sections": ["dayEnd", "monthEnd", "rating", "risk"]
}
```

### 查询筛选字段

构造筛选条件前，先调用 `list_screener_fields`：

```json
{
  "query": "晨星评级"
}
```

再将合法字段传给 `screen_funds`：

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

服务会在请求晨星前拒绝未知筛选字段和排序字段。

### 按最新日末数据排名债券基金

调用 `rank_funds_day_end`：

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

可用分类包括 `pureBond`、`shortBond`、`rateBond`、`creditBond`、`ordinaryBond`、`activeBond` 和 `convertibleBond`。

晨星批量筛选接口只提供月末收益字段。该工具先用月末字段生成有限候选池，再读取每只候选基金最新的 `performance.dayEnd` 数据，并按同类排名百分位排序。排序先比较所选周期中的最差百分位，再比较平均百分位。

## 收益周期口径

晨星对当前数据和标准化研究数据使用不同口径：

- `dayEnd` 使用截至最新交易日的滚动周期。
- `monthEnd` 使用最近一个完整月末。
- `dayEnd` 中的 `Y3`、`Y5` 和 `Y10` 是累计收益。
- `monthEnd` 中的长期收益是年化收益。

不能直接比较累计口径的 `dayEnd.Y3` 和年化口径的 `monthEnd.Y3`。查看当前动量时使用 `dayEnd`；进行统一截面的研究比较时使用 `monthEnd`。

## 开发

```bash
npm run dev        # 运行TypeScript源码
npm run typecheck  # 严格TypeScript检查
npm test           # 运行一次Vitest
npm run build      # 编译到dist/
npm run check      # 依次执行类型检查、测试和构建
```