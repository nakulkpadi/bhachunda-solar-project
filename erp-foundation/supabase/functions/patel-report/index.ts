import ExcelJS from "npm:exceljs@4.4.0";
import { requireRole } from "../_shared/google-drive-oauth.ts";

const HEADERS = [
  "S.No", "Unique count for Survey No.", "Survey no", "Total Acres In RTC",
  "Total to Acquired in the RTC", "Total Acres Aquired", "Total Sq. Mtrs. Acquired",
  "Project Name", "Village", "Latitude", "Longitude", "SPV Name", "MW", "State",
  "District", "Tehsil", "Mamlatdar Office", "Sub Registrar Office", "SDM Office",
  "DC Office", "Patwari Details", "Tehsildar Details", "Police Station", "SP Office",
  "Aggregator Name", "Aggregator Rep", "Target date/Month", "Date of execution (Lease / Sale)",
  "Reasons for Not Acquired", "Category (Sale / Lease)", "Category (ATL)",
  "Acquisition Purpose  (Solar/Wind)", "Project Duration  ( Year/Months)", "Block",
  "Owners  (Consent Letter)", "Public Notice (News Paper Publication)", "SRO Search ( LAW FIRM)",
  "Required No.of Documents From Legal", "Submited No.of Documents By Land Team",
  "Verification BY LAW FIRM", "Pending Documents", "Preliminary TSR Cleared (LAW FIRM)",
  "Conditional Cleareance Status  (Legal)", "NFA No. ( manual / Portal)", "NFA Submission Date",
  "NFA Approval Date", "Aging", "Owners Name ( as per Bank records for NFA)", "Vendor code",
  "Owners Name ( as per Pan Card)", "PAN card No.", "Owners Name ( as per Adhar Card)",
  "Aadhar No.", "Bank account No.", "Bank Name", "IFSC Code", "Owner Name",
  "Current 7/12, 8/A", "Nondh No. 6 Mutation Entry", "Aadhar", "PAN", "Bank Details",
  "Consent Letter", "Old 7/12", "Old Nondh No. 6 Mutation Entry",
  "Mutation Entry Document (Death Cert.)", "Remarks"
];

function corsHeaders(request: Request): HeadersInit | null {
  const origin = request.headers.get("origin");
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN")?.replace(/\/$/, "");
  if (!allowedOrigin || (origin && origin.replace(/\/$/, "") !== allowedOrigin)) return null;
  return {
    "Access-Control-Allow-Origin": origin ?? allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin"
  };
}

