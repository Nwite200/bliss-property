# Bliss Legacy Limited — How the Platform Works Today

**Written for the company owner and management team.**

This document explains the system that exists in the code today. Features that are only proposed are clearly marked **Future recommendation**. There is no separate Super Admin role in the current system; the Managing Director is the highest role.

---

## 1. How the company is represented

The platform is a Cloudflare-hosted business system with:

- A public website showing properties and collecting enquiries.
- A staff portal for Managing Directors, Branch Managers, Team Leads, Marketers and Finance Officers.
- A client portal for buyers and prospects.
- A private database (Cloudflare D1) for clients, properties, payments, commissions, teams and audit history.
- Private file storage (Cloudflare R2) for property images, receipts, reports and internal property documents.

The company can have multiple branches. Staff and clients are attached to a branch, and teams are attached to branches.

### Organisational diagram — current system

```text
                         ┌─────────────────────────────┐
                         │   MANAGING DIRECTOR (MD)    │
                         │   Highest implemented role  │
                         │   Company-wide visibility   │
                         └──────────────┬──────────────┘
                                        │
        ┌───────────────────────────────┼───────────────────────────────┐
        │                               │                               │
┌───────▼────────┐            ┌─────────▼─────────┐           ┌─────────▼─────────┐
│ BRANCH MANAGER │            │  FINANCE OFFICER  │           │  STAFF & TEAMS    │
│ Own branch     │            │  Company finance  │           │  Created by MD/BM │
└───────┬────────┘            └───────────────────┘           └───────────────────┘
        │
   ┌────┴──────────────┐
   │                   │
┌──▼─────────┐   ┌─────▼──────┐
│ TEAM LEAD  │   │  MARKETER  │
│ Own team   │   │  Personal  │
└──┬─────────┘   └─────┬──────┘
   │                   │
   └─────────┬─────────┘
             │
      ┌──────▼──────┐
      │   CLIENTS   │
      │ Own records │
      └─────────────┘

Super Admin: NOT IMPLEMENTED. The MD is the highest current role.
```

---

## 2. Super Admin and MD — the difference

### Current reality

There is **no Super Admin account or dashboard**. The first account created through the secure setup endpoint is a **Managing Director**.

The MD can:

- View company-wide business performance.
- Manage branches, staff, teams, properties, clients and commissions.
- Configure provider settings and view company reports.
- Activate or deactivate staff.

The MD cannot create another MD through the normal staff-management screen.

### Future recommendation

If the company wants a true Super Admin, it should be a separate system role with:

- Role and permission configuration.
- System settings and integrations.
- Security and audit controls.
- Account recovery and organisation-wide overrides.

That role does not exist today and must not be confused with the MD.

---

## 3. How branches are created

Branches are currently seeded in the database migration:

- Ikeja
- Ajah
- Asaba
- Ihama
- Obakhavba
- Head Office

There is **no branch-management screen** to create, rename or archive a branch. New branches currently require a database/administration change.

**Future recommendation:** add a branch-management module for the MD/Super Admin.

---

## 4. How Branch Managers are onboarded

1. The MD signs in.
2. The MD opens **Staff & Teams**.
3. The MD clicks **Create staff account**.
4. The MD selects the role **Branch Manager**, the branch, email, temporary password and profile details.
5. The account is created and active immediately.
6. The Branch Manager signs in and sees only their branch.

A Branch Manager cannot create another Branch Manager.

There is no invitation email and no approval step today.

---

## 5. How Team Leads and Marketers are onboarded

1. The MD or the Branch Manager opens **Staff & Teams**.
2. They click **Create staff account**.
3. They choose **Team Lead** or **Marketer**.
4. A Branch Manager can only create staff in their own branch.
5. The account is active immediately.
6. The MD/BM can create a team and assign the Team Lead and Marketers.

Marketers **cannot** register themselves today. There is no employee application page.

**Future recommendation:** allow controlled Marketer self-application with management approval if desired.

---

## 6. How clients register

### Public client registration

1. The client opens **Create Account** on the public website.
2. They enter name, email, phone, password and an optional property interest.
3. The system creates a Client login and a Prospect client record.
4. The account is placed in **Head Office** initially.
5. The client is signed in automatically and sees their portal.
6. Authorised staff later assign the correct branch, marketer and team lead.

