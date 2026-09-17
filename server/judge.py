#!/usr/bin/env python3
"""Judge for a single submission.

Reads a JSON job on stdin:
    {
      "code": "<user python source>",
      "className": "Solution",
      "method": "twoSum",
      "tests": [{"name": "...", "args": [...], "expected": ..., "unordered": true}, ...],
      "timeLimitMs": 5000
    }

Writes a JSON result on stdout:
    {
      "ok": true,
      "results": [
        {"name": "...", "passed": true, "got": ..., "expected": ..., "error": null, "durationMs": 1},
        ...
      ],
      "compileError": null,
      "summary": {"passed": 5, "total": 5}
    }

User code runs in a subprocess with a wall-clock timeout so an infinite loop
can never hang the server.
"""

import io
import json
import sys
import time
import traceback
import contextlib


def run_job(job: dict) -> dict:
    code = job.get("code") or ""
    class_name = job.get("className") or "Solution"
    method_name = job.get("method") or ""
    tests = job.get("tests") or []

    namespace: dict = {}
    compile_error = None
    try:
        compiled = compile(code, "<submission>", "exec")
        exec(compiled, namespace)  # noqa: S102 - intentional: this is a code judge
    except SyntaxError as e:
        line = (e.lineno or 0)
        pointer = ""
        if e.text:
            pointer = "\n    " + e.text.rstrip() + "\n    " + " " * max(0, (e.offset or 1) - 1) + "^"
        compile_error = f"SyntaxError: {e.msg} (line {line}){pointer}"
    except Exception as e:  # noqa: BLE001
        compile_error = "".join(traceback.format_exception_only(type(e), e)).strip()

    if compile_error:
        return {
            "ok": False,
            "compileError": compile_error,
            "results": [],
            "summary": {"passed": 0, "total": len(tests)},
        }

    cls = namespace.get(class_name)
    if cls is None:
        return {
            "ok": False,
            "compileError": f"RuntimeError: class `{class_name}` not found in your code.",
            "results": [],
            "summary": {"passed": 0, "total": len(tests)},
        }

    try:
        instance = cls()
    except Exception as e:  # noqa: BLE001
        return {
            "ok": False,
            "compileError": "RuntimeError: could not instantiate "
            f"`{class_name}()`: {e}",
            "results": [],
            "summary": {"passed": 0, "total": len(tests)},
        }

    method = getattr(instance, method_name, None)
    if method is None or not callable(method):
        return {
            "ok": False,
            "compileError": f"RuntimeError: method `{method_name}` not found on `{class_name}`.",
            "results": [],
            "summary": {"passed": 0, "total": len(tests)},
        }

    results = []
    for test in tests:
        results.append(run_one(method, test))

    passed = sum(1 for r in results if r["passed"])
    return {
        "ok": passed == len(results) and len(results) > 0,
        "compileError": None,
        "results": results,
        "summary": {"passed": passed, "total": len(results)},
    }


def run_one(method, test: dict) -> dict:
    args = test.get("args", [])
    expected = test.get("expected")
    unordered = bool(test.get("unordered"))
    name = test.get("name", "test")

    stdout_buf = io.StringIO()
    start = time.perf_counter()
    error = None
    got = None
    try:
        with contextlib.redirect_stdout(stdout_buf):
            got = method(*args)
    except Exception as e:  # noqa: BLE001
        tb = traceback.extract_tb(sys.exc_info()[2])
        # Drop judge frames so the user only sees their own code.
        user_frames = [f for f in tb if f.filename == "<submission>"]
        if user_frames:
            last = user_frames[-1]
            error = f"{type(e).__name__}: {e} (line {last.lineno})"
        else:
            error = f"{type(e).__name__}: {e}"
    duration_ms = round((time.perf_counter() - start) * 1000, 2)

    passed = False
    if error is None:
        passed = compare(got, expected, unordered)

    return {
        "name": name,
        "passed": passed,
        "got": safe_repr(got),
        "expected": safe_repr(expected),
        "error": error,
        "stdout": stdout_buf.getvalue()[:2000],
        "durationMs": duration_ms,
    }


def compare(got, expected, unordered: bool) -> bool:
    if unordered and isinstance(got, (list, tuple)) and isinstance(expected, (list, tuple)):
        try:
            return sorted(list(got)) == sorted(list(expected))
        except TypeError:
            return list(got) == list(expected)
    if isinstance(got, tuple) and isinstance(expected, list):
        return list(got) == expected
    return got == expected


def safe_repr(value) -> str:
    try:
        r = repr(value)
    except Exception as e:  # noqa: BLE001
        return f"<unrepresentable: {e}>"
    return r if len(r) <= 500 else r[:500] + "…"


def main() -> None:
    raw = sys.stdin.read()
    try:
        job = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "compileError": f"Bad job JSON: {e}", "results": [], "summary": {"passed": 0, "total": 0}}))
        return
    print(json.dumps(run_job(job)))


if __name__ == "__main__":
    main()
