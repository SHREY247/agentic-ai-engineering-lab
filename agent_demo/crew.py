"""Manager-led CrewAI team that builds a feature from a plain-English request.

Five CrewAI roles: Gemini Manager (orchestrator), Gemini Architect and QA,
Groq Backend and Frontend. The flow is test-first:

  Architect writes a spec -> QA writes acceptance tests (they must fail first)
  -> Backend and Frontend write code until the tests pass -> QA runs everything
  -> an independent release gate, with no AI involved, decides pass or fail.

Only three files are writable, each by one role through one tool.

WARNING: Node executes model-generated JavaScript in the host process. Use only
in a disposable VM/container with no personal files or real service credentials.
"""
from __future__ import annotations

import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from orchestration import SupervisorState, parse_decision

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "site/feature.js"
BACKEND = ROOT / "api/feature.mjs"
TESTS = ROOT / "tests/feature.acceptance.test.mjs"
CONTRACT_TESTS = "tests/feature.contract.test.mjs"
INDEPENDENT_DISCOUNT_TESTS = "tests/student-discount.independent.test.mjs"
STARTER_TESTS = ROOT / "facilitator/starter/feature.acceptance.test.mjs"
CONTRACT = (ROOT / "agent_demo/FEATURE_CONTRACT.md").read_text(encoding="utf-8")
RUNS = ROOT / "runs"
ROLES = {"Manager": "gemini", "Architect": "gemini", "QA": "gemini", "Backend": "groq", "Frontend": "groq"}
DEFAULT_REQUEST = "Implement the student discount section in my cart."
FEATURE_REQUEST = re.sub(r"\s+", " ", os.getenv("CAMPUSBITES_FEATURE_REQUEST") or DEFAULT_REQUEST).strip()[:1600]
DISCOUNT_DEMO = os.getenv("CAMPUSBITES_STUDENT_DISCOUNT_DEMO", "").strip() == "1" or bool(
    re.search(r"STUDENT10|student.{0,35}(coupon|discount|offer)|(coupon|discount).{0,35}student|discount section", FEATURE_REQUEST, flags=re.I))
MODELS = {
    "groq": os.getenv("GROQ_MODEL", "groq/openai/gpt-oss-120b"),
    "gemini": os.getenv("GEMINI_MODEL", "gemini/gemini-3.5-flash-lite"),
}
# Local guard for every model call made through CrewAI. This is a *request*
# ceiling, not a promise about provider quotas.
REQUEST_CAPS = {
    "gemini": int(os.getenv("CAMPUSBITES_GEMINI_CALL_CAP", "16")),
    "groq": int(os.getenv("CAMPUSBITES_GROQ_CALL_CAP", "10")),
}
# Free tiers limit requests per minute; space calls out instead of hitting 429s.
MIN_INTERVAL = {
    "gemini": 60.0 / float(os.getenv("CAMPUSBITES_GEMINI_RPM", "10")),
    "groq": 60.0 / float(os.getenv("CAMPUSBITES_GROQ_RPM", "6")),
}
MAX_WRITES_PER_ASSIGNMENT = 2
request_counts = {"gemini": 0, "groq": 0}
last_call_at = {"gemini": 0.0, "groq": 0.0}

RUN_ID = re.sub(r"[^a-zA-Z0-9_-]", "", os.getenv("CAMPUSBITES_RUN_ID", "")) or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
RUN_DIR = RUNS / RUN_ID
RUN_DIR.mkdir(parents=True, exist_ok=True)
INDEPENDENT_TESTS_SHA = hashlib.sha256((ROOT / INDEPENDENT_DISCOUNT_TESTS).read_bytes()).hexdigest()
start_time = time.monotonic()
changed = set()
records = []
step_outputs = {}
manager_decisions = []
write_counts = {"Backend": 0, "Frontend": 0, "QA": 0}
assignment_writes = {"Backend": 0, "Frontend": 0, "QA": 0}
qa_runs = 0
tests_sha = None
last_test_summary = {"pass": 0, "fail": 0, "failing": []}
supervisor = SupervisorState(max_corrections=int(os.getenv("CAMPUSBITES_MAX_CORRECTIONS", "1")))
secrets = [os.environ.get(k, "") for k in ("GROQ_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY")]
secrets = [s for s in secrets if len(s) > 5]


