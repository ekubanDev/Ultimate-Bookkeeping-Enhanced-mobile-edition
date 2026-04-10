#!/usr/bin/env python3
"""
MCP (Model Context Protocol) stdio server for Ultimate Bookkeeping.

Read-only tools that mirror the web app's AI chat snapshot (inventory, sales, PO signals).

Install (separate venv recommended — avoids Starlette pins from the FastAPI stack):
  pip install -r requirements-mcp.txt

Run:
  cd backend && python mcp_server.py

Claude Desktop — add to claude_desktop_config.json → mcpServers:
  "ultimate-bookkeeping": {
    "command": "python3",
    "args": ["/ABSOLUTE/PATH/TO/repo/backend/mcp_server.py"]
  }

Or with a venv interpreter for the args[0] python that has requirements-mcp installed.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from pathlib import Path

# Ensure backend dir is importable when run as a script
_BACKEND_DIR = Path(__file__).resolve().parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

import mcp.types as types
from mcp.server import Server
from mcp.server.lowlevel.server import NotificationOptions
from mcp.server.models import InitializationOptions
from mcp.server.stdio import stdio_server

from ai_chat_tools import compute_business_snapshot, snapshot_json_for_prompt

logger = logging.getLogger("bookkeeping-mcp")
logging.basicConfig(level=logging.INFO, stream=sys.stderr, format="%(levelname)s %(message)s")

server = Server("ultimate-bookkeeping")


def _parse_json_array(raw: str | None, label: str) -> list:
    if not raw or not str(raw).strip():
        return []
    try:
        data = json.loads(raw)
        if not isinstance(data, list):
            raise ValueError(f"{label} must be a JSON array")
        return data
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON for {label}: {e}") from e


@server.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="bookkeeping_snapshot",
            description=(
                "Compute read-only metrics from bookkeeping exports: low stock, restock priority by 90d revenue, "
                "top sellers (90d), slow movers, last restock/PO dates. Pass each dataset as a JSON array string "
                "(empty string if unused). Aligns with the in-app AI assistant snapshot."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "products_json": {
                        "type": "string",
                        "description": 'JSON array of products, e.g. [{"id":"...","name":"...","quantity":10,"minStock":5,"cost":40,"price":60}]',
                    },
                    "sales_json": {
                        "type": "string",
                        "description": 'JSON array of sale lines, e.g. [{"date":"2026-01-01","product":"Widget","quantity":2,"price":50,"discount":0}]',
                    },
                    "purchase_orders_json": {
                        "type": "string",
                        "description": 'JSON array of POs with status, receivedDate, items[].productId',
                    },
                },
            },
            annotations=types.ToolAnnotations(readOnlyHint=True, title="Bookkeeping snapshot"),
        ),
        types.Tool(
            name="bookkeeping_snapshot_from_file",
            description=(
                "Load a local JSON file with keys products, sales, purchase_orders (arrays). "
                "Use absolute path. Read-only."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute path to JSON file"},
                },
                "required": ["path"],
            },
            annotations=types.ToolAnnotations(readOnlyHint=True, title="Snapshot from JSON file"),
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict | None) -> list[types.TextContent]:
    args = arguments or {}
    try:
        if name == "bookkeeping_snapshot":
            products = _parse_json_array(args.get("products_json"), "products_json")
            sales = _parse_json_array(args.get("sales_json"), "sales_json")
            pos = _parse_json_array(args.get("purchase_orders_json"), "purchase_orders_json")
            # Same caps as HTTP API
            products = products[:2000]
            sales = sales[:3500]
            pos = pos[:600]
            snap = compute_business_snapshot(
                {"products": products, "sales": sales, "purchase_orders": pos}
            )
            return [types.TextContent(type="text", text=snapshot_json_for_prompt(snap))]

        if name == "bookkeeping_snapshot_from_file":
            path = (args.get("path") or "").strip()
            if not path:
                raise ValueError("path is required")
            p = Path(path).expanduser().resolve()
            if not p.is_file():
                raise ValueError(f"File not found: {p}")
            raw = p.read_text(encoding="utf-8")
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError("Root JSON must be an object")
            snap = compute_business_snapshot(
                {
                    "products": data.get("products") or [],
                    "sales": data.get("sales") or [],
                    "purchase_orders": data.get("purchase_orders") or [],
                }
            )
            return [types.TextContent(type="text", text=snapshot_json_for_prompt(snap))]

        raise ValueError(f"Unknown tool: {name}")
    except Exception as exc:
        logger.exception("tool error")
        return [types.TextContent(type="text", text=f"Error: {exc}")]


async def main() -> None:
    init = InitializationOptions(
        server_name="ultimate-bookkeeping",
        server_version="1.0.0",
        capabilities=server.get_capabilities(
            notification_options=NotificationOptions(),
            experimental_capabilities={},
        ),
        instructions=(
            "Ultimate Bookkeeping MCP: read-only inventory and sales aggregates. "
            "No writes to Firestore or APIs. Paste export JSON into bookkeeping_snapshot or point to a local bundle file."
        ),
    )
    async with stdio_server() as streams:
        await server.run(streams[0], streams[1], init)


if __name__ == "__main__":
    asyncio.run(main())
