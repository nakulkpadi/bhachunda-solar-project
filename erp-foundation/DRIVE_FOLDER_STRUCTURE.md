# Google Drive survey folder structure

Every survey uses the organization supplied in the October 6 reference image. Existing Bhavanipur/Bhavanipar village folders and numbered survey folders are reused.

| Record | Upload destination beneath Village / Survey |
| --- | --- |
| PAN, Aadhaar, bank document | KYC With Bank Details / Owner N (imported owner name) |
| Lease Deed | Legal Documents / Lease Deed |
| Consent Letter | Legal Documents / Consent |
| Current 7/12 | Legal Documents / Current 7-12 |
| Nondh No. 6 | Legal Documents / Nondh No. 6 - Mutation Entry |
| Old 7/12 | Legal Documents / Old 7-12 |
| Old Nondh No. 6 | Legal Documents / Old Nondh No. 6 - Mutation Entry |
| Mutation/death certificate and additional files | Other |

Documents > Create missing folders processes all surveys in resumable batches. Check this survey rechecks a selected survey and repairs missing folders. Uploads automatically ensure the complete hierarchy and check the destination folder before storing a document. Folder IDs and completion timestamps are saved in Supabase; document links retain their parcel and owner IDs.

Owner folder names use sequence_no and display_name from the imported land register. They never include PAN, Aadhaar or bank account numbers. Existing spelling variants KYC With Bank Detailes and Lease Dead are reused if present. Duplicate matching folders stop setup for review, rather than silently picking an arbitrary location. Existing files and permissions are preserved.

The setup endpoint requires an active administrator and a valid Supabase session. Database leases are restricted to the server role and serialize village and survey folder creation. It stores a completion only after every required subfolder exists. Interruptions can resume using existing names. No folder operation writes consent_records.

Verification: 32 handler integration tests cover document routing, hierarchy creation, reuse, resume, duplicate detection, deleted-folder repair, roles and project folder boundaries. The GitHub Pages workflow performs the full TypeScript build and integration suite.
