"""
Preprocess CSV files for faster browser loading.

Strips unused columns, produces thinned CSV + JSON lookup maps,
and computes all SJS/TEN chart aggregations as a single JSON file.

Run from project root:  python preprocess.py
"""

import csv
import hashlib
import io
import json
import math
import os
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path

csv.field_size_limit(10**8)

ROOT = Path(__file__).parent
PUBLIC = ROOT / "public"
# Large source CSVs and bulky intermediates live here (NOT shipped to the browser
# or the deployment). Only the small JSON outputs the app fetches stay in public/.
RAW = ROOT / "raw-data"
RAW.mkdir(exist_ok=True)

# ─── Drug group classifiers (ported from App.tsx) ─────────────────────────────

NSAID_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("Ibuprofen",      re.compile(r"\bibuprofen\b|\bbrufen\b|\bnurofen\b|\badvil\b|\bmotrin\b", re.I)),
    ("Diclofenac",     re.compile(r"\bdiclofenac\b|\bvoltaren\b|\bcataflam\b|\bvoveran\b", re.I)),
    ("Mefenamic acid", re.compile(r"\bmefenamic\b|\bponstan\b|\bponstel\b|\bmefenac\b", re.I)),
    ("Naproxen",       re.compile(r"\bnaproxen\w*|\bnaprosyn\b|\baleve\b", re.I)),
    ("Piroxicam",      re.compile(r"\bpiroxicam\b|\bfeldene\b", re.I)),
    ("Indomethacin",   re.compile(r"\bindometha?cin\b|\bindocid\b", re.I)),
    ("Meloxicam",      re.compile(r"\bmeloxicam\b|\bmobic\b", re.I)),
    ("Celecoxib",      re.compile(r"\bcelecoxib\b|\bcelebrex\b", re.I)),
    ("Etoricoxib",     re.compile(r"\betoricoxib\b|\barcoxia\b", re.I)),
    ("Ketorolac",      re.compile(r"\bketorolac\b|\btoradol\b", re.I)),
    ("Ketoprofen",     re.compile(r"\bketoprofen\b|\bprofenid\b|\borudis\b", re.I)),
    ("Parecoxib",      re.compile(r"\bparecoxib\b|\bdynastat\b", re.I)),
    ("Tenoxicam",      re.compile(r"\btenoxicam\b|\btilcotil\b", re.I)),
    ("Nimesulide",     re.compile(r"\bnimesulide\b|\bnimulid\b", re.I)),
    ("Aceclofenac",    re.compile(r"\baceclofenac\b", re.I)),
    ("Aspirin / ASA",  re.compile(r"\baspirin\b|\baspent\b|\bacetylsalicylic\b", re.I)),
]