Clients cannot choose their branch, marketer, team, contract price or status.

### Staff-created client record

A Marketer, Team Lead, Branch Manager or MD can create a client record from the staff portal. This creates the client record but does not automatically create a client portal login.

---

## 7. How accounts are approved and activated

### Today

- Staff accounts are active as soon as they are created.
- Client accounts are active as soon as they self-register.
- There is no pending-approval queue.
- There is no email verification.
- There is no invitation system.
- Password reset generates a token, but email delivery is not configured.

### Future recommendation

Use one of these policies, independently configurable by role:

- **A. Management-created invitation** — an authorised manager invites the person, who sets a password.
- **B. Self-registration + approval** — the person applies, then management approves.
- **C. Invitation + role/branch approval** — the person is invited, then a second manager confirms role, branch and team.

The company should be able to require approval for Marketers while allowing MD-created Branch Managers to activate immediately.

---

## 8. Who manages each branch and team

- **MD:** company-wide.
- **Branch Manager:** own branch, own staff, own teams, own clients/properties.
- **Team Lead:** own team and team clients/leads.
- **Marketer:** own assigned clients and leads.
- **Finance Officer:** company-wide financial records; no staff administration.
- **Client:** own records only.

A Branch Manager cannot move a client or staff member to another branch. The MD can.

---

## 9. How properties and clients are managed

### Properties

- MD/BM can create and edit properties.
- MD/BM can change status: Available, Reserved, Sold, Unavailable.
- MD/BM can upload images and private documents.
- Published properties appear publicly; unpublished properties are staff-only.
- BM can manage only own-branch properties.
- There is no hard-delete flow; unpublishing and status changes are used instead.

### Clients

- Staff create client records or clients self-register.
- MD/BM can establish or change contract prices.
- Team Leads and Marketers cannot change contract prices.
- Clients cannot change contract prices.
- Staff can add internal notes and update status.
- Reassignment changes the current marketer/branch and removes access from the previous marketer/previous cross-branch manager.

---

## 10. How customer payments are recorded

1. Finance/MD/BM records a manual pending payment with client, property, amount, method and reference.
2. Finance/MD verifies the payment after confirming the bank transfer.
3. Only **verified** NGN payments count as collections.
4. Pending, failed, reversed and refunded payments are excluded from verified balances.
5. A verified payment creates a receipt.
6. The client sees the payment and receipt in the portal.
7. Refunds and reversals require Finance/MD and are audited.

ALAT by Wema virtual-account provisioning is **not live** until official business API access is available. Clients currently see a pending message.

---

## 11. How commissions work

1. MD/Finance creates a commission plan.
2. The plan has rules by role, branch, team, property category or sale type.
3. Rules can be percentage of contract value, percentage of verified collections or a fixed amount.
4. Commission entries are generated manually by authorised users.
5. Duplicate generation is prevented.
6. Entries move through approval and payment.
7. A recipient cannot approve their own commission where separation of duties is enabled.
8. Payments support partial payment and duplicate-payment prevention.
9. Refunds/reversals create traceable adjustments.
10. Commission liability is reconciled from the commission ledger.

No commission rates are invented. Management must configure approved rates.

---

## 12. What each dashboard shows

### Managing Director
Company-wide properties, clients, staff, sales, verified collections, outstanding balances, leads, conversions, branch comparison, marketer rankings, team rankings, commissions, reports and audit activity.

### Branch Manager
Own-branch properties, clients, sales, collections, outstanding balances, marketer rankings, team rankings, branch commission and branch reports.

### Team Lead
Team clients, properties, contract value, verified collections, outstanding, leads, conversions, follow-ups and team commission.

### Marketer
Personal clients, properties, contract value, verified collections, outstanding, leads, conversions, follow-ups and personal commission.

### Finance Officer
Company-wide contract value, verified collections, outstanding balances, transaction ledger, payment verification, refunds/reversals, installments, provider settings, commissions and financial reports.

### Client
Own property/properties, purchase price, verified payments, outstanding balance, progress, payment history, receipts, installment schedule, notifications and profile.

---

