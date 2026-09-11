#!/usr/bin/env python3
"""Read one page of Datadog EU spans without exposing credentials in argv."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys


def authentication():
    token = os.environ.get("DATADOG_API_KEY") or os.environ.get("DD_API_KEY")
    if not token:
        raise ValueError("Source shell-credentials first; DATADOG_API_KEY is absent.")
    if token.startswith(("ddpat_", "ddsat_")):
        return [f"Authorization: Bearer {token}"], [token]
    app_key = (
        os.environ.get("DATADOG_APP_KEY")
        or os.environ.get("DATADOG_APPLICATION_KEY")
        or os.environ.get("DD_APP_KEY")
    )
    if not app_key:
        raise ValueError(
            "Credential is not a recognized PAT or SAT. Check its type. "
            "Legacy API-key authentication also requires DATADOG_APP_KEY."
        )
    return [f"DD-API-KEY: {token}", f"DD-APPLICATION-KEY: {app_key}"], [token, app_key]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--query", required=True)
    parser.add_argument("--from", dest="start", default="now-1h")
    parser.add_argument("--to", dest="end", default="now")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--cursor")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not 1 <= args.limit <= 1000:
        parser.error("--limit must be between 1 and 1000")

    try:
        headers, secrets = authentication()
    except ValueError as error:
        parser.error(str(error))
    page = {"limit": args.limit}
    if args.cursor:
        page["cursor"] = args.cursor
    payload = {"data": {"type": "search_request", "attributes": {
        "filter": {"from": args.start, "to": args.end, "query": args.query},
        "page": page,
        "sort": "-timestamp",
    }}}
    config = 'url = "https://api.datadoghq.eu/api/v2/spans/events/search"\n'
    config += "".join(f"header = {json.dumps(header)}\n" for header in headers)
    result = subprocess.run(
        ["curl", "-q", "--silent", "--show-error", "--max-time", "60",
         "--config", "-", "--header", "Content-Type: application/json",
         "--data-binary", json.dumps(payload), "--write-out", "\n%{http_code}"],
        input=config, text=True, capture_output=True,
    )
    body, _, status = result.stdout.rpartition("\n")
    if result.returncode or status != "200":
        detail = result.stderr or body
        for secret in secrets:
            detail = detail.replace(secret, "[redacted]")
        print(f"Datadog request failed: HTTP {status or 'unavailable'}, "
              f"curl exit {result.returncode}. {detail[:1000]}", file=sys.stderr)
        return 1
    response = json.loads(body)
    if args.output:
        args.output.write_text(json.dumps(response, indent=2) + "\n")
        meta = response.get("meta", {})
        print(json.dumps({
            "output": str(args.output),
            "count": len(response.get("data", [])),
            "status": meta.get("status"),
            "traffic_type": meta.get("traffic_type"),
            "next_cursor": (meta.get("page") or {}).get("after"),
        }))
    else:
        print(json.dumps(response, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
