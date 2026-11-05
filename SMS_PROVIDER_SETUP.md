# SMS Provider Setup and Secrets

SMS provider keys are **never** stored in code or the repository. They are Worker
secrets / environment variables. Provider selection, sender ID and reminder
controls are non-secret settings managed in the SMS Centre.

## Supported adapters

| Provider | Worker secrets | Notes |
|---|---|---|
| Termii (first adapter) | `TERMII_API_KEY` | Uses the Termii transactional `dnd` channel with a registered sender ID. |
| Africa's Talking (alternative) | `AFRICASTALKING_API_KEY`, `AFRICASTALKING_USERNAME` | Uses the bulk messaging endpoint. |
| `mock` | None | Test-only adapter. Never enable in production. |

Optional environment overrides:

| Variable | Purpose |
|---|---|
| `SMS_PROVIDER` | Force `termii`, `africastalking` or `mock`, overriding the database setting. |
| `SMS_SENDER_ID` | Registered alphanumeric sender ID (maximum 11 characters), overriding the database setting. |

Set secrets for staging:

```bash
npx wrangler secret put TERMII_API_KEY
# or
npx wrangler secret put AFRICASTALKING_API_KEY
npx wrangler secret put AFRICASTALKING_USERNAME
```

Repeat for production before deploying.

## Termii account setup

1. Create the Termii account and fund it in advance.
2. Request/register the sender ID, for example `BlissLegacy` (maximum 11
   characters).
3. Enable the transactional/DND route. The adapter sends `channel: "dnd"` so
   payment alerts and balance statements are delivered to DND-registered lines.
4. Confirm the account has API access to `POST /api/sms/send` and
   `GET /api/get-balance`.
5. Enter the registered sender ID in the SMS Centre.
6. Use **Send test SMS** and check the delivery log.

## Africa's Talking setup

1. Create an account and fund it in advance.
2. Register the sender ID / short code for the Nigerian environment.
3. Set `AFRICASTALKING_USERNAME` to the account username and
   `AFRICASTALKING_API_KEY` as a Worker secret.
4. Select Africa's Talking in the SMS Centre and send a test.

## Delivery controls

- Global on/off switch.
- Payment received (only after a verified/credited payment).
- Monthly balance statement on a configurable day.
- Optional payment reminders with configurable lead time.
- Optional defaulting reminders with configurable frequency.
- Per-client opt-out; opted-out messages are recorded as `opted_out` and not sent.
- Duplicate payment webhooks cannot send a second SMS because the message uses
  the unique key `payment:<payment_id>:payment_received`.
- Delivery log statuses: `queued`, `sent`, `delivered`, `failed`, `opted_out`,
  `skipped`.
- Queue retries use Cloudflare Queues and exponential backoff; after five
  attempts a message is marked `failed`.

## Provider credit

When the provider exposes a balance endpoint, use **Refresh provider balance**
in the SMS Centre. The balance is cached in `sms_settings` and shown on the MD
dashboard. The MD, Head Accountant and Super Admin are notified once per day
when the balance falls below the configured threshold.

## Nigerian delivery rules

- Use the provider's transactional/DND-bypass route for payment alerts.
- Use a registered sender ID approved for the Nigerian market.
- Keep messages short and plain. Templates support English and optional
  Pidgin/Yoruba/Igbo/Hausa variants; the provider must support the chosen
  language/encoding.
- Phone numbers are normalised to `+234...` before sending.
