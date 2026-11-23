"""Start/stop requirements-manager and receive Matrix callbacks for manual testing."""
import argparse
import base64
import json
import math
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def envelope(**result):
    return {"success": True, "message": "", "code": 200, "result": result}


def post(url, payload, timeout):
    request = Request(url, json.dumps(payload).encode(), {"Content-Type": "application/json"}, method="POST")
    with urlopen(request, timeout=timeout) as response:
        return json.load(response)


def listen(args):
    lock = threading.Lock()
    terminal = {}
    prefix = "/" + args.prefix.strip("/") if args.prefix.strip("/") else ""

    class Handler(BaseHTTPRequestHandler):
        def reply(self, code, value):
            data = json.dumps(value, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            paths = {prefix + "/matrix/internal/tools/" + kind: kind for kind in ("progress", "result")}
            paths[prefix + "/mock/cancel"] = "cancel"
            kind = paths.get(self.path)
            if not kind:
                return self.reply(404, {"message": "unknown path"})
            try:
                size = int(self.headers.get("Content-Length", ""))
                if not 0 < size <= 2 * 1024 * 1024:
                    raise ValueError("invalid content length")
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict):
                    raise ValueError("expected JSON object")
                key = (body["toolId"], body["runId"])
                if not all(isinstance(item, str) and item.strip() for item in key):
                    raise ValueError("toolId and runId are required")
                if kind == "progress":
                    percent = body.get("percent")
                    if type(percent) is not int or not 0 <= percent <= 100:
                        raise ValueError("invalid percent")
            except (ValueError, KeyError, TypeError) as error:
                return self.reply(400, {"success": False, "message": str(error), "code": 400})
            print(f"{kind} {json.dumps(body, ensure_ascii=False)}", flush=True)
            with lock:
                state = terminal.get(key)
                if state:
                    result = envelope(ack=False, state=state, reason="任务已终态")
                elif kind == "progress":
                    result = envelope(ack=True, state="RUNNING")
                elif kind == "cancel":
                    terminal[key] = "CANCELLED"
                    result = envelope(ack=True, state="CANCELLED")
                else:
                    result_json = body.get("resultJson")
                    summary = result_json.get("summary") if isinstance(result_json, dict) else None
                    count = summary.get("requirementCount") if isinstance(summary, dict) else None
                    coverage = summary.get("requirementCoverage") if isinstance(summary, dict) else None
                    valid = (type(count) is int and 0 <= count <= 2147483647 and
                             type(coverage) in (int, float) and 0 <= coverage <= 100 and math.isfinite(coverage))
                    state = "COMPLETED" if body.get("status") == "completed" and valid else "FAILED"
                    terminal[key] = state
                    result = envelope(ack=True, state=state)
                    if state == "FAILED" and body.get("status") != "failed":
                        result["result"]["reason"] = "结果校验未通过"
            self.reply(200, result)

    with ThreadingHTTPServer((args.host, args.port), Handler) as server:
        print(f"Listening on {args.host}:{args.port}{prefix}", flush=True)
        server.serve_forever()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    receiver = commands.add_parser("listen", help="receive and acknowledge callbacks")
    receiver.add_argument("--host", default="0.0.0.0")
    receiver.add_argument("--port", type=int, default=8086)
    receiver.add_argument("--prefix", default="/jeecg-boot")
    for command in ("start", "stop"):
        sender = commands.add_parser(command)
        sender.add_argument("--url", required=True, help="requirements-manager base URL")
        sender.add_argument("--run-id", required=True)
        sender.add_argument("--project-id", default="mock-project")
        sender.add_argument("--session-id", default="mock-session")
        if command == "start":
            sender.add_argument("--doc-zip", type=Path, required=True)
            sender.add_argument("--project-name", default="Matrix 联调项目")
            sender.add_argument("--project-version", default="")
            sender.add_argument("--lang-type", default="")
        else:
            sender.add_argument("--listener", help="callback base URL, used to mark the mock task cancelled")
    args = parser.parse_args()
    try:
        if args.command == "listen":
            listen(args)
            return 0
        ids = {"toolId": "planning", "runId": args.run_id}
        payload = {**ids, "projectId": args.project_id, "sessionId": args.session_id}
        if args.command == "start":
            payload.update(projectName=args.project_name, projectVersion=args.project_version,
                           langType=args.lang_type, codePackageBase64="",
                           docPackageBase64=base64.b64encode(args.doc_zip.read_bytes()).decode("ascii"))
        response = post(f"{args.url.rstrip('/')}/api/{args.command}", payload,
                        1800 if args.command == "start" else 30)
        print(json.dumps({**ids, "response": response}, ensure_ascii=False, indent=2))
        accepted = response.get("result", {}).get("accepted") is True
        if accepted and args.command == "stop" and args.listener:
            post(f"{args.listener.rstrip('/')}/mock/cancel", ids, 5)
        return 0 if accepted else 1
    except HTTPError as error:
        parser.exit(1, f"HTTP {error.code} {error.read().decode(errors='replace')}\n")
    except (OSError, URLError, ValueError) as error:
        parser.exit(1, f"{error}\n")
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