ANTIBIOTIC_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("Amoxicillin",               re.compile(r"\bamox(?:i|y)?cillin\w*|\bamoxil\b", re.I)),
    ("Amoxicillin+Clavulanate",   re.compile(r"\bco[-\s]?amoxiclav\b|amox[yi]?\s*clav|augmentin|clavulan\w*", re.I)),
    ("Dicloxacillin",             re.compile(r"\bdicloxacillin\w*", re.I)),
    ("Cloxacillin",               re.compile(r"\bcloxacillin\w*", re.I)),
    ("Penicillin V",              re.compile(r"\bpenicillin\s*v\b|\bphenoxymethyl", re.I)),
    ("Penicillin G / Benzathine", re.compile(r"\bpenicillin\s*g\b|\bbenzylpenicillin\b|\bbenzathine\b", re.I)),
    ("Ceftriaxone",               re.compile(r"\bceftriaxone\w*|\bceftriazone\w*|\brocephin\b", re.I)),
    ("Cefazolin",                 re.compile(r"\bcefazolin\w*", re.I)),
    ("Cephalexin",                re.compile(r"\bcephale?xin\w*", re.I)),
    ("Cefdinir",                  re.compile(r"\bcefdinir\w*", re.I)),
    ("Ceftazidime",               re.compile(r"\bceftazidime\w*", re.I)),
    ("Cefixime",                  re.compile(r"\bcefixime\w*", re.I)),
    ("Cefotaxime",                re.compile(r"\bcefotaxime\w*", re.I)),
    ("Cefuroxime",                re.compile(r"\bcefuroxime\w*", re.I)),
    ("Norfloxacin",               re.compile(r"\bnorfloxacin\w*|\bnoroxin\b", re.I)),
    ("Ciprofloxacin",             re.compile(r"\bciprofloxacin\w*|\bciproxin\b|\bciprobay\b", re.I)),
    ("Levofloxacin",              re.compile(r"\blevofloxacin\w*|\btavanic\b|\bcravit\b", re.I)),
    ("Moxifloxacin",              re.compile(r"\bmoxifloxacin\w*", re.I)),
    ("Ofloxacin",                 re.compile(r"\bofloxacin\w*", re.I)),
    ("Roxithromycin",             re.compile(r"\broxithromycin\w*|\broxitromycin\w*|\brulid\b", re.I)),
    ("Erythromycin",              re.compile(r"\berythromycin\w*", re.I)),
    ("Azithromycin",              re.compile(r"\bazithromycin\w*|\bzithromax\b", re.I)),
    ("Clarithromycin",            re.compile(r"\bclarithromycin\w*|\bclarithomycin\w*|\bklacid\b", re.I)),
    ("Clindamycin",               re.compile(r"\bclindamycin\w*", re.I)),
    ("Doxycycline",               re.compile(r"\bdoxycycline\w*|\bvibramycin\b", re.I)),
    ("Metronidazole",             re.compile(r"\bmetronidazole\w*|\bflagyl\b", re.I)),
    ("Co-trimoxazole / TMP-SMX",  re.compile(r"\bcotrimoxazole\b|\bco[-\s]?trimoxazole\b|bactrim|septrin", re.I)),
    ("Chloramphenicol",           re.compile(r"\bchloramphenicol\w*", re.I)),
    ("Neomycin",                  re.compile(r"\bneomycin\w*", re.I)),
    ("Mupirocin",                 re.compile(r"\bmupirocin\w*|\bbactroban\b", re.I)),
    ("Vancomycin",                re.compile(r"\bvancomycin\w*", re.I)),
    ("Meropenem",                 re.compile(r"\bmeropenem\w*", re.I)),
    ("Gentamicin",                re.compile(r"\bgentamicin\w*", re.I)),
    ("Tobramycin",                re.compile(r"\btobramycin\w*", re.I)),
    ("Amikacin",                  re.compile(r"\bamikacin\w*", re.I)),
    ("Lincomycin",                re.compile(r"\blincomycin\w*", re.I)),
    ("Fusidic acid",              re.compile(r"\bfusidic\b|\bfucidin\b", re.I)),
    ("Silver sulfadiazine",       re.compile(r"\bsilver\s*sul[fp]", re.I)),
]


def classify_drug(name: str, patterns: list[tuple[str, re.Pattern[str]]]) -> str | None:
    for group, pat in patterns:
        if pat.search(name):
            return group
    return None


# ─── Utility ───────────────────────────────────────────────────────────────────

SJS_YEARS = list(range(2014, 2025))


def _clean(v: str) -> str:
    if not v:
        return ""
    return v.strip('"').strip()


def _to_csv(fields, rows) -> bytes:
    sio = io.StringIO()
    writer = csv.DictWriter(sio, fieldnames=fields, quoting=csv.QUOTE_MINIMAL)
    writer.writeheader()
    for r in rows:
        writer.writerow({k: _clean(r.get(k, "")) for k in fields})
    return sio.getvalue().encode("utf-8")


def _year(val: str) -> int:
    try:
        return int(str(val)[:4])
    except (ValueError, IndexError):
        return 0


def _pid_key(row: dict) -> str:
    return f"{row.get('HOSPCODE', '')}|{row.get('PID', '')}"


