"""
Preprocess CSV files for faster browser loading.

Strips unused columns and produces thinned CSV + JSON files.
Run from project root:  python preprocess.py
"""

import csv
import gzip
import io
import json
import os
from pathlib import Path

csv.field_size_limit(10**8)

ROOT = Path(__file__).parent
PUBLIC = ROOT / "public"


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


def strip_thin_csv(input_path, output_path, keep_cols, description) -> int:
    """Read CSV, keep only keep_cols, write thinned CSV. Returns output bytes."""
    with open(input_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    print(
        f"  {description}  {len(keep_cols)} cols kept, "
        f"{len(rows):,} rows"
    )
    out_bytes = _to_csv(keep_cols, rows)
    output_path.write_bytes(out_bytes)
    compressed = os.path.getsize(output_path)
    return compressed


def thin_drug_visit() -> None:
    """sjs-ten-ipd-drug-visit: drop DIDSTD column (never used)."""
    src = PUBLIC / "sjs-ten-ipd-drug-visit.csv"
    dst = PUBLIC / "sjs-ten-ipd-drug-visit-thin.csv"
    keep = ["HOSPCODE", "PID", "DIAGCODE", "DATETIME_ADMIT", "DNAME", "DATE_SERV", "visit_count"]
    orig = os.path.getsize(src)
    thinned = strip_thin_csv(src, dst, keep, "sjs-ten-ipd-drug-visit")
    print(f"    {orig/1e6:.1f} MB -> {thinned/1e6:.1f} MB  ({thinned*100//orig}% of original)")


def thin_drug() -> None:
    """sjs-ten-ipd-drug: drop DIDSTD column (never used)."""
    src = PUBLIC / "sjs-ten-ipd-drug.csv"
    dst = PUBLIC / "sjs-ten-ipd-drug-thin.csv"
    keep = ["HOSPCODE", "PID", "DIAGCODE", "DATETIME_ADMIT", "DNAME"]
    orig = os.path.getsize(src)
    thinned = strip_thin_csv(src, dst, keep, "sjs-ten-ipd-drug")
    print(f"    {orig/1e6:.1f} MB -> {thinned/1e6:.1f} MB  ({thinned*100//orig}% of original)")


def thin_hospitals() -> None:
    """hospitals: keep only hospcode + zone_code, produce JSON map."""
    src = PUBLIC / "hospitals.csv"
    dst_json = PUBLIC / "hosp-zones.json"
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
    """address: keep changwat + province_name, produce JSON map."""
    src = PUBLIC / "address.csv"
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
    print("Done.  All output in public/")


if __name__ == "__main__":
    main()
