#!/usr/bin/env python3
"""Prepare a non-destructive Supabase import payload for the live ERP.

This program reads the three individual village workbooks, the Patel Infra
report workbook, and the CAD minJSON export.  It writes a JSON payload that
can be applied in small, transactional SQL batches.  It never modifies an
input workbook, never reads worksheet colours, and never inspects Google
Drive.  A map link is emitted only when a CAD label exactly equals a survey
number after Gujarati-digit/whitespace normalization.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable

from openpyxl import load_workbook


DIGIT_TRANSLATION = str.maketrans("૦૧૨૩૪૫៦૭૮៩", "0123456789")
DRIVE_ROOT_FOLDER_ID = "17_R_9sRmBisDFiPWNjqPFrYYWQxxHUK-"
VILLAGE_INPUTS = (
    ("bhavanipar", "Bhavanipar", "Bhavanipur.xlsx"),
    ("bitta", "Bitta", "Bitta.xlsx"),
    ("vandh-timbo", "Vandh Timbo", "Vandh Timbo.xlsx"),
)
PRIVATE_REPORT_HEADERS = {
    "owners name ( as per bank records for nfa)",
    "vendor code",
    "owners name ( as per pan card)",
    "pan card no.",
    "owners name ( as per adhar card)",
    "aadhar no.",
    "bank account no.",
    "bank name",
    "ifsc code",
    "owner name",
}

# The combined drawing contains two complete survey boundary / label pairs.
# Earlier imports used only the primary pair, which left the secondary survey
# area visible but unlinked in the browser map.
MAP_LAYER_SOURCES = (
    ("primary", "0", "NEW SVY NO"),
    ("secondary", "Survey_Limit", "Survey No New"),
)


def as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def normalize_header(value: Any) -> str:
    return re.sub(r"\s+", " ", as_text(value).replace("\n", " ").lower()).strip()


def normalize_survey(value: Any) -> str:
    return re.sub(r"\s+", "", as_text(value).translate(DIGIT_TRANSLATION).lower())


def report_match_survey(value: Any) -> str:
    """Normalize harmless report separator variants without changing parcel IDs.

    The report uses ``216_1`` while the village register uses ``216/૧`` and
    uses ``548_1`` where Bhavanipar uses ``548/p૧``.  This key is used only to
    reconcile the two supplied sheets; the original survey number remains the
    ERP record's authoritative value.
    """

    normalized = normalize_survey(value).replace("_", "/")
    return re.sub(r"/p(?=\d)", "/", normalized)


def parse_number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float, Decimal)):
        return float(value)
    candidate = as_text(value).translate(DIGIT_TRANSLATION).replace(",", "")
    if candidate.lower() in {"", "na", "n/a", "-"}:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", candidate)
    if not match:
        return None
    try:
        return float(Decimal(match.group(0)))
    except InvalidOperation:
        return None


def parse_integer(value: Any) -> int | None:
    numeric = parse_number(value)
    return int(numeric) if numeric is not None else None


def parse_date(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    raw = as_text(value)
    for pattern in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y", "%b-%Y", "%B-%Y"):
        try:
            return datetime.strptime(raw, pattern).date().isoformat()
        except ValueError:
            pass
    return None


def json_value(value: Any) -> Any:
    if value is None or value == "":
        return None
    if isinstance(value, (datetime, date)):
        return parse_date(value)
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (str, int, float, bool)):
        return value
    return as_text(value)


def compact(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if value not in (None, "")}


def headers_for(row: Iterable[Any]) -> dict[str, int]:
    return {normalize_header(value): index for index, value in enumerate(row) if as_text(value)}


def value_for(row: tuple[Any, ...], headers: dict[str, int], *terms: str, exclude: tuple[str, ...] = ()) -> Any:
    for header, index in headers.items():
        if all(term in header for term in terms) and not any(term in header for term in exclude):
            return row[index] if index < len(row) else None
    return None


def status_from_consent(value: Any) -> str:
    raw = as_text(value).lower()
    if raw in {"yes", "y", "received", "done", "1"}:
        return "received"
    if raw in {"pending", "p", "in progress"}:
        return "pending"
    if raw in {"blocked", "hold"}:
        return "blocked"
    if raw in {"rejected", "no"}:
        return "rejected"
    return "not_ready"


def owner_parts(value: Any) -> list[str]:
    source = as_text(value)
    if not source:
        return []
    groups = re.split(r"\n(?=\s*\d+[.)])", source)
    return [re.sub(r"^\s*\d+[.)]\s*", "", group).strip() for group in groups if group.strip()]


def first_data_sheet(workbook) -> Any:
    for sheet in workbook.worksheets:
        if sheet.max_row > 1 and sheet.max_column > 1:
            return sheet
    return workbook.active


def parse_village_workbook(path: Path, code: str, name_en: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    book = load_workbook(path, read_only=True, data_only=True)
    try:
        sheet = first_data_sheet(book)
        iterator = sheet.iter_rows(values_only=True)
        headings = next(iterator, None)
        if not headings:
            raise RuntimeError(f"{path.name} has no header row")
        headers = headers_for(headings)
        records: list[dict[str, Any]] = []
        seen: set[str] = set()
        village_gu = None
        district = None
        taluka = None
        skipped = Counter()
        for source_row, row in enumerate(iterator, start=2):
            survey = value_for(row, headers, "new", "survey")
            survey_normalized = normalize_survey(survey)
            if not survey_normalized:
                if any(as_text(value_for(row, headers, key)) for key in ("farmer", "account", "old survey")):
                    skipped["blank_survey"] += 1
                continue
            if survey_normalized in seen:
                skipped["duplicate_survey"] += 1
                continue
            seen.add(survey_normalized)
            consent = value_for(row, headers, "consent")
            if consent is None:
                consent = value_for(row, headers, "concent")
            village_gu = village_gu or as_text(value_for(row, headers, "village")) or None
            district = district or as_text(value_for(row, headers, "district")) or None
            taluka = taluka or as_text(value_for(row, headers, "taluka")) or None
            records.append(compact({
                "village_code": code,
                "survey_number": as_text(survey),
                "survey_normalized": survey_normalized,
                "survey_match_normalized": report_match_survey(survey),
                "old_survey_number": as_text(value_for(row, headers, "old", "survey")) or None,
                "hectare_are_sqmt": as_text(value_for(row, headers, "h.are.sqmt")) or None,
                "acreage": parse_number(value_for(row, headers, "acer", "guntha")),
                "account_number": as_text(value_for(row, headers, "account", "number")) or None,
                "owner_text": as_text(value_for(row, headers, "farmer", "name")) or None,
                "tenure": as_text(value_for(row, headers, "tenure")) or None,
                "land_use": as_text(value_for(row, headers, "land", "use")) or None,
                "rights_and_encumbrances": as_text(value_for(row, headers, "rights")) or as_text(value_for(row, headers, "હક્ક")) or None,
                "nondh_numbers": as_text(value_for(row, headers, "nondh", "number")) or None,
                "source_workbook": path.name,
                "source_row_number": source_row,
                "consent_status": status_from_consent(consent),
                "consent_source_value": as_text(consent) or None,
            }))
    finally:
        book.close()
    village = compact({
        "code": code,
        "name_en": name_en,
        "name_gu": village_gu,
        "district": district,
        "taluka": taluka,
        "drive_root_folder_id": DRIVE_ROOT_FOLDER_ID,
    })
    return records, {"village": village, "skipped": dict(skipped)}


def parse_patel_workbook(path: Path) -> list[dict[str, Any]]:
    book = load_workbook(path, read_only=True, data_only=True)
    try:
        sheet = first_data_sheet(book)
        iterator = sheet.iter_rows(values_only=True)
        headings = next(iterator, None)
        if not headings:
            raise RuntimeError(f"{path.name} has no header row")
        headers = headers_for(headings)
        records: list[dict[str, Any]] = []
        for source_row, row in enumerate(iterator, start=2):
            survey = value_for(row, headers, "survey", "no", exclude=("unique",))
            village_raw = as_text(value_for(row, headers, "village")).lower()
            village_code = {"bhavanipar": "bhavanipar", "bitta": "bitta", "bita": "bitta"}.get(re.sub(r"\s+", " ", village_raw).strip())
            if not as_text(survey) and not village_code:
                continue
            if not village_code or not normalize_survey(survey):
                continue
            values = {header: json_value(row[index]) if index < len(row) else None for header, index in headers.items()}
            records.append({
                "village_code": village_code,
                "survey_normalized": normalize_survey(survey),
                "source_row_number": source_row,
                "values": values,
            })
    finally:
        book.close()
    return records


def report_value(values: dict[str, Any], *terms: str, exclude: tuple[str, ...] = ()) -> Any:
    for header, value in values.items():
        if all(term in header for term in terms) and not any(term in header for term in exclude):
            return value
    return None


def report_value_exact(values: dict[str, Any], header: str) -> Any:
    return values.get(normalize_header(header))


def report_payload(record: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    values = record["values"]
    safe_source = {
        header: value
        for header, value in values.items()
        if value not in (None, "") and header not in PRIVATE_REPORT_HEADERS
    }
    acquisition = compact({
        "village_code": record["village_code"],
        "survey_normalized": record["survey_normalized"],
        "project_name": as_text(report_value(values, "project", "name")) or None,
        "spv_name": as_text(report_value(values, "spv", "name")) or None,
        "mw": parse_number(report_value_exact(values, "mw")),
        "category": as_text(report_value(values, "category", exclude=("atl",))) or None,
        "atl_category": as_text(report_value(values, "category", "atl")) or None,
        "acquisition_purpose": as_text(report_value(values, "acquisition", "purpose")) or None,
        "project_duration_months": parse_integer(report_value(values, "project", "duration")),
        "block_name": as_text(report_value_exact(values, "block")) or None,
        "target_date": parse_date(report_value(values, "target", "date")),
        "execution_date": parse_date(report_value(values, "date", "execution")),
        "reason_not_acquired": as_text(report_value(values, "reasons", "not", "acquired")) or None,
        "total_acres_in_rtc": parse_number(report_value(values, "total", "acres", "rtc")),
        "total_acres_to_acquire": parse_number(report_value(values, "total", "acquired", exclude=("acres aquired", "sq",))),
        "total_acres_acquired": parse_number(report_value(values, "total", "acres", "aquired")),
        "total_sq_meters_acquired": parse_number(report_value(values, "total", "sq", "acquired")),
        "source_fields": safe_source,
    })
    legal = compact({
        "village_code": record["village_code"],
        "survey_normalized": record["survey_normalized"],
        "public_notice_status": as_text(report_value(values, "public", "notice")) or None,
        "sro_search_status": as_text(report_value(values, "sro", "search")) or None,
        "documents_required": parse_integer(report_value(values, "required", "documents")),
        "documents_submitted": parse_integer(report_value(values, "submited", "documents")),
        "law_firm_verification_status": as_text(report_value(values, "verification", "law", "firm")) or None,
        "pending_documents": as_text(report_value(values, "pending", "documents")) or None,
        "preliminary_tsr_status": as_text(report_value(values, "preliminary", "tsr")) or None,
        "conditional_clearance_status": as_text(report_value(values, "conditional", "cleareance")) or None,
        "nfa_number": as_text(report_value(values, "nfa", "no")) or None,
        "nfa_submitted_on": parse_date(report_value(values, "nfa", "submission")),
        "nfa_approved_on": parse_date(report_value(values, "nfa", "approval")),
        "legal_remarks": as_text(report_value_exact(values, "remarks")) or None,
    })
    private = compact({
        "village_code": record["village_code"],
        "survey_normalized": record["survey_normalized"],
        "pan_number": as_text(report_value_exact(values, "pan card no.")) or None,
        "aadhaar_number": as_text(report_value_exact(values, "aadhar no.")) or None,
        "bank_account_number": as_text(report_value_exact(values, "bank account no.")) or None,
        "bank_name": as_text(report_value_exact(values, "bank name")) or None,
        "ifsc_code": as_text(report_value_exact(values, "ifsc code")) or None,
        "vendor_code": as_text(report_value_exact(values, "vendor code")) or None,
        "bank_owner_name": as_text(report_value_exact(values, "owner name")) or as_text(report_value_exact(values, "owners name ( as per bank records for nfa)")) or None,
    })
    parcel_patch = compact({
        "village_code": record["village_code"],
        "survey_normalized": record["survey_normalized"],
        "latitude": parse_number(report_value_exact(values, "latitude")),
        "longitude": parse_number(report_value_exact(values, "longitude")),
    })
    return acquisition, legal, private, parcel_patch


def load_cad_helpers(script_path: Path):
    spec = importlib.util.spec_from_file_location("cad_helpers", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load CAD mapping helpers")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def build_map_records(cad_json_path: Path, cad_helper_path: Path, land_records: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, int]]:
    cad = json.loads(cad_json_path.read_text(encoding="utf-8"))
    helper = load_cad_helpers(cad_helper_path)
    objects = cad["OBJECTS"]
    layers = helper.layer_name_lookup(objects)
    by_survey: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in land_records:
        by_survey[record["survey_normalized"]].append(record)

    features: list[dict[str, Any]] = []
    links: list[dict[str, Any]] = []
    stats: Counter[str] = Counter()
    for source_name, polygon_layer, label_layer in MAP_LAYER_SOURCES:
        polygons = helper.collect_polygons(objects, layers, polygon_layer)
        labels = helper.collect_labels(objects, layers, label_layer)
        assignments, candidate_counts = helper.assign_labels_to_polygons(labels, polygons)
        labels_by_polygon: dict[int, list[Any]] = defaultdict(list)
        for assignment in assignments.values():
            polygon = assignment["polygon"]
            if polygon is not None:
                labels_by_polygon[polygon.object_index].append(assignment["label"])

        stats[f"{source_name}_polygons"] = len(polygons)
        stats[f"{source_name}_labels"] = len(labels)
        stats[f"{source_name}_unassigned_labels"] = candidate_counts.get(0, 0)
        for object_index, polygon_labels in sorted(labels_by_polygon.items()):
            candidates = []
            seen_keys: set[tuple[str, str]] = set()
            for label in polygon_labels:
                for parcel in by_survey.get(label.normalized, []):
                    key = (parcel["village_code"], parcel["survey_normalized"])
                    if key not in seen_keys:
                        seen_keys.add(key)
                        candidates.append(parcel)
            feature_key = f"cad-{source_name}-{object_index}"
            validation_status = "matched" if len(candidates) == 1 else "ambiguous" if candidates else "unmatched"
            features.append({
                "feature_key": feature_key,
                "svg_element_id": f"dwg-object-{object_index}",
                "source_cad_layer": polygon_layer,
                "validation_status": validation_status,
            })
            stats[f"{source_name}_features"] += 1
            if candidates:
                stats["matched_features"] += 1
            else:
                stats["unmatched_features"] += 1
            if len(candidates) > 1:
                stats["ambiguous_features"] += 1
            for parcel in candidates:
                links.append({
                    "feature_key": feature_key,
                    "village_code": parcel["village_code"],
                    "survey_normalized": parcel["survey_normalized"],
                    "match_method": "cad_label_exact",
                    "match_confidence": "high" if len(candidates) == 1 else "needs_review",
                    "notes": f"Exact CAD label match on {source_name} survey layer" if len(candidates) == 1 else "Exact label occurs in more than one imported village/survey record",
                })
                stats["mapped_parcels"] += 1
    stats["cad_features"] = len(features)
    return features, links, dict(stats)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", required=True, type=Path)
    parser.add_argument("--patel-workbook", required=True, type=Path)
    parser.add_argument("--cad-json", required=True, type=Path)
    parser.add_argument("--cad-helper", type=Path, default=Path(__file__).resolve().parents[1] / "cad-map" / "build_interactive_map.py")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    villages: list[dict[str, Any]] = []
    land_records: list[dict[str, Any]] = []
    summary: dict[str, Any] = {"village_rows": {}, "consent_received": {}, "source_exceptions": {}}
    for code, name, filename in VILLAGE_INPUTS:
        records, village_info = parse_village_workbook(args.input_dir / filename, code, name)
        villages.append(village_info["village"])
        land_records.extend(records)
        summary["village_rows"][code] = len(records)
        summary["consent_received"][code] = sum(record["consent_status"] == "received" for record in records)
        if village_info["skipped"]:
            summary["source_exceptions"][code] = village_info["skipped"]

    by_key = {(record["village_code"], record["survey_match_normalized"]): record for record in land_records}
    acquisition: list[dict[str, Any]] = []
    legal: list[dict[str, Any]] = []
    private: list[dict[str, Any]] = []
    patel_rows = parse_patel_workbook(args.patel_workbook)
    matched_patel = 0
    for report in patel_rows:
        key = (report["village_code"], report_match_survey(report["survey_normalized"]))
        land = by_key.get(key)
        if land is None:
            continue
        # Use the register's canonical key for every later database join while
        # retaining the original report text inside source_fields.
        report["survey_normalized"] = land["survey_normalized"]
        acquisition_row, legal_row, private_row, parcel_patch = report_payload(report)
        acquisition.append(acquisition_row)
        legal.append(legal_row)
        if len(private_row) > 2:
            private.append(private_row)
        land.update({key: value for key, value in parcel_patch.items() if key not in {"village_code", "survey_normalized"} and value is not None})
        matched_patel += 1

    owners: list[dict[str, Any]] = []
    consent: list[dict[str, Any]] = []
    parcels: list[dict[str, Any]] = []
    for record in land_records:
        parcels.append({key: value for key, value in record.items() if key not in {"owner_text", "consent_status", "consent_source_value", "survey_match_normalized"}})
        consent.append({
            "village_code": record["village_code"],
            "survey_normalized": record["survey_normalized"],
            "status": record["consent_status"],
            "source_value": record.get("consent_source_value"),
        })
        for sequence, owner in enumerate(owner_parts(record.get("owner_text")), start=1):
            owners.append({
                "village_code": record["village_code"],
                "survey_normalized": record["survey_normalized"],
                "display_name": owner,
                "source_owner_text": record.get("owner_text"),
                "sequence_no": sequence,
                "is_primary": sequence == 1,
            })

    map_features, map_links, map_summary = build_map_records(args.cad_json, args.cad_helper, land_records)
    summary.update({
        "parcels": len(parcels),
        "owners": len(owners),
        "consents": len(consent),
        "patel_rows": len(patel_rows),
        "patel_matched": matched_patel,
        "patel_unmatched": len(patel_rows) - matched_patel,
        "acquisition_cases": len(acquisition),
        "legal_reviews": len(legal),
        "private_owner_details": len(private),
        "map": map_summary,
    })
    payload = {
        "schema_version": 1,
        "summary": summary,
        "villages": villages,
        "parcels": parcels,
        "owners": owners,
        "consent_records": consent,
        "acquisition_cases": acquisition,
        "legal_reviews": legal,
        "owner_private_details": private,
        "map_features": map_features,
        "parcel_map_features": map_links,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
