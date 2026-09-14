#!/usr/bin/env python3
"""Generate the human-readable API report from redacted probe evidence."""
from __future__ import annotations

import json
from pathlib import Path

EVIDENCE = Path("docs/evidence/api-probe-results.json")
OUTPUT = Path("docs/morningstar-api-complete.md")

PURPOSE = {
    "fund_autocomplete": "按代码/名称搜索基金",
    "manager_autocomplete": "按名称搜索基金经理",
    "article_search": "搜索晨星文章",
    "market_effective_dates": "各市场数据集的有效日期",
    "company_self_purchase": "基金公司自购观察",
    "holder_observation": "基金经理/内部人员持有观察",
    "company_return": "基金公司基金回报与投资者回报",
    "company_invest_returns": "全市场基金与投资者回报",
    "market_fee_trend": "全市场费率趋势",
    "company_fee_return": "基金公司费率与回报",
    "company_groups": "基金公司分组",
    "fund_cn_thematic": "中国主题基金规模与流量",
    "fund_oversea_trend": "海外基金趋势",
    "broad_category_ranks": "大类资产历年回报排名",
    "etf_latest": "全球 ETF 最新统计",
    "etf_global": "全球 ETF 长期统计",
    "screener_companies": "筛选器基金公司选项",
    "screener_templates": "当前用户筛选模板",
    "screener_search": "按筛选条件查询基金",
    "watch_lists": "当前用户观察列表",
    "user_info": "当前登录用户摘要",
    "authing_user": "Authing 用户标识",
    "fund_operation": "验证基金存在、代码和清盘状态",
    "fund_common": "基金概览、净值、分类、策略",
    "fund_performance": "回报、排名、评级、风险、投资者回报",
    "fund_growth": "累计回报时间序列",
    "fund_asset_allocation": "资产配置、行业、换手率",
    "fund_sizes": "基金/份额规模历史",
    "fund_owners": "机构个人与 FOF 持有",
    "fund_holdings": "最新重仓证券",
    "fund_fees": "综合/显性/隐性费用",
    "fund_equity": "分红与拆分历史",
    "fund_fixed_income": "债券券种配置",
    "fund_managers": "现任/历任经理",
    "fund_manager_detail": "经理在管与历史产品",
    "fund_holder": "经理/员工/公司持有摘要",
    "fund_holder_list": "经理旗下产品持有明细",
    "fund_best_fit_index": "最佳拟合/招募书/分类基准比较",
    "history_asset_allocation": "历史大类资产配置",
    "history_asset_allocation_cio": "历史穿透资产配置",
    "history_manager_change": "基金经理变更日期",
    "history_effective_list": "各历史数据可用日期",
    "history_top_bonds": "指定季度重仓债券",
    "history_asset_snapshot": "资产配置历史接口的日期参数行为",
    "fund_strategies": "季报/年报投资策略日期及内容",
    "fund_outlooks": "经理展望日期及内容",
    "fund_benchmarks": "基准指数列表",
    "company_common": "基金公司概览与投研稳定性",
    "manager_profile": "旧版经理画像数据",
    "manager_return": "经理与基准收益曲线",
    "manager_performance_candidate": "前端候选经理业绩接口（样例无数据）",
    "fund_documents": "公告/报告列表",
    "fund_document_download": "下载公告 PDF",
}

SECTIONS = [
    ("搜索", ["fund_autocomplete", "manager_autocomplete", "article_search"]),
    ("基金筛选", ["screener_companies", "screener_templates", "screener_search"]),
    ("概览和业绩", ["fund_operation", "fund_common", "fund_performance", "fund_growth", "fund_best_fit_index"]),
    ("组合、费用和持有人", ["fund_asset_allocation", "fund_sizes", "fund_owners", "fund_holdings", "fund_fees", "fund_equity", "fund_fixed_income", "fund_holder", "fund_holder_list"]),
    ("经理、公司和策略", ["fund_managers", "fund_manager_detail", "manager_profile", "manager_return", "company_common", "fund_strategies", "fund_outlooks", "fund_benchmarks"]),
    ("历史数据", ["history_effective_list", "history_asset_allocation", "history_asset_allocation_cio", "history_manager_change", "history_top_bonds", "history_asset_snapshot"]),
    ("公告", ["fund_documents", "fund_document_download"]),
    ("账户只读接口", ["watch_lists", "user_info", "authing_user"]),
]


def response_summary(result: dict) -> str:
    shape = result.get("responseShape")
    if isinstance(shape, dict) and shape.get("type") == "array":
        return f"{shape.get('length')} 项数组"
    if isinstance(shape, dict):
        return "字段：" + ", ".join(list(shape)[:8])
    if result.get("binarySignature"):
        return "PDF 二进制，签名 `%PDF`"
    return str(shape)