## 13. Which reports each role can download

| Role | Reports |
|---|---|
| MD | All report types, company-wide |
| Finance | All financial report types, company-wide |
| Branch Manager | Branch-scoped sales, collections, outstanding, commissions, marketer performance, refunds, branch performance |
| Team Lead | Team-scoped sales, collections, outstanding, commissions, marketer performance, refunds; not branch performance |
| Marketer | Own commission and commission-liability reports only |
| Client | Individual receipts now; transaction/outstanding statement downloads are **not yet implemented** |

CSV contains the complete filtered dataset. PDF includes the official logo, report reference, date, creator, filters and summary; the PDF table is capped for layout.

---

## 14. How staff performance is measured

Current metrics:

- **Verified collections** — actual verified cash, the primary ranking metric.
- **Contract value** — agreed sales value, not cash.
- **Outstanding balance** — contract value less verified cash.
- **Lead conversion rate** — converted leads divided by total leads.
- **Team ranking** — by verified collections, then contract value.
- **Branch comparison** — properties, clients, contract value, verified, outstanding.

Important: marketer rankings currently use the **original marketer/creator**, while client visibility and commission attribution use the **current relationship manager**. The owner should decide which rule should apply before production.

Customer-performance ranking is **not implemented**.

---

## 15. How permissions are controlled

Today:

- Permissions are hardcoded by role in the Worker APIs.
- Hiding a button does not grant access; the API enforces the role.
- MD and Finance have company-wide financial visibility.
- Branch Managers are branch-limited.
- Team Leads and Marketers are team/personal-limited.
- Clients are own-record-only.

Not implemented:

- A Super Admin permission matrix.
- Configurable view/create/edit/delete/approve/export permissions.
- Role-permission UI.

**Future recommendation:** build a permission matrix that can restrict roles further, never bypass mandatory security boundaries.

---

## 16. What happens when a staff member leaves

1. MD or Branch Manager opens Staff & Teams.
2. They deactivate the account.
3. The system marks the account inactive and deletes active sessions.
4. The person can no longer sign in.
5. Historical records remain for audit and financial integrity.
6. Their clients can be reassigned to another marketer.

There is no hard-delete or data-anonymisation flow today.

---

## 17. Notifications and internal communication

### Client notifications — implemented

Clients see notifications for:

- Welcome/account creation.
- Payment verification.
- Payment reversal/refund.
- Installment changes.
- Other account events.

Receipts are downloadable.

### Staff notifications and chat — NOT implemented

- Staff notifications are written into the database for some events but there is no staff notification inbox or staff notification API.
- Meeting notifications are not implemented.
- Staff-to-staff chat is not implemented.
- MD/Super Admin cannot chat with staff in the platform today.
- No chat tables, routes, moderation, attachments or read receipts exist.

**Future recommendation:** a separate internal communication module with clear policy on who may message whom, retention and moderation.

---

## 18. What is working well

- Client, staff and finance data are separated by role.
- Branch, team and personal scopes are enforced by APIs.
- Payments are integer-kobo and verified-only for collections.
- Reassignment removes old marketer/cross-branch access.
- Commissions reconcile and are auditable.
- Private receipts/reports/documents are not publicly served.
- Responsive layouts were tested at desktop, tablet and mobile sizes.
- The platform is deployed and can be tested live.

---

## 19. What the owner should decide next

1. Is a Super Admin role actually required, or is MD system administration sufficient?
2. Should staff self-register, be invited, or only be created by management?
3. Should Marketers require management approval before activation?
4. Should email verification be mandatory?
5. Should performance rankings use original or current marketer attribution?
6. What defines the “best customer” metric?
7. Should staff notifications and internal chat be a Phase 9 module?
8. Which reports must clients be able to download as statements?
9. What retention and audit policy applies to chat, documents and staff records?

---

## 20. Plain-language summary

The platform already runs the core real-estate business: branches, staff, teams, properties, clients, payments, receipts, commissions, reports and a client portal. The MD is currently the top role. Staff accounts are created by management and are active immediately. Clients can self-register. There is no Super Admin, no staff approval workflow, no staff notification inbox and no internal chat yet. Those are the main organisational gaps to decide on before the next phase.
