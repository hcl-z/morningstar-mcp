#!/usr/bin/env python3
"""Probe Morningstar China read-only fund APIs and save bounded, redacted evidence."""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any

BASE_URL = "https://www.morningstar.cn"
SENSITIVE_KEYS = re.compile(r"token|email|phone|mobile|address|userid|uniqueid|avatar|wechat", re.I)


def shape(value: Any, depth: int = 0) -> Any:
    if depth >= 3:
        return type(value).__name__
    if isinstance(value, dict):
        return {key: shape(item, depth + 1) for key, item in list(value.items())[:40]}
    if isinstance(value, list):
        return {
            "type": "array",
            "length": len(value),
            "item": shape(value[0], depth + 1) if value else None,
        }
    return type(value).__name__


def bounded_sample(value: Any, depth: int = 0) -> Any:
    if depth >= 3:
        if isinstance(value, str):
            return value[:120]
        if isinstance(value, list):
            return {"type": "array", "length": len(value)}
        if isinstance(value, dict):
            return {"type": "object", "keys": list(value)[:16]}
        return value
    if isinstance(value, dict):
        result = {}
        for key, item in list(value.items())[:16]:
            result[key] = "<redacted>" if SENSITIVE_KEYS.search(key) else bounded_sample(item, depth + 1)
        return result
    if isinstance(value, list):
        return [bounded_sample(item, depth + 1) for item in value[:2]]
    if isinstance(value, str):
        return value[:160]
    return value


def load_token() -> str:
    token = os.environ.get("MORNINGSTAR_TOKEN")
    if token:
        return token
    path = Path("auth.json")
    return json.loads(path.read_text())["token"] if path.exists() else ""