def scrub(value):
    value = str(value)
    for secret in secrets:
        value = value.replace(secret, "[REDACTED]")
    return value[:2500]


def sha256(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def persist():
    (RUN_DIR / "events.json").write_text(json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8")


def emit(actor, title, detail="", kind="info", *, evidence=None):
    rec = {
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "seconds": round(time.monotonic() - start_time, 2),
        "actor": actor,
        "provider": ROLES.get(actor),
        "model": MODELS.get(ROLES.get(actor)),
        "title": scrub(title)[:140],
        "detail": scrub(detail),
        "type": kind,
    }
    if evidence:
        rec["evidence"] = evidence
    records.append(rec)
    persist()
    print("EVENT " + json.dumps(rec, ensure_ascii=False), flush=True)


# ---- Ground truth: the tests ------------------------------------------------

def execute_tests(files=None):
    if files is None:
        files = (CONTRACT_TESTS, "tests/feature.acceptance.test.mjs") + ((INDEPENDENT_DISCOUNT_TESTS,) if DISCOUNT_DEMO else ())
    """Run the real Node tests. Returns (passed, output, summary)."""
    try:
        env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": os.environ.get("USERPROFILE", os.environ.get("HOME", "/tmp")),
            "SystemRoot": os.environ.get("SystemRoot", r"C:\Windows"),
            "PATHEXT": os.environ.get("PATHEXT", ".COM;.EXE;.BAT;.CMD"),
        }
        run = subprocess.run(["node", "--test", "--test-reporter=tap", *files],
                             cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30, check=False, env=env)
        output = (run.stdout + "\n" + run.stderr)[-12000:]
        passed = run.returncode == 0
    except (OSError, subprocess.TimeoutExpired) as exc:
        output, passed = f"Test runner failed: {type(exc).__name__}: {exc}", False
    count = lambda name: int(m.group(1)) if (m := re.search(rf"^# {name} (\d+)", output, re.M)) else 0
    failing = re.findall(r"^not ok \d+ - (.+)$", output, re.M)
    return passed, output, {"pass": count("pass"), "fail": count("fail"), "failing": failing[:12]}


def failure_details(output, names):
    """Short assertion messages for the given failing tests, for agent feedback."""
    notes = []
    for name in names[:5]:
        block = output.split(f"- {name}", 1)[-1][:1500]
        msg = re.search(r"error: \|?-?\s*\n?\s*(.+)", block)
        exp = re.search(r"expected: (.+)", block)
        act = re.search(r"actual: (.+)", block)
        # Quote the failing assertion so the agent sees which field or value the test checks.
        where = re.search(r"stack:.*?(tests/[\w.-]+\.mjs):(\d+):\d+", block, re.S)
        line = ""
        if where:
            try:
                line = (ROOT / where.group(1)).read_text(encoding="utf-8").splitlines()[int(where.group(2)) - 1].strip()
            except (OSError, IndexError):
                pass
        notes.append(f"- {name}: {(msg.group(1).strip() if msg else 'failed')[:160]}"
                     + (f" (expected {exp.group(1)[:60]}, got {act.group(1)[:60]})" if exp and act else "")
                     + (f" at `{line[:160]}`" if line else ""))
    return "\n".join(notes)


def test_count(source):
    return len(re.findall(r"^\s*test\s*\(", source, re.M))


# ---- Guarded file writes ----------------------------------------------------

COMMON_BLOCKED = [r"\brequire\s*\(", r"\beval\s*\(", r"\bprocess\.", r"\bchild_process\b", r"\bFunction\s*\(",
                  r"\bfs\b", r"\bWebSocket\b", r"\bglobalThis\b", r"\bsetTimeout\s*\(", r"\bsetInterval\s*\(",
                  r"\bwhile\s*\(\s*true\s*\)", r"\bfor\s*\(\s*;\s*;\s*\)"]
CODE_BLOCKED = COMMON_BLOCKED + [r"^\s*import\b", r"\bimport\s*\(", r"\bfetch\s*\("]
FRONTEND_BLOCKED = CODE_BLOCKED + [r"\bdocument\b", r"\bwindow\b", r"\blocalStorage\b", r"\bXMLHttpRequest\b"]
TESTS_ALLOWED_IMPORTS = {"node:test", "node:assert/strict", "./helpers.mjs"}


def check_rules(content, *, exports, blocked, min_len, max_len):
    if len(content) < min_len or len(content) > max_len:
        return f"REJECTED: file must contain {min_len}–{max_len} characters (got {len(content)})"
    for name in exports:
        if not re.search(rf"export\s+(async\s+)?(function|const)\s+{re.escape(name)}\b", content):
            return f"REJECTED: missing `export ... {name}` required by the contract"
    for pattern in blocked:
        if re.search(pattern, content, re.M):
            return f"REJECTED: unsupported or unsafe JavaScript ({pattern}). Follow the contract rules."
    return None


def syntax_error(content, suffix):
    candidate = RUN_DIR / ("candidate" + suffix)
    candidate.write_text(content + "\n", encoding="utf-8")
    try:
        check = subprocess.run(["node", "--check", str(candidate)], cwd=ROOT, capture_output=True,
                               text=True, timeout=12, check=False)
        return scrub(check.stderr)[-380:] if check.returncode else None
    finally:
        candidate.unlink(missing_ok=True)


def save(target: Path, content: str, actor: str):
    """Write an allow-listed file and keep a diff + hashes as evidence."""
    old = target.read_text(encoding="utf-8") if target.exists() else ""
    target.write_text(content + "\n", encoding="utf-8")
    changed.add(actor)
    write_counts[actor] += 1
    assignment_writes[actor] += 1
    rel = str(target.relative_to(ROOT))
    diff = "".join(difflib.unified_diff(old.splitlines(keepends=True), (content + "\n").splitlines(keepends=True),
                                        fromfile="before/" + rel, tofile="after/" + rel))
    patch = f"{actor.lower()}-attempt-{write_counts[actor]}.patch"
    (RUN_DIR / patch).write_text(diff, encoding="utf-8")
    (RUN_DIR / f"{actor.lower()}.patch").write_text(diff, encoding="utf-8")
    emit(actor, "Real source file written", rel, "tool",
         evidence={"file": rel, "before_sha256": sha256(old), "after_sha256": sha256(content + "\n"), "patch": patch})
    return sha256(content + "\n")


def write_code(target: Path, content: str, actor: str, exports, blocked, prefix: str) -> str:
    content = content.strip()
    if assignment_writes[actor] >= MAX_WRITES_PER_ASSIGNMENT:
        return "REJECTED: write limit reached for this assignment. Stop and report the last result."
    problem = check_rules(content, exports=exports, blocked=blocked, min_len=150, max_len=6500)
    if problem:
        emit(actor, "Write rejected by guardrail", problem, "error")
        return problem
    error = syntax_error(content, target.suffix)
    if error:
        emit(actor, "Rejected invalid JavaScript syntax", error, "error")
        return "REJECTED: invalid JavaScript syntax: " + error
    digest = save(target, content, actor)
    # Ground truth for the agent: run the tests now and report only failures in its own area.
    passed, output, summary = execute_tests()
    mine = [n for n in summary["failing"] if n.startswith(prefix) or (prefix == "API:" and "backend" in n.lower())
            or (prefix == "UI:" and n.startswith("Contract:") and "backend" not in n.lower())]
    emit(actor, "Ran tests after writing", f"{summary['pass']} pass / {summary['fail']} fail; {len(mine)} in my area", "test")
    if not mine:
        return f"SAVED (SHA256 {digest[:12]}). All {prefix} tests in your area pass. Stop and report success."
    return (f"SAVED (SHA256 {digest[:12]}), but {len(mine)} of your tests still fail:\n"
            + failure_details(output, mine) + "\nFix the file and call the tool again with the COMPLETE file.")


def write_tests(content: str) -> str:
    global tests_sha
    content = content.strip()
    if assignment_writes["QA"] >= MAX_WRITES_PER_ASSIGNMENT:
        return "REJECTED: write limit reached. Report the last result."
    problem = check_rules(content, exports=[], min_len=200, max_len=7000,
                          blocked=COMMON_BLOCKED + [r"\bfetch\s*\(", r"\bimport\s*\(", r"^\s*import\s*['\"]"])
    imports = re.findall(r"^\s*import\b[^;]*?from\s*['\"]([^'\"]+)['\"]", content, re.M)
    if not problem and (not imports or any(i not in TESTS_ALLOWED_IMPORTS for i in imports)):
        problem = f"REJECTED: tests may import only {sorted(TESTS_ALLOWED_IMPORTS)}"
    if not problem and not 3 <= test_count(content) <= 10:
        problem = f"REJECTED: write 3 to 10 test() blocks (found {test_count(content)})"
    if not problem and (error := syntax_error(content, ".mjs")):
        problem = "REJECTED: invalid JavaScript syntax: " + error
    if problem:
        emit("QA", "Tests rejected by guardrail", problem, "error")
        return problem
    old = TESTS.read_text(encoding="utf-8")
    TESTS.write_text(content + "\n", encoding="utf-8")
    # Test-first rule: before any feature code exists, the new tests must fail.
    _, _, summary = execute_tests(("tests/feature.acceptance.test.mjs",))
    if summary["fail"] == 0:
        TESTS.write_text(old, encoding="utf-8")
        emit("QA", "Tests rejected: they pass without the feature", "Tests must fail until the feature exists.", "error")
        return "REJECTED: these tests already pass with no feature installed, so they test nothing. Rewrite them."
    TESTS.write_text(old, encoding="utf-8")
    tests_sha = save(TESTS, content, "QA")
    emit("QA", "Acceptance tests written (failing, as expected)",
         f"{test_count(content)} tests; {summary['fail']} fail before any code exists", "test")
    return f"SAVED {test_count(content)} tests. They fail now, as they should before the code exists. Stop and report."


def main():
    global qa_runs, last_test_summary
    emit("System", "Run initialized", f"Run ID: {RUN_ID}; feature request: {FEATURE_REQUEST}", "start")
    emit("System", "Model budget", f"Gemini max calls: {REQUEST_CAPS['gemini']}; Groq max calls: {REQUEST_CAPS['groq']}; corrections allowed: {supervisor.max_corrections}", "info")
    if not os.environ.get("GROQ_API_KEY") or not (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")):
        emit("System", "Missing model API credentials", "GROQ_API_KEY and GEMINI_API_KEY (or GOOGLE_API_KEY) are required.", "error")
        return 2
    if TESTS.read_text(encoding="utf-8") != STARTER_TESTS.read_text(encoding="utf-8"):
        emit("System", "Workspace is not reset", "Click Reset in /office (or copy facilitator/starter/*) before a new run.", "error")
        return 2
    try:
        from crewai import Agent, Crew, LLM, Process, Task
        from crewai.tools import tool
    except ImportError as exc:
        emit("System", "CrewAI dependencies missing", "Install agent_demo/requirements.txt. " + str(exc), "error")
        return 2

    try:
        def budgeted(llm, provider):
            """Count, pace and cap every model call before it leaves the process.
            Patched on the instance: CrewAI swaps LLM subclasses for native provider classes."""
            original = llm.call

            def call(*args, **kwargs):
                # CrewAI tags messages with "cache_breakpoint" but its LiteLLM path never strips it,
                # and Groq rejects unknown message fields. Drop it on copies before sending.
                if args and isinstance(args[0], list):
                    args = ([{k: v for k, v in m.items() if k != "cache_breakpoint"} if isinstance(m, dict) else m
                             for m in args[0]],) + args[1:]
                elif isinstance(kwargs.get("messages"), list):
                    kwargs["messages"] = [{k: v for k, v in m.items() if k != "cache_breakpoint"} if isinstance(m, dict) else m
                                          for m in kwargs["messages"]]
                for attempt in range(3):
                    if request_counts[provider] >= REQUEST_CAPS[provider]:
                        emit("System", "Model call budget exhausted", f"{provider}: {request_counts[provider]}/{REQUEST_CAPS[provider]}", "error")
                        raise RuntimeError(f"{provider} call cap exhausted; stopping rather than spending more quota")
                    wait = last_call_at[provider] + MIN_INTERVAL[provider] - time.monotonic()
                    if wait > 0:
                        time.sleep(wait)
                    request_counts[provider] += 1
                    last_call_at[provider] = time.monotonic()
                    emit("System", "LLM call issued", f"{provider}: {request_counts[provider]}/{REQUEST_CAPS[provider]}", "model",
                         evidence={"provider": provider, "calls": request_counts[provider], "cap": REQUEST_CAPS[provider]})
                    try:
                        return original(*args, **kwargs)
                    except Exception as exc:
                        text = str(exc)
                        if attempt == 2 or not re.search(r"429|rate.?limit|quota|RESOURCE_EXHAUSTED", text, re.I):
                            raise
                        m = re.search(r"(?:try again|retry) in ([\d.]+)\s*s", text, re.I)
                        delay = min(45.0, float(m.group(1)) + 1 if m else 20.0)
                        emit("System", "Provider rate limit: waiting", f"{provider}: retrying in {delay:.0f}s", "info")
                        time.sleep(delay)

            async def acall(*args, **kwargs):
                raise RuntimeError("Async model calls are not used in this demo")

            object.__setattr__(llm, "call", call)
            object.__setattr__(llm, "acall", acall)
            return llm

        def model(provider, output_tokens):
            if provider == "gemini":
                return budgeted(LLM(model=MODELS["gemini"], api_key=os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"),
                                    temperature=0.1, max_output_tokens=output_tokens), "gemini")
            extra = {"reasoning_effort": "low"} if "gpt-oss" in MODELS["groq"] else {}
            return budgeted(LLM(model=MODELS["groq"], api_key=os.environ["GROQ_API_KEY"], temperature=0.1,
                                max_tokens=output_tokens, **extra), "groq")

        llms = {"Manager": model("gemini", 1024), "Architect": model("gemini", 2048), "QA": model("gemini", 4096),
                "Backend": model("groq", 3000), "Frontend": model("groq", 3000)}
        emit("Manager", "Manager online", f"Feature request received: {FEATURE_REQUEST}", "start")
        emit("System", "Provider mapping confirmed", f"Manager+Architect+QA: {MODELS['gemini']}; Backend+Frontend: {MODELS['groq']}", "info")

        @tool("write_acceptance_tests")
        def write_acceptance_tests(source_code: str) -> str:
            """Write the COMPLETE tests/feature.acceptance.test.mjs file. The tool rejects tests that pass before the feature exists."""
            emit("QA", "Tool called: write_acceptance_tests", "Checking the test file, then confirming it fails first", "tool")
            return write_tests(source_code)

        @tool("write_backend_source")
        def write_backend_source(source_code: str) -> str:
            """Write the COMPLETE api/feature.mjs file exporting handle(action, body, ctx). Returns test results for API tests."""
            emit("Backend", "Tool called: write_backend_source", "Guardrail check, syntax check, save, run tests", "tool")
            return write_code(BACKEND, source_code, "Backend", ["handle"], CODE_BLOCKED, "API:")

        @tool("write_frontend_source")
        def write_frontend_source(source_code: str) -> str:
            """Write the COMPLETE site/feature.js file exporting feature, initialState, render, onAction. Returns test results for UI tests."""
            emit("Frontend", "Tool called: write_frontend_source", "Guardrail check, syntax check, save, run tests", "tool")
            return write_code(FRONTEND, source_code, "Frontend", ["feature", "initialState", "render", "onAction"], FRONTEND_BLOCKED, "UI:")

        @tool("run_feature_tests")
        def run_feature_tests() -> str:
            """Run real contract, agent acceptance and applicable independent product-owner tests. Never invent test results."""
            global qa_runs
            qa_runs += 1
            passed, output, summary = execute_tests()
            (RUN_DIR / f"qa-tests-attempt-{qa_runs}.txt").write_text(output, encoding="utf-8")
            (RUN_DIR / "qa-tests.txt").write_text(output, encoding="utf-8")
            emit("QA", "QA executed real Node tests", f"{'PASS' if passed else 'FAIL'}: {summary['pass']} pass / {summary['fail']} fail", "test",
                 evidence={"artifact": f"qa-tests-attempt-{qa_runs}.txt", "passed": passed, "attempt": qa_runs})
            return ("PASS" if passed else "FAIL") + f" {summary['pass']} pass / {summary['fail']} fail\n" + failure_details(output, summary["failing"])

        def phase(role, goal, description, expected, tools, max_iter):
            emit(role, "CrewAI specialist started", description[:200], "start")
            agent = Agent(role=role, goal=goal,
                          backstory="Experienced, precise engineering specialist. Use the tools; give evidence, not speculation.",
                          llm=llms[role], tools=tools, allow_delegation=False, max_iter=max_iter,
                          verbose=False, memory=False)
            task = Task(description=description, expected_output=expected, agent=agent)
            result = Crew(agents=[agent], tasks=[task], process=Process.sequential, verbose=False, memory=False).kickoff()
            summary = scrub(str(result))[:3000]
            step_outputs[role] = summary
            artifact = f"{role.lower()}-result.txt"
            (RUN_DIR / artifact).write_text(summary, encoding="utf-8")
            emit(role, "Specialist returned", summary[:500], "done", evidence={"artifact": artifact})
            return summary

        def manager_review() -> dict:
            allowed = supervisor.allowed()
            if not allowed:
                raise RuntimeError("Manager called after mission closed")
            evidence = {
                "feature_request": FEATURE_REQUEST,
                "completed": sorted(supervisor.completed),
                "tests_written": supervisor.tests_written,
                "feasible": supervisor.feasible,
                "allowed_next_assignments": allowed,
                "corrections_used": supervisor.retry_count,
                "max_corrections": supervisor.max_corrections,
                "qa_passed": supervisor.qa_passed,
                "latest_tests": last_test_summary,
                "code_write_counts": write_counts,
                "latest_worker_outputs": {k: v[-160:] for k, v in step_outputs.items()},
            }
            emit("Manager", "Reviewing team status", json.dumps({k: evidence[k] for k in ("completed", "allowed_next_assignments", "latest_tests")})[:900], "start")
            manager = Agent(
                role="Manager", goal="Assign the next appropriate specialist based on verified project evidence",
                backstory="Technical engineering manager. You supervise four real workers, never write code, and never claim success without test evidence.",
                llm=llms["Manager"], tools=[], allow_delegation=False, max_iter=1, verbose=False, memory=False,
            )
            description = (
                "You are the AI manager of a software team building one feature. "
                "Workflow: Architect writes a spec; QA writes failing acceptance tests first; Backend and Frontend implement "
                "until tests pass; QA runs all tests; then COMPLETE. "
                "Choose exactly one action from allowed_next_assignments. If both developers are allowed, pick the one whose "
                "work the other depends on. If QA failed, read latest_tests and route one correction to the developer whose "
                "tests fail ('API:' = Backend, 'UI:' = Frontend). The write limit resets on every new assignment, so "
                "code_write_counts never blocks a correction. While corrections_used < max_corrections, prefer a correction; "
                "STOP only when no correction remains. "
                "Never declare COMPLETE unless qa_passed is true. "
                'Respond with ONLY JSON: {"assign":"Architect|QA|Backend|Frontend|COMPLETE|STOP","reason":"one evidence-based sentence"}. '
                "Project state:\n" + json.dumps(evidence, ensure_ascii=False)
            )
            task = Task(description=description, expected_output="One JSON object with assign and reason, no Markdown", agent=manager)
            raw = str(Crew(agents=[manager], tasks=[task], process=Process.sequential, verbose=False, memory=False).kickoff())
            try:
                decision = parse_decision(raw)
                target = supervisor.validate(decision)
            except (ValueError, TypeError, json.JSONDecodeError) as exc:
                emit("Manager", "Rejected manager decision", f"{type(exc).__name__}: {exc}; response={scrub(raw)[:300]}", "error")
                raise RuntimeError("Manager returned an invalid or unsafe task assignment") from exc
            decision.update(step=len(manager_decisions) + 1, allowed=allowed, state=supervisor.snapshot())
            manager_decisions.append(decision)
            (RUN_DIR / "manager-decisions.json").write_text(json.dumps(manager_decisions, indent=2, ensure_ascii=False), encoding="utf-8")
            emit("Manager", "Manager decision: " + ("Mission " + target if target in {"COMPLETE", "STOP"} else "Assign " + target),
                 decision["reason"], "decision", evidence={"artifact": "manager-decisions.json", "assignment": target})
            return decision

        spec = ""
        for _ in range(14):
            decision = manager_review()
            role = decision["assign"]
            if role in ("COMPLETE", "STOP"):
                supervisor.close(role)
                if role == "STOP":
                    emit("Manager", "Mission stopped", "Manager stopped the run. The release gate will not be marked passed.", "error")
                    return 1
                break
            emit("Manager", "Handoff to " + role, "Assigned by manager: " + decision["reason"], "handoff",
                 evidence={"assignment": role, "decision_step": decision["step"]})
            if role == "Architect":
                spec = phase(
                    "Architect", "Turn a product request into a precise, testable spec for the CampusBites feature contract.",
                    f"Feature request from the product owner: \"{FEATURE_REQUEST}\"\n\n{CONTRACT}\n\n"
                    "Write a SHORT spec (max 250 words) in exactly this format, no code:\n"
                    "FEASIBLE: yes  (or 'FEASIBLE: no - reason' if it needs real payments, GPS, logins, email/SMS, "
                    "external services, or changes outside the two feature files)\n"
                    "NAME: 2-4 words\nSLOT: bag or menu\n"
                    "UI: what the panel shows; every input name=... and button data-action=...\n"
                    "STATE: frontend state fields\nAPI: each backend action: request body -> response JSON with status\n"
                    "HOOKS: summaryLines and/or filterProducts behaviour, or none\n"
                    "ACCEPTANCE: 4-6 numbered criteria with exact inputs and expected outputs using real menu prices; "
                    "at least 2 for the API and 2 for the UI.",
                    "The spec in the exact format", [], max_iter=1)
                (RUN_DIR / "spec.md").write_text(spec, encoding="utf-8")
                feasible = not re.search(r"FEASIBLE:\s*no", spec, re.I)
                supervisor.mark_finished("Architect", feasible=feasible)
                if not feasible:
                    emit("Architect", "Request flagged as not feasible", spec[:300], "error")
            elif role == "QA" and supervisor.phase == "write_tests":
                assignment_writes["QA"] = 0
                phase("QA", "Write acceptance tests from the spec before any code exists.",
                      f"Feature request: \"{FEATURE_REQUEST}\"\nSPEC:\n{spec[:2500]}\n\n{CONTRACT}\n\n"
                      "Write tests/feature.acceptance.test.mjs: 4 to 8 tests that check the ACCEPTANCE criteria. "
                      "Use only the imports shown in the contract. Name tests 'API: ...' or 'UI: ...'. "
                      "Compute expected numbers carefully from the real menu prices. Test behaviour, not exact HTML "
                      "(use assert.match with key words). Call write_acceptance_tests once with the COMPLETE file; "
                      "if it is rejected, fix the problem and call it again.",
                      "Tool result confirming the tests were saved", [write_acceptance_tests], max_iter=3)
                if assignment_writes["QA"] == 0:
                    raise RuntimeError("QA was assigned but did not save acceptance tests")
                supervisor.mark_finished("QA")
            elif role in ("Backend", "Frontend"):
                target, writer, owns = ((BACKEND, write_backend_source, "api/feature.mjs") if role == "Backend"
                                        else (FRONTEND, write_frontend_source, "site/feature.js"))
                prior = write_counts[role]
                assignment_writes[role] = 0
                phase(role, f"Implement {owns} so the acceptance tests pass.",
                      f"Feature request: \"{FEATURE_REQUEST}\"\nSPEC:\n{spec[:2500]}\n\n{CONTRACT}\n\n"
                      f"ACCEPTANCE TESTS (do not change them):\n{TESTS.read_text(encoding='utf-8')[:6500]}\n\n"
                      f"CURRENT {owns}:\n{target.read_text(encoding='utf-8')}\n\n"
                      f"You own ONLY {owns}. Call {writer.name} with the COMPLETE file. The tool runs the tests and "
                      "lists failures in your area; if any remain, fix them and call it once more. "
                      "Final answer: one line with the last tool result.",
                      "The last tool result", [writer], max_iter=4)
                if write_counts[role] <= prior:
                    raise RuntimeError(f"{role} was assigned but did not save any code")
                supervisor.mark_finished(role)
            elif role == "QA":
                prior = qa_runs
                phase("QA", "Verify the feature with the real tests.",
                      "Call run_feature_tests exactly once. Report the pass/fail totals and any failing test names. "
                      "Never invent test evidence.", "Real test output from the tool", [run_feature_tests], max_iter=2)
                if qa_runs <= prior:
                    raise RuntimeError("QA did not run the real test tool")
                qa_passed, _, last_test_summary = execute_tests()  # trust deterministic tests, not QA's textual assertion
                supervisor.mark_finished("QA", qa_passed=qa_passed)
                emit("Manager", "QA report received", f"Verified: {'PASS' if qa_passed else 'FAIL'} ({last_test_summary['pass']} pass / {last_test_summary['fail']} fail)",
                     "test", evidence={"passed": qa_passed, "artifact": "qa-tests.txt"})
            (RUN_DIR / "supervisor-state.json").write_text(json.dumps(supervisor.snapshot(), indent=2), encoding="utf-8")
            emit("Manager", "Team status updated", json.dumps(supervisor.snapshot()), "status")
        else:
            raise RuntimeError("Supervisor exceeded maximum dispatch steps")

        # Independent release gate: no AI involved.
        passed, output, summary = execute_tests()
        (RUN_DIR / "release-gate.txt").write_text(output, encoding="utf-8")
        tests_now = TESTS.read_text(encoding="utf-8")
        independent_file = ROOT / INDEPENDENT_DISCOUNT_TESTS
        independent_hash = hashlib.sha256(independent_file.read_bytes()).hexdigest()
        checks = {
            "all tests pass": passed,
            "independent student-discount tests unchanged": not DISCOUNT_DEMO or independent_hash == INDEPENDENT_TESTS_SHA,
            "manager closed after QA passed": supervisor.closed and bool(supervisor.qa_passed),
            "QA wrote the tests in this run": tests_sha is not None and sha256(tests_now) == tests_sha,
            "at least 3 acceptance tests": test_count(tests_now) >= 3,
            "Backend and Frontend wrote code": {"Backend", "Frontend"} <= changed,
        }
        success = all(checks.values())
        emit("System", "Independent release gate",
             ("PASS: " if success else "FAIL: ") + "; ".join(f"{k}: {'yes' if v else 'NO'}" for k, v in checks.items()),
             "complete" if success else "error",
             evidence={"artifact": "release-gate.txt", "passed": success, "checks": checks, "tests": summary})
        return 0 if success else 1
    except Exception as exc:
        emit("System", "Manager-led execution failed", f"{type(exc).__name__}: {exc}", "error")
        return 1


if __name__ == "__main__":
    rc = main()
    (RUN_DIR / "summary.json").write_text(json.dumps({
        "run_id": RUN_ID, "independent_discount_gate": DISCOUNT_DEMO, "status": "passed" if rc == 0 else "failed", "feature_request": FEATURE_REQUEST,
        "providers": ROLES, "models": MODELS, "code_write_roles": sorted(changed), "completed_roles": sorted(step_outputs),
        "manager_decisions": len(manager_decisions), "supervisor_state": supervisor.snapshot(),
        "execution_style": "model_manager_with_bounded_validated_dispatch_test_first",
        "elapsed_seconds": round(time.monotonic() - start_time, 2),
        "llm_call_counts": request_counts, "llm_call_caps": REQUEST_CAPS, "max_corrections": supervisor.max_corrections,
    }, indent=2, ensure_ascii=False), encoding="utf-8")
    sys.exit(rc)
