#!/usr/bin/env python3
"""Extract Morningstar China screener definitions from the current frontend bundle.

Usage: python3 scripts/extract-screener-fields.py [bundle.js] [output.json]
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

BUNDLE_URL = "https://www.morningstar.cn/www-assets/screener-Cv2JJHYg.js"


def infer_type(item: dict, parent: dict | None = None) -> str:
    parent = parent or {}
    component = item.get("component") or parent.get("component")
    slider_type = item.get("sliderType") or parent.get("sliderType")
    if component == "checkbox-ternary":
        return "boolean-string"
    if component in {"checkbox", "select-options", "style-box"}:
        return "string-array"
    if component in {"range-slider", "group-switch-range", "group-flat"} or slider_type:
        return "range-string"
    return "string"


def request_fields(item: dict) -> list[dict]:
    result: list[dict] = []
    component = item.get("component")
    enum_components = {"checkbox", "radio", "style-box", "select-groups"}

    if item.get("dp") and component not in {"group-switch-range", "group-flat", "select-options"}:
        field = {
            "field": item["dp"],
            "label": item.get("label"),
            "valueType": infer_type(item),
            "unit": item.get("unit"),
            "sliderType": item.get("sliderType"),
        }
        if component in enum_components:
            values = [
                {"label": entry.get("label") or entry["value"], "value": entry["value"]}
                for entry in item.get("items", [])
                if "value" in entry
            ]
            for group in item.get("groups", []):
                values.extend(
                    {
                        "label": entry.get("label") or entry.get("value"),
                        "value": entry.get("value"),
                        "group": group.get("label"),
                    }
                    for entry in group.get("options", [])
                )
            if values:
                field["values"] = values
        result.append(field)

    for entry in item.get("dpList", []):
        field = entry.get("value") or entry.get("dp")
        if field:
            result.append(
                {
                    "field": field,
                    "label": entry.get("label"),
                    "valueType": infer_type(entry, item),
                    "unit": entry.get("unit", item.get("unit")),
                    "sliderType": entry.get("sliderType", item.get("sliderType")),
                }
            )

    entries = item.get("items", [])
    if component == "checkbox-ternary":
        result.extend(
            {
                "field": entry["dp"],
                "label": entry.get("label"),
                "valueType": "boolean-string",
                "values": ["true", "false"],
            }
            for entry in entries
            if entry.get("dp")
        )
    elif component == "select-options":
        values = [
            {"label": option.get("label") or option.get("value"), "value": option.get("value")}
            for option in item.get("options", [])
        ]
        for entry in entries:
            field = entry.get("value") or entry.get("dp")
            if field:
                result.append(
                    {
                        "field": field,
                        "label": entry.get("label"),
                        "valueType": "string-array",
                        "values": values,
                    }
                )
    elif component in {"group-switch-range", "group-flat"}:
        for entry in entries:
            if entry.get("dpList"):
                for option in entry["dpList"]:
                    field = option.get("value") or option.get("dp")
                    if field:
                        result.append(
                            {
                                "field": field,
                                "label": f"{entry.get('label')} - {option.get('label')}",
                                "valueType": infer_type(option, entry),
                                "unit": option.get("unit", entry.get("unit", item.get("unit"))),
                                "sliderType": option.get(
                                    "sliderType", entry.get("sliderType", item.get("sliderType"))
                                ),
                            }
                        )
            elif entry.get("dp"):
                field = {
                    "field": entry["dp"],
                    "label": entry.get("label"),
                    "valueType": infer_type(entry, item),
                    "unit": entry.get("unit", item.get("unit")),
                    "sliderType": entry.get("sliderType", item.get("sliderType")),
                }
                options = entry.get("options") or item.get("options")
                if options:
                    field["values"] = [
                        {"label": option.get("label") or option.get("value"), "value": option.get("value")}
                        for option in options
                    ]
                result.append(field)

    return [field for field in result if field.get("field")]


def load_raw_definitions(bundle: Path) -> list[dict]:
    source = bundle.read_text()
    marker = "Zt=e=>{let t="
    start = source.index(marker) + len(marker)
    end = source.index(",n=[];t.forEach", start)
    expression = source[start:end]
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as script:
        script.write(
            "const vm=require('vm');"
            f"const expression={json.dumps(expression)};"
            "const value=vm.runInNewContext('('+expression+')',Object.create(null),{timeout:1000});"
            "process.stdout.write(JSON.stringify(value));"
        )
        script_path = script.name
    try:
        return json.loads(subprocess.check_output(["node", script_path], text=True))
    finally:
        Path(script_path).unlink(missing_ok=True)


def build_catalog(raw: list[dict], source: str = "local") -> dict:
    catalog: dict = {"source": source, "groups": []}
    for group in raw:
        controls = []
        for item in group["subs"]:
            if item.get("source", "all") not in {"all", source}:
                continue
            control = {
                key: item[key]
                for key in (
                    "label",
                    "dp",
                    "columnId",
                    "source",
                    "component",
                    "unit",
                    "sliderType",
                    "step",
                    "comments",
                )
                if key in item
            }
            for key in ("items", "options", "groups", "dpList"):
                if key in item:
                    control[key] = item[key]
            control["requestFields"] = request_fields(item)
            controls.append(control)
        catalog["groups"].append({"label": group["label"], "controls": controls})

    by_field: dict[str, dict] = {}
    for group in catalog["groups"]:
        for control in group["controls"]:
            for field in control["requestFields"]:
                current = by_field.setdefault(
                    field["field"],
                    {
                        "field": field["field"],
                        "labels": [],
                        "valueType": field.get("valueType"),
                        "unit": field.get("unit"),
                        "examples": field.get("values"),
                    },
                )
                label = " / ".join(
                    filter(None, [group["label"], control.get("label"), field.get("label")])
                )
                if label not in current["labels"]:
                    current["labels"].append(label)
    catalog["requestFields"] = list(by_field.values())
    catalog["summary"] = {
        "groupCount": len(catalog["groups"]),
        "controlCount": sum(len(group["controls"]) for group in catalog["groups"]),
        "requestFieldCount": len(catalog["requestFields"]),
    }
    return catalog


def main() -> None:
    bundle = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/morningstar-screener.js")
    output = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("docs/screener-fields.json")
    if not bundle.exists():
        subprocess.run(["curl", "-fsS", BUNDLE_URL, "-o", str(bundle)], check=True)
    catalog = build_catalog(load_raw_definitions(bundle))
    catalog["bundle"] = bundle.name
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(catalog["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()
