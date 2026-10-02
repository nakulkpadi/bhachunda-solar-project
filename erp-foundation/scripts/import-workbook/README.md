# Workbook import and reconciliation

`import_workbook.py` is the staging import tool for the two supplied Excel
workbooks. It preserves the source files and writes an `import_runs` audit row
when `--apply` is used.

## What it imports

| Workbook source | Destination |
| --- | --- |
| Bhavanipar, Bitta and Vandh Timbo sheets | `villages`, `parcels`, `parcel_owners` and initial `consent_records` |
| New Survey No. | `parcels.survey_number` plus normalized comparison key |
| Old Survey No., H.Are.SqMt, Acres, Khata, Tenure, Land Use, rights and Nondh | Matching `parcels` fields |
| Farmer Name / ખાતેદાર | Original text plus ordered `parcel_owners` records where parsing is safe |
| Consent / Concent Received | `consent_records.status`; only `yes` becomes `received` |
| Bunch Number | `parcels.bunch_number` |
| Patel Infra official format | `acquisition_cases`, `legal_reviews`, parcel coordinates and the restricted private-owner table |

## Rules

1. Preserve original Gujarati text and original survey-number spelling.
2. Normalize Gujarati digits to Arabic digits only for duplicate detection and CAD-map matching.
3. Do not infer a Drive document or folder from a green Excel row. Green means consent received only.
4. Report blank survey rows, duplicate normalized numbers, invalid dates, invalid numeric areas and unparsed owners as exceptions.
5. Never import PAN, Aadhaar, bank account or file links into browser-side seed data.

## Expected first reconciliation controls

| Village | Unique surveys | Initial consent received |
| --- | ---: | ---: |
| Bhavanipar | 288 | 96 |
| Bitta | 31 | 10 |
| Vandh Timbo | 160 | 0 until operational consent data is supplied |

The staging import is accepted only when parcel counts, consent counts, acreage totals and exception counts have been reviewed by the project owner.

## Run it safely

Install the pinned reader dependency once:

```bash
python3 -m pip install -r requirements.txt
```

Run the non-mutating reconciliation first. It does not need Supabase credentials:

```bash
python3 import_workbook.py \
  --land-workbook "../../../../upload/BHAVANIPAR AND BITTA FINAL SHEET (1).xlsx" \
  --patel-workbook "../../../../upload/PATEL INFRA - OFFICIAL LAND FORMAT.xlsx"
```

After reviewing the printed controls, set the project URL and server-only
service-role key in your terminal environment (never in a `.env` file that is
committed), then apply to the staging project:

```bash
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="server-only-secret"
python3 import_workbook.py \
  --land-workbook "../../../../upload/BHAVANIPAR AND BITTA FINAL SHEET (1).xlsx" \
  --patel-workbook "../../../../upload/PATEL INFRA - OFFICIAL LAND FORMAT.xlsx" \
  --apply
```

PAN, Aadhaar and bank values are intentionally skipped unless you explicitly
add `--include-private` to the `--apply` command. That option writes only to
`owner_private_details`, which is protected by its own RLS policy.

The script maps all supported Patel Infra columns to dedicated operational
fields. Location and coordination fields that do not have a dedicated column
are retained in `acquisition_cases.source_fields`. It never turns a legacy
document cell or a pasted link into an uploaded Drive file.
