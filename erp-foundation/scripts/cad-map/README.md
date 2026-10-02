# CAD map intake and SVG build

This folder turns the supplied combined DWG into a browser-safe SVG and a review manifest. It does **not** insert data into Supabase automatically.

## Inputs

- `BHAVANIPAR - Bitta- Vandh Timbo.dwg` — CAD source.
- `dwgread -O minJSON` output — layers, survey labels and polygon geometry.
- `dwg2SVG --mspace` output — the original CAD paths for the web map.
- `BHAVANIPAR AND BITTA FINAL SHEET (1).xlsx` — source-survey and consent candidates.

## Output and review boundary

`build_interactive_map.py` produces:

- `combined-villages-interactive.svg`: the map used by the prototype. Every primary survey label is joined to the polygon that contains its label point.
- `combined-villages-features.json`: the staging manifest for a human review before `map_features` and `parcel_map_features` are populated in Supabase.

The map has two CAD systems:

| CAD geometry | CAD label layer | Current finding |
| --- | --- | --- |
| 888 primary polygons | `NEW SVY NO` (866 labels) | All 866 labels have a containing polygon. 842 labels have one candidate; 24 have duplicate/nested CAD outlines and use the smallest containing polygon. |
| 207 `Survey_Limit` polygons | `Survey No New` (209 labels) | 208 labels have one containing polygon; label `77` needs manual review. |

The preview applies green only to the confirmed **Bhavanipar** consent source candidates. All other shapes remain neutral until their village boundary and split-survey mapping is reviewed. This avoids incorrectly showing a Bitta or Vandh Timbo record as green.

## Production import order

1. Import workbook rows into `villages`, `parcels`, `consent_records`, and other ERP tables.
2. Review the feature manifest in a map-validation screen, including CAD label `77` and divided Bitta survey numbers.
3. Insert the approved CAD shapes into `map_features`.
4. Insert approved links into `parcel_map_features`. One CAD shape may link to several parcels; the map must turn green only when every linked parcel has consent status `received`.
5. Let the web app query the live Supabase consent status. The SVG preview must never be treated as the production source of truth.
