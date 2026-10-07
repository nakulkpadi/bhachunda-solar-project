# Accounts, invitations and document folders

## Administrator workflow

Sign in to the ERP with the primary administrator account. Open **Users & access**.

1. Choose **Invite user**, enter their email and select Editor, Viewer or Commenter.
2. Send the invitation. The new account remains pending.
3. Review the account in **Pending requests**, choose its role and press **Approve**.
4. Use **All accounts** to change the role or pause approved access.

People may also use **Create account** on the public landing page. Confirming
their email does not approve their ERP access. Pending, rejected and suspended
accounts cannot read project records or use protected document APIs.

| Role | Project access |
| --- | --- |
| Administrator | Manage users, connect Drive, repair folders, confidential Patel Infra report and all project entry tools |
| Editor | Update consent, workflow, owner details, attachments and own notes |
| Commenter | Read project records and standard reports; add/remove own survey notes |
| Viewer | Read project records and standard reports |

PAN, Aadhaar, bank fields and sensitive attachments are restricted to the
Administrator and Editors. Raw import metadata is restricted to the
Administrator. No role selector in this screen can create another Administrator.

## Required email configuration

Email invitations, confirmation and reset messages use Supabase Auth. Configure
a custom SMTP sender in **Supabase → Authentication → Email → SMTP settings**.
The default Supabase email service delivers only to pre-authorized project-team
addresses and is unsuitable for general staff invitations.

Use the sender's host, port, username, password, From address and sender name in
Supabase's secure settings. Do not put SMTP credentials in frontend source,
GitHub or chat. The email service and its credentials are not included in this
repository. Actual email delivery must be checked with a recipient you choose.

In **Authentication → URL Configuration**, use the ERP's GitHub Pages address
as Site URL and allow its exact `index.html` address as an email redirect.
Keep email signup and email confirmation enabled. Test one invitation,
confirmation and password reset before inviting the full team.

Official instructions: [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## Drive privacy and older folders

Set **Solar Projects → Share → General access → Restricted**. Keep the Google
account connected to the ERP as an Editor or Owner of that folder. Check old
child folders and files for separately granted public permissions too.

The ERP blocks new sensitive uploads when its server detects public or
unverifiable project-folder sharing. ERP account approval cannot protect old
files that are independently public in Google Drive. Folder creation does not
change permissions.

Open **Documents → Repair older folders**. It reuses existing village/survey
folders, including Gujarati survey-number aliases, and creates missing children:

```
Survey number/
  KYC With Bank Details/
    Owner N (registered owner name)/
  Legal Documents/
    Lease Deed/
    Consent/
    Current 7-12/
    Nondh No. 6 - Mutation Entry/
    Old 7-12/
    Old Nondh No. 6 - Mutation Entry/
  Other/
```

Surveys missing from the imported register receive the base and legal folders;
owner names are never guessed. Existing letters stay in place. The repair is
resumable and records completed folder IDs in Supabase. New uploads use the
selected survey, owner and document-category folder automatically.

## Map controls

Scroll over the map to zoom around the cursor; drag to move; use **Fit** to
restore the complete three-village map. The plus/minus controls and keyboard
arrows, +/- and Home/0 also work. Green means consent received only. Clicking a
mapped boundary opens its linked registered survey; unmatched CAD boundaries
show their mapping status instead of guessing a record.
