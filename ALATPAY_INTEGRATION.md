# ALATPay Integration (Test Mode First)

Source of truth read from the rendered ALATPay documentation on 2026-11-05:
`/setup-webhook-url`, `/webhook-validation`, `/transaction-monitoring`,
`/static-wallet`, `/sandbox-environment`.

## Documentation summary

### Setup Webhook URL
- Add the webhook URL in the ALATPay dashboard: Settings → Business → Edit business → add webhook URL → Update Details.
- ALATPay sends an HTTP POST when a transaction completes.
- The response body is wrapped as `{ Value: { Data: { ... }, Status, Message }, ... }`.
- Transaction fields include `Id`, `OrderId`, `Amount`, `Currency`, `Status`, `NgnVirtualBankAccountNumber`, `Customer`, `BusinessId`, `MerchantId`, `Channel`, `CreatedAt`, `UpdatedAt`.
- Example status: `completed`.

### Webhook Validation
- Read the `x-signature` request header.
- Compute `Base64(HMAC-SHA256(raw_request_body, webhook_secret))`.
- Compare with the received `x-signature` using a constant-time comparison.
- Reject and log invalid signatures without processing.
- ALATPay retry schedule: 30 minutes, 1 hour, then 24 hours; return `200 OK` on success.
- ALATPay outbound IP documented as `74.178.162.156`.

### Transaction Monitoring
- List: `GET /alatpaytransaction/api/v1/transactions`
  - Optional filters: `Page`, `Limit`, `MerchantId`, `BusinessId`, `PaymentMethod`, `Status`, `Amount`, `StartAt`, `EndAt`.
- Single: `GET /alatpaytransaction/api/v1/transactions/{transactionId}`.
- Response is wrapped as `{ data: { ... }, status, message }`.
- Status values shown include `pending`, `completed`; failed/reversed handling is application-defined.
- Authentication is the existing ALATPay `Ocp-Apim-Subscription-Key` header.

### Static Wallet
- Base path: `/alatpay-wallet/api/v1/staticaccount`.
- Auth header: `Ocp-Apim-Subscription-Key`.
- Individual wallet type `1`; collection wallet type `2`.
- Initiate:
  - `POST /alatpay-wallet/api/v1/staticaccount`
  - Body: `businessId`, `staticWalletType`, `bvn`, optional `email`.
  - Response: static wallet `id`, `otpTrackingID`, message.
- Validate/create:
  - `POST /alatpay-wallet/api/v1/staticaccount/validateAndCreate`
  - Body: `staticWalletId`, `businessId`, `otp`, `trackingId`.
  - Response: `accountNumber`, `accountName`, `bankName`, `id`.
- List wallets: `GET /alatpay-wallet/api/v1/staticaccount?PageNumber=&Limit=&Status=1&BusinessId=`.
- Collection history: `GET /https://apibox.alatpay.ng/alatpay-wallet/api/v1/staticaccount/collectionhistory`.
- Wallet details: `GET /alatpay-wallet/api/v1/staticaccount/staticAccountId?StaticAccountId=`.
- Individual wallets require the account holder's BVN and OTP sent to the BVN phone number.

### Sandbox Environment
- Test cards:
  - Visa `4111111111111111`, CVV `123`, expiry `12/30`, PIN `1234`, OTP `123456` — success.
  - Mastercard `5555555555554444`, Verve `506104000000000058` — success.
  - Visa `4000000000000002` — insufficient funds.
  - Visa `4000000000000010` — do not honor.
  - Mastercard `5555555555554519` — suspected fraud.
  - Visa `4000000000000028` — OTP screen; every OTP rejected.
  - Visa `4000000000000036` — processor error.
  - Invalid CVV `000`, invalid PIN anything except `1234`, invalid OTP anything except `123456`.
- Static wallet test: BVN `2222222222`, OTP `123456`.
- The sandbox page does **not** state a separate base URL. The integration keeps the configurable ALATPay base URL (default `https://apibox.alatpay.ng`) and uses test credentials.

## Comparison with previous implementation / mismatches fixed

| Area | Previous | Now |
|---|---|---|
| ALATPay webhook authentication | Re-queried provider, no `x-signature` HMAC check | Verifies `x-signature` = Base64(HMAC-SHA256(raw body, test/live webhook secret)) before any side effect |
| Webhook payload | Looked at `body.data`/flat fields | Handles documented `Value.Data` envelope and legacy flat fields |
| Transaction status endpoint | `/bank-transfer/api/v1/bankTransfer/transactions/{id}` | `/alatpaytransaction/api/v1/transactions/{id}` |
| Static wallets | Dynamic amount-specific virtual accounts only | Per-client static wallet initiate/validate/list, permanent account storage, unique per client |
| Test/live separation | One credential set | `PAYMENT_MODE=test|live`, separate secret names, separate webhook routes |
| Test-mode visibility | None | Staff sidebar **TEST MODE — no real money** banner |
| Reconciliation | Manual only | Scheduled + manual ALATPay completed-transaction reconciliation |
| SMS wallet details | No wallet number in payment/account SMS | Permanent wallet number appended when active |

## Webhook URL to enter in ALATPay dashboard

For staging test mode:

```text
https://bliss-property.easterntechexpo.workers.dev/api/webhooks/alatpay/test
```

For live mode later:

```text
https://<production-worker-host>/api/webhooks/alatpay/live
```

Do not point the ALATPay dashboard at `/api/webhooks/alatpay` unless the deployment mode matches; the legacy path resolves to the current mode, but explicit test/live routes are safer.

## Worker secrets

### Test mode

```text
ALATPAY_TEST_SECRET_KEY
ALATPAY_TEST_BUSINESS_ID
ALATPAY_TEST_WEBHOOK_SECRET
ALATPAY_TEST_BASE_URL       (optional)
```

### Live mode

```text
ALATPAY_LIVE_SECRET_KEY
ALATPAY_LIVE_BUSINESS_ID
ALATPAY_LIVE_WEBHOOK_SECRET
ALATPAY_LIVE_BASE_URL       (optional)
```

And one deployment setting:

```text
PAYMENT_MODE=test
```

`PAYMENT_MODE=live` must only be used with live secrets in production. Test
webhooks are rejected with `404` on live deployments and vice versa.

## Static wallet KYC

ALATPay individual static wallets require the client's BVN and an OTP sent to
the phone number attached to that BVN. The portal:

- accepts the BVN only transiently in the initiation request;
- never stores the BVN in D1, audit logs or application logs;
- stores only the wallet reference, OTP tracking ID, account number, bank and status;
- never stores the OTP;
- sends the completed wallet number to the client by SMS when SMS is enabled.

Sandbox values: BVN `2222222222`, OTP `123456`.

## Dynamic accounts

Dynamic amount-specific virtual accounts remain available for one-off payments,
but they can be retired once every client has an active static wallet. Do not
delete the existing dynamic-account code until static wallet coverage and
open balances are checked in production.
