#!/usr/bin/env python3
"""One-request JSON bridge around the private proposal planner.

The browser-facing Node plugin owns HTTP. This bridge deliberately exposes
only the planner's safe public actions, keeping the old MCP transport out of
the DeepSeek Harness integration.
"""

from __future__ import annotations

import json
import sys
from typing import Any

import planner_engine as planner


def fail(message: str) -> None:
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))


def main() -> int:
    if len(sys.argv) != 2:
        fail("缺少规划器操作。"); return 2
    try:
        raw = sys.stdin.read()
        arguments: Any = json.loads(raw or "{}")
        params = planner.require_mapping(arguments, "工具参数")
        operation = sys.argv[1]
        if operation == "inspect":
            root = planner.ensure_project_root(params.get("project_path"))
            result: dict[str, Any] = {"ok": True, **planner.scan_project(root)}
        elif operation == "stage":
            result = planner.stage_proposal(params)
        elif operation == "create":
            result = planner.create_assets(params)
        elif operation == "get":
            result = planner.get_proposal(params)
        elif operation == "apply":
            result = planner.apply_proposal(params)
        elif operation == "discard":
            result = planner.discard_proposal(params)
        else:
            raise planner.PlannerError("未知规划器操作。")
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
        return 0
    except planner.PlannerError as error:
        fail(str(error)); return 1
    except (ValueError, TypeError) as error:
        fail(f"请求格式无效：{error}"); return 1
    except Exception:
        # Avoid exposing local paths or Python internals to the browser/model.
        fail("本地规划器发生未预期错误，请查看 Harness 日志。"); return 1


if __name__ == "__main__":
    raise SystemExit(main())