def _split_drugs(name: str) -> list[str]:
    return [d.strip() for d in str(name).split(",") if d.strip()]


# ─── Stripping helpers ─────────────────────────────────────────────────────────

def strip_thin_csv(input_path, output_path, keep_cols, description) -> int:
    with open(input_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    print(f"  {description}  {len(keep_cols)} cols kept, {len(rows):,} rows")
    out_bytes = _to_csv(keep_cols, rows)
    output_path.write_bytes(out_bytes)    # type: ignore[arg-type]
    compressed = os.path.getsize(output_path)
    return compressed


def thin_drug_visit() -> None:
    src = RAW / "sjs-ten-ipd-drug-visit.csv"
    dst = RAW / "sjs-ten-ipd-drug-visit-thin.csv"
    keep = ["HOSPCODE", "PID", "DIAGCODE", "DATETIME_ADMIT", "DNAME", "DATE_SERV", "visit_count"]
    orig = os.path.getsize(src)
    thinned = strip_thin_csv(src, dst, keep, "sjs-ten-ipd-drug-visit")
    print(f"    {orig/1e6:.1f} MB -> {thinned/1e6:.1f} MB  ({thinned*100//orig}% of original)")


def thin_drug() -> None:
    src = RAW / "sjs-ten-ipd-drug.csv"
    dst = RAW / "sjs-ten-ipd-drug-thin.csv"
    keep = ["HOSPCODE", "PID", "DIAGCODE", "DATETIME_ADMIT", "DNAME"]
    orig = os.path.getsize(src)
    thinned = strip_thin_csv(src, dst, keep, "sjs-ten-ipd-drug")
    print(f"    {orig/1e6:.1f} MB -> {thinned/1e6:.1f} MB  ({thinned*100//orig}% of original)")


def thin_hospitals() -> None:
    src = RAW / "hospitals.csv"
    dst_json = RAW / "hosp-zones.json"
    orig = os.path.getsize(src)
    with open(src, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        zone_map: dict[str, str] = {}
        for row in reader:
            code = _clean(row.get("hospcode", ""))
            zone = _clean(row.get("zone_code", ""))
            if code and zone and zone != "0":
                zone_map[code] = zone
        for code in list(zone_map.keys()):
            zone_map[code.zfill(5)] = zone_map[code]
    with open(dst_json, "w", encoding="utf-8") as f:
        json.dump(zone_map, f)
    thinned = os.path.getsize(dst_json)
    print(f"  hospitals zone map: {len(zone_map):,} entries  {orig/1e6:.1f} MB -> {thinned/1024:.1f} KB")


def thin_address() -> None:
    src = RAW / "address.csv"
    dst_json = PUBLIC / "address-map.json"
    orig = os.path.getsize(src)
    with open(src, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        addr_map: dict[str, str] = {}
        for row in reader:
            cw = _clean(row.get("changwat", ""))
            pn = _clean(row.get("province_name", ""))
            if cw and pn:
                addr_map[cw] = pn
                addr_map[pn] = pn
    with open(dst_json, "w", encoding="utf-8") as f:
        json.dump(addr_map, f)
    thinned = os.path.getsize(dst_json)
    print(f"  address map: {len(addr_map):,} entries  {orig/1e6:.1f} MB -> {thinned/1024:.1f} KB")


# ─── SJS/TEN aggregations ──────────────────────────────────────────────────────

def _read_csv_rows(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def _drug_patients_per_year(rows, year_col="DATETIME_ADMIT") -> dict[int, dict[str, set]]:
    data: dict[int, dict[str, set]] = defaultdict(lambda: defaultdict(set))
    for r in rows:
        y = _year(r.get(year_col, ""))
        if y not in SJS_YEARS:
            continue
        pid = _pid_key(r)
        for drug in _split_drugs(r.get("DNAME", "")):
            data[y][drug].add(pid)
    return data


def _group_patients_per_year(
    rows: list[dict],
    patterns: list[tuple[str, re.Pattern[str]]],
) -> dict[int, dict[str, set]]:
    data: dict[int, dict[str, set]] = defaultdict(lambda: defaultdict(set))
    for r in rows:
        y = _year(r.get("DATETIME_ADMIT", ""))
        if y not in SJS_YEARS:
            continue
        pid = _pid_key(r)
        seen = set()
        for drug in _split_drugs(r.get("DNAME", "")):
            group = classify_drug(drug, patterns)
            if group and group not in seen:
                seen.add(group)
                data[y][group].add(pid)
    return data


def _top_drugs_list(drug_patients: dict[str, set], max_n: int = 50) -> list[dict]:
    result = []
    for drug, pids in drug_patients.items():
        result.append({"drug": drug, "patients": len(pids)})
    result.sort(key=lambda x: -x["patients"])
    return result[:max_n]


def _group_list(group_patients: dict[str, set]) -> list[dict]:
    result = []
    for group, pids in group_patients.items():
        result.append({"group": group, "patients": len(pids)})
    result.sort(key=lambda x: -x["patients"])
    return result


def _parse_dates(date_serv: str) -> list:
    parts = [d.strip() for d in str(date_serv).split(",") if d.strip()]
    dates = []
    for p in parts:
        try:
            dt = datetime.strptime(p[:10], "%Y-%m-%d")
            dates.append(dt)
        except (ValueError, IndexError):
            pass
    return dates


def aggregate_sjs_ten(zone_map: dict[str, str]) -> dict:
    """Compute all SJS/TEN chart data and return as a single dict."""
    ipd_path = RAW / "sjs-ten-ipd.csv"
    drug_path = RAW / "sjs-ten-ipd-drug-thin.csv"
    drug_visit_path = RAW / "sjs-ten-ipd-drug-visit-thin.csv"

    print("  Reading sjs-ten-ipd.csv ...")
    ipd_rows = _read_csv_rows(ipd_path)
    print(f"    {len(ipd_rows):,} rows")

    print("  Reading sjs-ten-ipd-drug-thin.csv ...")
    drug_rows = _read_csv_rows(drug_path)
    print(f"    {len(drug_rows):,} rows")

    print("  Reading sjs-ten-ipd-drug-visit-thin.csv ...")
    drug_visit_rows = _read_csv_rows(drug_visit_path)
    print(f"    {len(drug_visit_rows):,} rows")

    # ── Summary cards ──────────────────────────────
    print("  Computing summary data ...")
    all_pids = set()
    total_visits = 0
    bar_data_year_visits = {}
    bar_data_year_pids = {}
    for y in SJS_YEARS:
        bar_data_year_visits[y] = 0
        bar_data_year_pids[y] = set()

    all_zones_set = set()
    grouped: DictType = {}
    for y in SJS_YEARS:
        grouped[y] = {}

    for r in ipd_rows:
        y = _year(r.get("DATETIME_ADMIT", ""))
        if y not in SJS_YEARS:
            continue
        hosp = str(r.get("HOSPCODE", "")).strip()
        zone = zone_map.get(hosp) or zone_map.get(hosp.zfill(5))
        pid = _pid_key(r)

        all_pids.add(pid)
        bar_data_year_visits[y] += 1
        bar_data_year_pids[y].add(pid)

        if zone and zone != "0":
            all_zones_set.add(zone)
            if zone not in grouped[y]:
                grouped[y][zone] = {"visits": 0, "pids": set()}
            grouped[y][zone]["visits"] += 1
            grouped[y][zone]["pids"].add(pid)

    bar_data = []
    for y in SJS_YEARS:
        bar_data.append({
            "year": str(y),
            "visits": bar_data_year_visits[y],
            "patients": len(bar_data_year_pids[y]),
        })

    total_visits_all = sum(d["visits"] for d in bar_data)
    all_zones = sorted(all_zones_set, key=lambda z: int(z))

    # ── Line data (visits + patients per zone per year) ──
    line_visits: dict[str, dict] = {}
    line_patients: dict[str, dict] = {}
    for y in SJS_YEARS:
        ystr = str(y)
        line_visits[ystr] = {"year": ystr}
        line_patients[ystr] = {"year": ystr}
        for zone in all_zones:
            key = f"Zone {zone}"
            val = grouped[y].get(zone)
            visits = val["visits"] if val else 0
            pats = len(val["pids"]) if val else 0
            line_visits[ystr][key] = visits
            line_patients[ystr][key] = pats

    # ── Drug data (per year) ─────────────────────────
    print("  Computing drug data per year ...")
    drug_patients_by_year = _drug_patients_per_year(drug_rows)
    drug_years = sorted(drug_patients_by_year.keys())
    drug_by_year: dict[str, list[dict]] = {}
    for y in sorted(drug_patients_by_year.keys()):
        drug_by_year[str(y)] = _top_drugs_list(drug_patients_by_year[y])

    # ── NSAID / Antibiotic groups (per year) ──
    print("  Computing NSAID group data per year ...")
    nsaid_by_year_raw = _group_patients_per_year(drug_rows, NSAID_PATTERNS)
    nsaid_by_year: dict[str, list[dict]] = {}
    for y in sorted(nsaid_by_year_raw.keys()):
        nsaid_by_year[str(y)] = _group_list(nsaid_by_year_raw[y])

    print("  Computing antibiotic group data per year ...")
    abx_by_year_raw = _group_patients_per_year(drug_rows, ANTIBIOTIC_PATTERNS)
    antibiotic_by_year: dict[str, list[dict]] = {}
    for y in sorted(abx_by_year_raw.keys()):
        antibiotic_by_year[str(y)] = _group_list(abx_by_year_raw[y])

    # ── Repeat patient section ─────────────
    print("  Computing repeat patient data ...")
    repeat_rows = [
        r for r in drug_visit_rows
        if int(str(r.get("visit_count", "0")).strip() or "0") >= 2
    ]
    print(f"    {len(repeat_rows):,} repeat rows (visit_count >= 2)")

    # Summary
    repeat_pids = set()
    repeat_total_vc = 0
    for r in repeat_rows:
        repeat_pids.add(_pid_key(r))
        repeat_total_vc += int(str(r.get("visit_count", "0")).strip() or "0")

    avg_vc = (repeat_total_vc / len(repeat_pids)) if repeat_pids else 0

    # Visit count distribution
    vc_buckets: dict[str, int] = {}
    for r in repeat_rows:
        vc = int(str(r.get("visit_count", "0")).strip() or "0")
        key = "5+" if vc >= 5 else str(vc)
        vc_buckets[key] = vc_buckets.get(key, 0) + 1

    visit_count_dist = []
    for k in ["2", "3", "4", "5+"]:
        if k in vc_buckets:
            visit_count_dist.append({"visit_count": k, "count": vc_buckets[k]})

    # Repeat drug data per year
    repeat_drug_pat_by_year = _drug_patients_per_year(repeat_rows)
    repeat_drug_years = sorted(repeat_drug_pat_by_year.keys())
    repeat_drug_by_year: dict[str, list[dict]] = {}
    for y in sorted(repeat_drug_pat_by_year.keys()):
        repeat_drug_by_year[str(y)] = _top_drugs_list(repeat_drug_pat_by_year[y])

    # Repeat NSAID / Antibiotic per year
    repeat_nsaid_raw = _group_patients_per_year(repeat_rows, NSAID_PATTERNS)
    repeat_nsaid_by_year: dict[str, list[dict]] = {}
    for y in sorted(repeat_nsaid_raw.keys()):
        repeat_nsaid_by_year[str(y)] = _group_list(repeat_nsaid_raw[y])

    repeat_abx_raw = _group_patients_per_year(repeat_rows, ANTIBIOTIC_PATTERNS)
    repeat_antibiotic_by_year: dict[str, list[dict]] = {}
    for y in sorted(repeat_abx_raw.keys()):
        repeat_antibiotic_by_year[str(y)] = _group_list(repeat_abx_raw[y])

    # Repeat YoY trend
    yoY_pids_map: dict[int, set] = defaultdict(set)
    yoY_rows_map: dict[int, int] = defaultdict(int)
    for r in repeat_rows:
        y = _year(r.get("DATETIME_ADMIT", ""))
        if y < 2010 or y > 2030:
            continue
        yoY_pids_map[y].add(_pid_key(r))
        yoY_rows_map[y] += 1

    min_y = min(yoY_pids_map.keys()) if yoY_pids_map else 2014
    max_y = max(yoY_pids_map.keys()) if yoY_pids_map else 2024
    yoy_trend = []
    for y in range(min_y, max_y + 1):
        yoy_trend.append({
            "year": str(y),
            "patients": len(yoY_pids_map.get(y, set())),
            "rows": yoY_rows_map.get(y, 0),
        })

    # Visit gap stats
    gaps: list[int] = []
    for r in repeat_rows:
        dates = _parse_dates(r.get("DATE_SERV", ""))
        if len(dates) < 2:
            continue
        dates.sort()
        gap_days = round((dates[-1] - dates[0]).total_seconds() / 86400)
        if gap_days > 0:
            gaps.append(gap_days)

    if gaps:
        gaps.sort()
        gap_median = gaps[len(gaps) // 2]
        gap_avg = round(sum(gaps) / len(gaps))
        gap_p25 = gaps[len(gaps) // 4]
        gap_p75 = gaps[3 * len(gaps) // 4]
    else:
        gap_median = gap_avg = gap_p25 = gap_p75 = 0

    result = {
        "summary": {
            "totalVisits": total_visits_all,
            "totalPatients": len(all_pids),
            "allZones": all_zones,
        },
        "barData": bar_data,
        "lineData": {
            "visits": line_visits,
            "patients": line_patients,
        },
        "drugYears": drug_years,
        "drugByYear": drug_by_year,
        "nsaidByYear": nsaid_by_year,
        "antibioticByYear": antibiotic_by_year,
        "repeat": {
            "summary": {
                "uniquePatients": len(repeat_pids),
                "totalVisits": repeat_total_vc,
                "avgVisitCount": f"{avg_vc:.1f}",
                "rows": len(repeat_rows),
            },
            "visitCountDist": visit_count_dist,
            "drugYears": repeat_drug_years,
            "drugByYear": repeat_drug_by_year,
            "nsaidByYear": repeat_nsaid_by_year,
            "antibioticByYear": repeat_antibiotic_by_year,
            "yoYTrend": yoy_trend,
            "visitGapStats": {
                "median": gap_median,
                "avg": gap_avg,
                "count": len(gaps),
                "p25": gap_p25,
                "p75": gap_p75,
            },
        },
    }

    dst = PUBLIC / "sjs-ten-aggregated.json"
    with open(dst, "w") as f:
        json.dump(result, f, ensure_ascii=False)

    size = os.path.getsize(dst)
    print(f"  sjs-ten-aggregated.json written: {size/1024:.1f} KB")
    return result


from typing import Dict, Any

DictType = Dict[int, Dict[str, Any]]


def main():
    print("=== Preprocessing CSV data files ===\n")
    print("[1/4] Stripping sjs-ten-ipd-drug-visit.csv ...")
    thin_drug_visit()
    print()
    print("[2/4] Stripping sjs-ten-ipd-drug.csv ...")
    thin_drug()
    print()
    print("[3/4] Distilling hospitals.csv -> zone map JSON ...")
    thin_hospitals()
    print()
    print("[4/4] Distilling address.csv -> map JSON ...")
    thin_address()
    print()
    print("[5/5] Computing SJS/TEN aggregated JSON ...")
    with open(RAW / "hosp-zones.json", "r") as f:
        zone_map = json.load(f)
    aggregate_sjs_ten(zone_map)
    print()
    print("Done.  All output in public/")


if __name__ == "__main__":
    main()