def endpoints(doc_id: str = "677757129") -> list[dict]:
    code = "002490"
    manager = "190638"
    company = "0C00001NYH"
    growth_body = {
        "growthDataPoint": "cumulativeReturn",
        "initValue": 10000,
        "freq": "1d",
        "calcBmkSecId": "PBMK",
        "currency": "CNY",
        "type": "return",
        "startDate": "2025-09-10",
        "endDate": "2026-09-09",
        "catAvgSecId": "PGSZB5TTTT",
        "bmk1SecId": "PBMK",
        "outputs": ["tsData", "pr", "dividend", "management"],
    }
    return [
        {"id": "fund_autocomplete", "group": "search", "method": "GET", "path": "/cn-api/public/v1/fund-cache?match=" + urllib.parse.quote("易方达蓝筹")},
        {"id": "manager_autocomplete", "group": "search", "method": "GET", "path": "/cn-api/public/v2/fund-cache?match=" + urllib.parse.quote("张坤") + "&target=manager"},
        {"id": "article_search", "group": "search", "method": "GET", "path": "/cn-api/official/article-search?match=" + urllib.parse.quote("债券基金")},
        {"id": "market_effective_dates", "group": "market", "method": "GET", "path": "/cn-api/v1/effective-dates"},
        {"id": "company_self_purchase", "group": "market", "method": "GET", "path": "/cn-api/fund/v1/company-self-purchase"},
        {"id": "holder_observation", "group": "market", "method": "GET", "path": "/cn-api/fund/v1/holder-observation"},
        {"id": "company_return", "group": "market", "method": "GET", "path": "/cn-api/v1/company-return?effectiveDate=2026-06-30"},
        {"id": "company_invest_returns", "group": "market", "method": "GET", "path": "/cn-api/v1/company-invest-returns"},
        {"id": "market_fee_trend", "group": "market", "method": "GET", "path": "/cn-api/cf/market-fee-trend"},
        {"id": "company_fee_return", "group": "market", "method": "GET", "path": "/cn-api/cf/company-fee-return"},
        {"id": "company_groups", "group": "market", "method": "GET", "path": "/cn-api/cf/company-groups"},
        {"id": "fund_cn_thematic", "group": "market", "method": "GET", "path": "/cn-api/v2/markets/fund-cn-thematic"},
        {"id": "fund_oversea_trend", "group": "market", "method": "GET", "path": "/cn-api/v2/markets/fund-oversea-trend"},
        {"id": "broad_category_ranks", "group": "market", "method": "GET", "path": "/cn-api/v2/markets/broad-category-ranks"},
        {"id": "etf_latest", "group": "market", "method": "GET", "path": "/cn-api/etf/latest"},
        {"id": "etf_global", "group": "market", "method": "GET", "path": "/cn-api/etf/global"},
        {"id": "screener_companies", "group": "screener", "method": "GET", "path": "/cn-api/v2/condition/filter?source=local"},
        {"id": "screener_templates", "group": "screener", "method": "GET", "path": "/cn-api/v2/template/config-list?source=local", "personal": True},
        {"id": "screener_search", "group": "screener", "method": "POST", "path": "/cn-api/v2/search/es?source=local&pageSize=10", "body": {"sign": "1", "fundName": "金鹰元祺", "rating3Y": ["4", "5"]}},
        {"id": "watch_lists", "group": "account", "method": "GET", "path": "/cn-api/user/watch/lists", "personal": True},
        {"id": "user_info", "group": "account", "method": "GET", "path": "/cn-api/user/getUserInfo", "personal": True},
        {"id": "authing_user", "group": "account", "method": "GET", "path": "/cn-api/authing/user", "personal": True},
        {"id": "fund_operation", "group": "overview", "method": "GET", "path": f"/cn-api/v2/funds/{code}/operation-data"},
        {"id": "fund_common", "group": "overview", "method": "GET", "path": f"/cn-api/v2/funds/{code}/common-data"},
        {"id": "fund_performance", "group": "performance", "method": "GET", "path": f"/cn-api/v2/funds/{code}/performance"},
        {"id": "fund_growth", "group": "performance", "method": "POST", "path": f"/cn-api/v2/funds/{code}/growth-data", "body": growth_body},
        {"id": "fund_asset_allocation", "group": "portfolio", "method": "GET", "path": f"/cn-api/v2/funds/{code}/asset-allocation"},
        {"id": "fund_sizes", "group": "portfolio", "method": "GET", "path": f"/cn-api/v2/funds/{code}/sizes"},
        {"id": "fund_owners", "group": "holders", "method": "GET", "path": f"/cn-api/v2/funds/{code}/owners"},
        {"id": "fund_holdings", "group": "portfolio", "method": "GET", "path": f"/cn-api/v2/funds/{code}/holdings"},
        {"id": "fund_fees", "group": "fees", "method": "GET", "path": f"/cn-api/v2/funds/{code}/fees"},
        {"id": "fund_equity", "group": "portfolio", "method": "GET", "path": f"/cn-api/v2/funds/{code}/equity"},
        {"id": "fund_fixed_income", "group": "portfolio", "method": "GET", "path": f"/cn-api/v2/funds/{code}/fixed-income"},
        {"id": "fund_managers", "group": "manager", "method": "GET", "path": f"/cn-api/v2/funds/{code}/managers"},
        {"id": "fund_manager_detail", "group": "manager", "method": "GET", "path": f"/cn-api/v2/funds/{code}/managers/{manager}"},
        {"id": "fund_holder", "group": "holders", "method": "GET", "path": f"/cn-api/v2/funds/{code}/holder"},
        {"id": "fund_holder_list", "group": "holders", "method": "GET", "path": f"/cn-api/v2/funds/{code}/holder-list"},
        {"id": "fund_best_fit_index", "group": "performance", "method": "GET", "path": f"/cn-api/v2/funds/{code}/best-fit-index"},
        {"id": "history_asset_allocation", "group": "history", "method": "GET", "path": f"/cn-api/v1/history/{code}/asset-allocation"},
        {"id": "history_asset_allocation_cio", "group": "history", "method": "GET", "path": f"/cn-api/v1/history/{code}/asset-allocation/cio"},
        {"id": "history_manager_change", "group": "history", "method": "GET", "path": f"/cn-api/v1/history/{code}/manager-change"},
        {"id": "history_effective_list", "group": "history", "method": "GET", "path": f"/cn-api/v1/history/{code}/effective-list"},
        {"id": "history_top_bonds", "group": "history", "method": "GET", "path": f"/cn-api/v1/history/{code}/top-10-bonds?effectiveDate=2026-03-31"},
        {"id": "history_asset_snapshot", "group": "history", "method": "GET", "path": f"/cn-api/v1/history/{code}/asset-allocation?effectiveDate=2026-03-31"},
        {"id": "fund_strategies", "group": "strategy", "method": "GET", "path": f"/cn-api/fund/strategies?csdcc={code}"},
        {"id": "fund_outlooks", "group": "strategy", "method": "GET", "path": f"/cn-api/fund/outlooks?csdcc={code}"},
        {"id": "fund_benchmarks", "group": "strategy", "method": "GET", "path": "/cn-api/fund/benchmarks"},
        {"id": "company_common", "group": "company", "method": "GET", "path": f"/cn-api/v2/companies/{company}/common-data"},
        {"id": "manager_profile", "group": "manager", "method": "GET", "path": f"/cn-api/manager?managerId={manager}"},
        {"id": "manager_return", "group": "manager", "method": "GET", "path": f"/cn-api/v2/manager/return?managerId={manager}&period=5&broadCategory=ALL"},
        {"id": "manager_performance_candidate", "group": "manager", "method": "GET", "path": f"/cn-api/v2/managers/{manager}/performance", "candidate": True},
        {"id": "fund_documents", "group": "documents", "method": "GET", "path": f"/cn-api/v2/funds/{code}/doc-list?docType=&skipNumber=0&pageSize=10"},
        {"id": "fund_document_download", "group": "documents", "method": "GET", "path": f"/cn-api/doc/download?docId={doc_id}", "binary": True},
    ]


