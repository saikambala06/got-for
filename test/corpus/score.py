#!/usr/bin/env python3
"""
Score the parser against the corpus's ground truth.

Matching is deliberately forgiving about surface form and strict about content:
an employer counts as found if the parsed company contains the true one (or
vice versa) once punctuation and case are normalised, so "Infosys Limited" and
"Infosys Ltd" agree while "Bank of America" (a client) does not stand in for
"Infosys" (the employer).
"""
import json
import pathlib
import re
import sys
import unicodedata

HERE = pathlib.Path(__file__).parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT / "api"))
sys.path.insert(0, str(HERE))

from _resume_parser.pipeline import parse_document  # noqa: E402

TRUTH = json.loads((HERE / "truth.json").read_text())


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", str(text or ""))
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower().replace("&", " and ")
    text = re.sub(r"\b(ltd|limited|llc|inc|gmbh|se|sa|bv|nv|plc|corp|co|kg|solutions|technologies|group)\b", " ", text)
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def loose(a: str, b: str) -> bool:
    x, y = norm(a), norm(b)
    if not x or not y:
        return False
    return x == y or x in y or y in x


def phone_eq(a: str, b: str) -> bool:
    da, db = re.sub(r"\D", "", a or ""), re.sub(r"\D", "", b or "")
    return bool(da) and bool(db) and (da[-9:] == db[-9:])


def score_one(path: pathlib.Path, truth: dict) -> dict:
    data = parse_document(path.read_bytes(), filename=path.name)
    contact = data["contact_information"]
    result = {"file": path.name, "checks": {}, "detail": []}

    def add(key, ok, got="", want=""):
        result["checks"][key] = bool(ok)
        if not ok:
            result["detail"].append(f"{key}: got {got!r} want {want!r}")

    add("name", loose(contact["name"], truth["name"]), contact["name"], truth["name"])
    add("email", (contact["email"] or "").lower() == truth["email"].lower(),
        contact["email"], truth["email"])
    add("phone", phone_eq(contact["phone"], truth["phone"]), contact["phone"], truth["phone"])
    if truth["linkedin"]:
        add("linkedin", norm(truth["linkedin"]).replace(" ", "") in norm(contact["linkedin"]).replace(" ", ""),
            contact["linkedin"], truth["linkedin"])

    parsed_roles = data["work_experience"]
    add("role_count", len(parsed_roles) == len(truth["roles"]),
        len(parsed_roles), len(truth["roles"]))

    companies_found = 0
    positions_found = 0
    dates_found = 0
    for want in truth["roles"]:
        hit = next((g for g in parsed_roles if loose(g["company"], want["company"])), None)
        if hit:
            companies_found += 1
            if loose(hit["position"], want["position"]):
                positions_found += 1
            got_start = (hit["start_date"] or "")[:7]
            if got_start and got_start == want["start"][:7]:
                dates_found += 1
    total_roles = max(1, len(truth["roles"]))
    add("employers", companies_found == len(truth["roles"]),
        f"{companies_found}/{len(truth['roles'])}", "all")
    add("positions", positions_found >= len(truth["roles"]) * 0.7,
        f"{positions_found}/{len(truth['roles'])}", ">=70%")
    add("start_dates", dates_found >= len(truth["roles"]) * 0.7,
        f"{dates_found}/{len(truth['roles'])}", ">=70%")

    degrees = data["education"]
    inst_found = sum(
        1 for want in truth["degrees"]
        if any(loose(g["institution"], want["institution"]) for g in degrees))
    add("institutions", inst_found >= max(1, len(truth["degrees"]) - 1),
        f"{inst_found}/{len(truth['degrees'])}", "all but one")
    deg_found = sum(
        1 for want in truth["degrees"]
        if any(loose(g["degree"], want["degree"]) or loose(g["major"], want["major"])
               for g in degrees))
    add("degrees", deg_found >= max(1, len(truth["degrees"]) - 1),
        f"{deg_found}/{len(truth['degrees'])}", "all but one")

    all_skills = [norm(s) for s in data["skills"]["technical"] + data["skills"]["soft"]]
    skill_hits = sum(1 for s in truth["skills_sample"]
                     if any(norm(s) == a or norm(s) in a or a in norm(s) for a in all_skills if a))
    add("skills", skill_hits >= len(truth["skills_sample"]) * 0.6,
        f"{skill_hits}/{len(truth['skills_sample'])}", ">=60%")

    result["confidence"] = data["confidence"]["overall"]
    result["role_detail"] = [(g["company"], g["position"], g["start_date"], g["end_date"])
                             for g in parsed_roles]
    result["edu_detail"] = [(g["institution"], g["degree"], g["major"]) for g in degrees]
    return result


def main() -> int:
    only = sys.argv[1] if len(sys.argv) > 1 else ""
    verbose = "-v" in sys.argv
    rendered = HERE / "rendered"
    rows, passed, total = [], 0, 0

    for key in sorted(TRUTH):
        if only and only not in key and only != "-v":
            continue
        for suffix in ("pdf", "docx"):
            path = rendered / f"{key}.{suffix}"
            if not path.exists():
                continue
            try:
                res = score_one(path, TRUTH[key])
            except Exception as exc:  # noqa: BLE001
                print(f"{path.name:32s} CRASH {exc.__class__.__name__}: {exc}")
                total += 1
                continue
            ok = sum(1 for v in res["checks"].values() if v)
            n = len(res["checks"])
            passed += ok
            total += n
            rows.append((path.name, ok, n, res))

    print(f"{'file':32s} {'score':>7}  {'conf':>4}  failures")
    print("-" * 100)
    for name, ok, n, res in rows:
        fails = ", ".join(k for k, v in res["checks"].items() if not v)
        print(f"{name:32s} {ok:>3}/{n:<3} {res['confidence']:>4}  {fails}")
        if verbose and res["detail"]:
            for line in res["detail"]:
                print(f"      {line}")
            for role in res["role_detail"]:
                print(f"      · {role}")
            for edu in res["edu_detail"]:
                print(f"      ° {edu}")
    print("-" * 100)
    pct = 100.0 * passed / max(1, total)
    print(f"TOTAL {passed}/{total} checks passed  ({pct:.1f}%)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