def main() -> None:
    report = json.loads(EVIDENCE.read_text())
    results = report["results"]
    by_id = {result["id"]: result for result in results}
    sections = SECTIONS + [("市场与晨星数据页", [result["id"] for result in results if result["group"] == "market"])]

    lines = [
        "# 晨星中国基金接口完整验证报告",
        "",
        f"> 验证时间：`{report['generatedAt']}`；样例基金：`{report['sampleFund']}`（金鹰元祺信用债债券A）。",
        ">",
        f"> 共调用 **{report['summary']['total']}** 个只读接口：**{report['summary']['verified']}** 个业务成功，**{report['summary']['notVerified']}** 个候选接口无数据。完整脱敏证据见 [`evidence/api-probe-results.json`](./evidence/api-probe-results.json)。",
        "",
        "## 1. 结论",
        "",
        "1. 基金搜索、详情、业绩、风险、费用、组合、持有人、经理、公司、策略、公告和市场洞察均有可复用的 JSON 接口。",
        "2. 中国内地基金筛选器主体字段定义不由接口返回，而在前端 bundle；已提取为 [`screener-fields.json`](./screener-fields.json)，阅读版见 [`screener-fields.md`](./screener-fields.md)。",
        "3. 筛选、用户模板和观察列表要求自定义 `token` Header；大部分基金详情及公共搜索接口实测可匿名访问。",
        "4. HTTP 200 不等于成功，必须检查 `_meta.response_status === \"200011\"`。",
        "5. 详情页使用 SSR，初始加载由后端聚合多项 `/cn-api`；仅看浏览器 XHR 会漏掉大量接口。",
        "",
        "## 2. 请求规范",
        "",
        "```http",
        "Host: www.morningstar.cn",
        "token: <JWT>",
        "x-api-requestid: <UUID>",
        "Accept: application/json",
        "Content-Type: application/json   # POST 时",
        "```",
        "",
        "- JWT 来自 `localStorage.token` 或 `sessionStorage.token`，不是 `Authorization: Bearer`。",
        "- 工程实现从 `MORNINGSTAR_TOKEN` 读取；本地 `auth.json` 只作后备且不得提交。",
        "- 通用成功包络：`{\"_meta\":{\"response_status\":\"200011\"},\"data\":...}`。",
        "- 对 403、401、`400001` 等状态做明确错误映射。",
        "",
        "## 3. 实际调用总表",
        "",
        "| 分组 | 方法与路径 | 用途 | 实测结果 | 响应规模/主要结构 |",
        "|---|---|---|---|---|",
    ]

    for result in results:
        path = result["path"].replace("|", "\\|")
        status = f"HTTP {result.get('httpStatus', '—')}"
        meta = result.get("meta") or {}
        if meta:
            status += f" / `{meta.get('response_status')}`"
        status += " ✅" if result.get("verified") else " ⚠️"
        summary = f"{result.get('responseBytesRead', '—')} B；{response_summary(result)}".replace("|", "\\|")
        purpose = PURPOSE[result["id"]].replace("|", "\\|")
        lines.append(f"| {result['group']} | `{result['method']} {path}` | {purpose} | {status} | {summary} |")

    lines.extend(["", "## 4. 接口分组与真实数据摘要", ""])
    for title, ids in sections:
        lines.extend([f"### {title}", ""])
        for endpoint_id in ids:
            result = by_id[endpoint_id]
            details = []
            shape = result.get("responseShape")
            sample = result.get("sample")
            if isinstance(shape, dict) and shape.get("type") == "array":
                details.append(f"返回 {shape.get('length')} 项")
            elif isinstance(shape, dict):
                details.append("顶层字段：" + ", ".join(list(shape)[:12]))
            if isinstance(sample, dict):
                scalars = []
                for key, value in sample.items():
                    if isinstance(value, (str, int, float, bool)) and len(str(value)) < 80:
                        scalars.append(f"`{key}={value}`")
                    if len(scalars) >= 5:
                        break
                if scalars:
                    details.append("样例 " + "、".join(scalars))
            if sample == "<personal response omitted>":
                details.append("响应含账户数据，证据仅保留结构")
            if result.get("binarySignature"):
                details.append("已读取前 1024 B 并确认 PDF 文件签名")
            suffix = "；".join(details)
            lines.append(f"- **`{result['method']} {result['path']}`**：{PURPOSE[endpoint_id]}。{suffix}。")
        lines.append("")

    screener_body = by_id["screener_search"]["request"]["body"]
    lines.extend(
        [
            "## 5. 关键请求样例",
            "",
            "### 基金名称筛选",
            "",
            "```http",
            "POST /cn-api/v2/search/es?source=local&pageSize=10",
            "token: <JWT>",
            "Content-Type: application/json",
            "```",
            "",
            "```json",
            json.dumps(screener_body, ensure_ascii=False, indent=2),
            "```",
            "",
            "真实响应命中 `002490 金鹰元祺信用债债券A`，`count=1`。完整筛选字段与编码规则见 `screener-fields.md`。",
            "",
            "### 基金累计回报曲线",
            "",
            "```http",
            "POST /cn-api/v2/funds/002490/growth-data",
            "```",
            "",
            "本次用一年日期范围验证，返回 366 个日期点，并包含基金、同类平均、业绩基准、区间回报、最大回撤、分红和经理变更。MCP 默认应限制范围或降采样。",
            "",
            "### 历史重仓债券",
            "",
            "```http",
            "GET /cn-api/v1/history/002490/top-10-bonds?effectiveDate=2026-03-31",
            "```",
            "",
            "返回 `portfolioDate` 和 10 条 `bondHoldings`。可用日期先从 `/effective-list` 的 `top10Bonds` 获取。",
            "",
            "### 公告下载",
            "",
            "```http",
            "GET /cn-api/doc/download?docId=677757129",
            "```",
            "",
            "返回 `application/octet-stream`，实测内容以 `%PDF` 开头。MCP 应先列公告，再由用户明确选择 `docId`；设置下载大小上限。",
            "",
            "## 6. 已发现但不建议使用/未执行",
            "",
            "- `GET /cn-api/v2/managers/{managerId}/performance`：样例 `190638` 返回 HTTP 200，但 `_meta.response_status=400001`、`data not found`；不要作为首版依赖。",
            "- `GET /cn-api/mcp/fund-review?csdcc={code}`：生产 bundle 明确禁用，未调用。",
            "- 以下为写操作，为避免修改账户数据未执行：",
        ]
    )
    lines.extend(f"  - `{endpoint}`" for endpoint in report["excludedMutations"])
    lines.extend(
        [
            "",
            "## 7. MCP 工具建议",
            "",
            "| MCP 工具 | 后端接口组合 | 默认输出策略 |",
            "|---|---|---|",
            "| `search_funds` | `public/v1/fund-cache` | 最多 20 个匹配项 |",
            "| `screen_funds` | `v2/search/es` | 白名单筛选字段；默认 20 条，最多 200 |",
            "| `get_fund_overview` | `operation-data` + `common-data` | 返回概览和最新净值 |",
            "| `get_fund_performance` | `performance` | 允许选择 returns/ratings/risk/investorReturn |",
            "| `get_fund_growth` | `growth-data` | 必须有日期范围；自动降采样 |",
            "| `get_fund_portfolio` | allocation/holdings/fixed-income/equity/history | 按 section 和日期查询 |",
            "| `get_fund_fees` | `fees` | 删除同类分布的大数组，仅给分位摘要 |",
            "| `get_fund_managers` | managers/manager detail/return | 可选经理 ID 和期间 |",
            "| `get_fund_holders` | owners/holder/holder-list | 摘要化持有人与内部持有 |",
            "| `get_fund_strategy` | strategies/outlooks/best-fit-index | 默认最新报告期 |",
            "| `list_fund_documents` | `doc-list` | 分页，最多 50 条 |",
            "| `download_fund_document` | `doc/download` | 明确 docId；限制文件大小 |",
            "| `get_market_insights` | markets/ETF/company/fee | 指定主题，禁止一次返回全量大表 |",
            "",
            "## 8. 维护与复验",
            "",
            "```bash",
            "python3 scripts/extract-screener-fields.py",
            "python3 scripts/probe-apis.py",
            "python3 scripts/generate-api-doc.py",
            "```",
            "",
            "- 筛选脚本从当前 bundle 重建 216 个请求字段目录。",
            "- 探测脚本调用全部只读接口并重建脱敏证据。",
            "- 文档脚本确保总表与探测证据保持一致。",
            "- 脚本不得输出 JWT；账户接口不保留响应内容。",
            "",
            "## 9. 合规与工程边界",
            "",
            "Morningstar 页面声明内容包含专有资料。接口并非公开稳定 API；用于个人工具、商业产品、批量抓取或再分发前，应确认许可、速率和数据授权。客户端应具备限流、缓存、超时、审计和 token 失效处理，禁止把凭证或大规模原始数据暴露给模型。",
            "",
        ]
    )
    OUTPUT.write_text("\n".join(lines))
    print(f"wrote {OUTPUT}: {len(lines)} lines")


if __name__ == "__main__":
    main()