def probe(spec: dict, token: str) -> dict:
    headers = {
        "accept": "application/json, text/plain, */*",
        "user-agent": "Mozilla/5.0 Morningstar-MCP-Research",
        "x-api-requestid": str(uuid.uuid4()).upper(),
    }
    if token:
        headers["token"] = token
    body = spec.get("body")
    encoded = None
    if body is not None:
        headers["content-type"] = "application/json"
        encoded = json.dumps(body, ensure_ascii=False).encode()
    request = urllib.request.Request(BASE_URL + spec["path"], data=encoded, headers=headers, method=spec["method"])
    started = time.monotonic()
    result = {key: value for key, value in spec.items() if key not in {"personal"}}
    result["request"] = {"headers": ["token", "x-api-requestid"] if token else ["x-api-requestid"]}
    if body is not None:
        result["request"]["body"] = body
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            status = response.status
            content_type = response.headers.get("content-type", "")
            content_length = response.headers.get("content-length")
            raw = response.read(1024 if spec.get("binary") else 8_000_000)
        result.update(
            {
                "httpStatus": status,
                "contentType": content_type,
                "durationMs": round((time.monotonic() - started) * 1000),
                "responseBytesRead": len(raw),
            }
        )
        if content_length:
            result["contentLength"] = int(content_length)
        if spec.get("binary"):
            result["binarySignature"] = raw[:8].hex()
            result["verified"] = status == 200 and raw.startswith(b"%PDF")
        else:
            data = json.loads(raw)
            payload = data.get("data") if isinstance(data, dict) and "data" in data else data
            result["meta"] = data.get("_meta") if isinstance(data, dict) else None
            result["responseShape"] = shape(payload)
            result["sample"] = "<personal response omitted>" if spec.get("personal") else bounded_sample(payload)
            result["verified"] = status == 200 and (
                not result["meta"] or result["meta"].get("response_status") == "200011"
            )
    except urllib.error.HTTPError as error:
        raw = error.read(1000)
        result.update(
            {
                "httpStatus": error.code,
                "durationMs": round((time.monotonic() - started) * 1000),
                "error": raw.decode(errors="replace")[:500],
                "verified": False,
            }
        )
    except Exception as error:
        result.update(
            {
                "durationMs": round((time.monotonic() - started) * 1000),
                "error": f"{type(error).__name__}: {error}",
                "verified": False,
            }
        )
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="docs/evidence/api-probe-results.json")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    token = load_token()
    if not token:
        raise SystemExit("MORNINGSTAR_TOKEN or auth.json is required")
    specs = endpoints()
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        results = list(executor.map(lambda spec: probe(spec, token), specs))
    report = {
        "baseUrl": BASE_URL,
        "sampleFund": "002490",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "summary": {
            "total": len(results),
            "verified": sum(bool(result.get("verified")) for result in results),
            "notVerified": sum(not result.get("verified") for result in results),
        },
        "results": results,
        "excludedMutations": [
            "POST /cn-api/user/watch/lists/add",
            "POST /cn-api/user/watch/lists/batch",
            "POST /cn-api/v2/template/save?source=local",
            "POST /cn-api/v2/template/delete",
            "POST /cn-api/v2/feedback/submit",
        ],
        "excludedDisabled": ["GET /cn-api/mcp/fund-review?csdcc={code} (production bundle disables it)"],
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report["summary"], ensure_ascii=False))
    for result in results:
        print(f"{result['id']}: HTTP {result.get('httpStatus', '-')} verified={result.get('verified')} meta={result.get('meta')}")


if __name__ == "__main__":
    main()