function jsonResponse(body: Record<string, unknown>, status: number, headers: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function reportField(source: unknown, key: string): unknown {
  if (!source || typeof source !== "object" || Array.isArray(source)) return "";
  return (source as Record<string, unknown>)[key] ?? "";
}

function documentStatus(documents: Array<{ document_type_code: string; status: string }>, code: string): string {
  const document = documents.find((item) => item.document_type_code === code);
  if (!document) return "Missing";
  return document.status.replace(/^./, (letter) => letter.toUpperCase());
}

function maybeDate(value: unknown): unknown {
  const raw = text(value);
  return raw || "";
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  if (!headers) return jsonResponse({ error: "Origin is not allowed." }, 403, {});
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "GET") return jsonResponse({ error: "Method not allowed." }, 405, headers);

  try {
    const { admin } = await requireRole(request, ["admin"]);
    const params = new URL(request.url).searchParams;
    const villageFilter = params.get("village") ?? "all";
    const consentFilter = params.get("consent") ?? "all";
    const stageFilter = params.get("stage") ?? "all";
    const { data: parcels, error } = await admin
      .from("parcels")
      .select(`
        id, survey_number, acreage, latitude, longitude,
        villages!inner(code, name_en, district, taluka),
        consent_records(status),
        acquisition_cases(
          project_name, spv_name, mw, category, atl_category, acquisition_purpose,
          project_duration_months, block_name, target_date, execution_date,
          acquisition_stage, reason_not_acquired, total_acres_in_rtc,
          total_acres_to_acquire, total_acres_acquired, total_sq_meters_acquired,
          source_fields
        ),
        legal_reviews(
          public_notice_status, sro_search_status, documents_required,
          documents_submitted, law_firm_verification_status, pending_documents,
          preliminary_tsr_status, conditional_clearance_status, nfa_number,
          nfa_submitted_on, nfa_approved_on, legal_remarks
        ),
        parcel_owners(id, display_name, is_primary),
        parcel_documents(document_type_code, status)
      `)
      .order("survey_number", { ascending: true })
      .limit(1000);
    if (error) throw new Error("Could not load reporting records.");

    const owners = (parcels ?? []).flatMap((parcel) => Array.isArray(parcel.parcel_owners) ? parcel.parcel_owners : []);
    const ownerIds = owners.map((owner) => owner.id);
    const { data: privateRows, error: privateError } = ownerIds.length
      ? await admin
        .from("owner_private_details")
        .select("owner_id, pan_number, aadhaar_number, bank_account_number, bank_name, ifsc_code, vendor_code, bank_owner_name")
        .in("owner_id", ownerIds)
      : { data: [], error: null };
    if (privateError) throw new Error("Could not load restricted reporting fields.");
    const privateByOwner = new Map((privateRows ?? []).map((item) => [item.owner_id, item]));

    const selected = (parcels ?? []).filter((parcel) => {
      const village = first(parcel.villages);
      const consent = first(parcel.consent_records);
      const acquisition = first(parcel.acquisition_cases);
      return (villageFilter === "all" || village?.name_en === villageFilter) &&
        (consentFilter === "all" || consent?.status === consentFilter) &&
        (stageFilter === "all" || acquisition?.acquisition_stage === stageFilter);
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Bhachunda Solar ERP";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("Patel Infra Report", { views: [{ state: "frozen", ySplit: 3 }] });
    sheet.mergeCells("A1:BO1");
    const titleCell = sheet.getCell("A1");
    titleCell.value = "Bhachunda Solar Project — Patel Infra Land Acquisition Report";
    titleCell.font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } };
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF102E4C" } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    sheet.getRow(1).height = 28;
    sheet.mergeCells("A2:BO2");
    const subtitleCell = sheet.getCell("A2");
    subtitleCell.value = `Generated ${new Date().toLocaleDateString("en-IN")} · ${selected.length} surveys · confidential admin report`;
    subtitleCell.font = { italic: true, color: { argb: "FF56657A" } };
    subtitleCell.alignment = { horizontal: "center" };
    sheet.getRow(3).values = HEADERS;
    sheet.getRow(3).height = 42;
    sheet.getRow(3).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1C5B7A" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = { bottom: { style: "thin", color: { argb: "FFB9C7D6" } } };
    });

    selected.forEach((parcel, index) => {
      const village = first(parcel.villages);
      const consent = first(parcel.consent_records);
      const acquisition = first(parcel.acquisition_cases);
      const legal = first(parcel.legal_reviews);
      const source = acquisition?.source_fields;
      const parcelOwners = Array.isArray(parcel.parcel_owners) ? parcel.parcel_owners : [];
      const primaryOwner = parcelOwners.find((owner) => owner.is_primary) ?? parcelOwners[0] ?? null;
      const privateDetails = primaryOwner ? privateByOwner.get(primaryOwner.id) : null;
      const documents = Array.isArray(parcel.parcel_documents) ? parcel.parcel_documents : [];
      const rowNumber = index + 4;
      const values = [
        index + 1,
        { formula: `COUNTIF($C$4:C${rowNumber},C${rowNumber})` },
        parcel.survey_number,
        acquisition?.total_acres_in_rtc ?? parcel.acreage ?? "",
        acquisition?.total_acres_to_acquire ?? "",
        acquisition?.total_acres_acquired ?? "",
        acquisition?.total_sq_meters_acquired ?? "",
        acquisition?.project_name ?? "",
        village?.name_en ?? "",
        parcel.latitude ?? "",
        parcel.longitude ?? "",
        acquisition?.spv_name ?? "",
        acquisition?.mw ?? "",
        reportField(source, "state"),
        reportField(source, "district") || village?.district || "",
        reportField(source, "tehsil") || village?.taluka || "",
        reportField(source, "mamlatdar office"),
        reportField(source, "sub registrar office"),
        reportField(source, "sdm office"),
        reportField(source, "dc office"),
        reportField(source, "patwari details"),
        reportField(source, "tehsildar details"),
        reportField(source, "police station"),
        reportField(source, "sp office"),
        reportField(source, "aggregator name"),
        reportField(source, "aggregator rep"),
        maybeDate(acquisition?.target_date),
        maybeDate(acquisition?.execution_date),
        acquisition?.reason_not_acquired ?? "",
        acquisition?.category ?? "",
        acquisition?.atl_category ?? "",
        acquisition?.acquisition_purpose ?? "",
        acquisition?.project_duration_months ?? "",
        acquisition?.block_name ?? "",
        reportField(source, "owners (consent letter)"),
        legal?.public_notice_status ?? "",
        legal?.sro_search_status ?? "",
        legal?.documents_required ?? "",
        legal?.documents_submitted ?? "",
        legal?.law_firm_verification_status ?? "",
        legal?.pending_documents ?? "",
        legal?.preliminary_tsr_status ?? "",
        legal?.conditional_clearance_status ?? "",
        legal?.nfa_number ?? "",
        maybeDate(legal?.nfa_submitted_on),
        maybeDate(legal?.nfa_approved_on),
        reportField(source, "aging"),
        privateDetails?.bank_owner_name ?? "",
        privateDetails?.vendor_code ?? "",
        reportField(source, "owners name ( as per pan card)"),
        privateDetails?.pan_number ?? "",
        reportField(source, "owners name ( as per adhar card)"),
        privateDetails?.aadhaar_number ?? "",
        privateDetails?.bank_account_number ?? "",
        privateDetails?.bank_name ?? "",
        privateDetails?.ifsc_code ?? "",
        primaryOwner?.display_name ?? "",
        documentStatus(documents, "current_712"),
        documentStatus(documents, "nondh_6"),
        documentStatus(documents, "aadhaar"),
        documentStatus(documents, "pan"),
        documentStatus(documents, "bank_details"),
        consent?.status === "received" ? "Consent received" : documentStatus(documents, "consent_letter"),
        documentStatus(documents, "old_712"),
        documentStatus(documents, "old_nondh_6"),
        documentStatus(documents, "mutation_death_certificate"),
        legal?.legal_remarks ?? ""
      ];
      const row = sheet.addRow(values);
      row.eachCell((cell) => {
        cell.alignment = { vertical: "top", wrapText: true };
        cell.font = { size: 9, color: { argb: "FF23364C" } };
        cell.border = { bottom: { style: "hair", color: { argb: "FFDCE5ED" } } };
      });
      if (index % 2 === 1) {
        row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F8FB" } }; });
      }
    });
    sheet.columns.forEach((column, index) => { column.width = index < 3 ? 15 : index > 46 && index < 57 ? 20 : 18; });
    sheet.autoFilter = { from: "A3", to: `BO${Math.max(3, selected.length + 3)}` };

    const output = await workbook.xlsx.writeBuffer();
    const fileDate = new Date().toISOString().slice(0, 10);
    return new Response(output, {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename=bhachunda-patel-infra-report-${fileDate}.xlsx`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not generate the report.";
    const safeMessage = /authentication|role/i.test(message) ? message : "Could not generate the report.";
    return jsonResponse({ error: safeMessage }, 500, headers);
  }
});
