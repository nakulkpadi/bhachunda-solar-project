# Consent and owner workspace

Open **Entries → Consent**, or open a survey in the land register. Choose the village and survey number first.

Each owner has an **Add details / Edit details** button. Names from the imported 7/12 are read-only. The administrator can save separate names and numbers for PAN and Aadhaar, bank account holder name, account number, branch, IFSC, bank name and account type (SB, CA, OD or CC). Use **Save owner details** for each owner. Existing values load automatically when editing. Leading zeroes in account numbers are retained.

The survey document panel has Current 7/12, Nondh No. 6 / Mutation Entry, KYC, Consent Letter, Old 7/12 and Old Nondh No. 6 / Mutation Entry.

- **Upload** stores a new file in the configured private survey folder in Google Drive and creates a Supabase attachment record.
- **Link existing** lets the administrator browse the configured project Drive folder and attach a file already stored there. It leaves the original file in its current folder. Choose the correct survey and owner explicitly; filenames are not used to guess ownership.
- **View** fetches the registered file through an authenticated backend. PDF and image files can be previewed; Word and Excel files can be downloaded. Multiple attachments remain available in the file dropdown.

For PAN, Aadhaar and bank documents, choose an owner under KYC, or use the upload/link buttons inside that owner's details. Every attachment stores the survey, owner (when applicable), document type, Google file ID and uploader. The backend and database reject owner links across surveys.

**Save consent** is separate from saving owner details. It preserves the existing status when editing. Only **Consent received** changes the map to green. Uploading or linking documents does not mark consent as received.

Only the project administrator can save details, connect Drive, upload or link files. Other active project accounts can view land records and non-sensitive land documents. Identity, bank and consent files remain restricted to the administrator. Drive tokens stay encrypted on the server; the browser receives no Google OAuth credentials.

The Patel Infra report now reads the saved PAN and Aadhaar owner names along with the existing primary owner's PAN, Aadhaar and bank fields. Its existing worksheet layout remains unchanged.

## Verification

`cd apps/web && npm run build && npm run test:integration`

Twenty backend integration tests cover field validation, exact owner/survey links, uploads, cleanup after a failed database insert, private document views, existing-file linking, project-folder boundaries and read-only roles. They mock Google requests and user authentication; they do not write files to the personal Drive account.

Live Supabase transaction rollback checks confirmed admin save/read, all added fields, leading-zero account numbers, viewer read/write denial and rejection of a document linked across surveys. All temporary rows were rolled back.

Final account verification requires the signed-in administrator to upload or link one real document, reopen its View action, and confirm the saved record after reloading. Existing Drive letters are not automatically attached until explicitly linked to the correct survey.
