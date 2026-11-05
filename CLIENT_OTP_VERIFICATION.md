# Client Onboarding OTP Verification

New client records start as `unverified`. Existing records were backfilled as
`verified` by migration `0015_client_onboarding_otp.sql`.

## Delivery channels

The client can receive a 6-digit code by:

- **Phone SMS** — uses the existing SMS provider/queue setup in `SMS_PROVIDER_SETUP.md`.
- **Email** — uses the Resend adapter first.

## Email secrets / variables

Set these as Worker secrets or environment variables:

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put EMAIL_FROM
```

Optional:

```text
EMAIL_PROVIDER=resend
```

`EMAIL_FROM` must be a verified Resend sender, for example
`Bliss Legacy <no-reply@blisslegacylimited.com>`.

For automated tests only, `EMAIL_PROVIDER=mock` is accepted outside production.

## Behaviour

- Staff onboarding auto-sends a code to the client's email when email delivery
  is configured, otherwise to their phone by SMS.
- Public signup auto-sends a code and redirects to `client-verify.html`.
- Staff can resend or enter the client's code from the client detail page.
- Codes expire after 10 minutes, allow 5 attempts, and only one active code is
  accepted per client.
- Successful verification sets `clients.verification_status='verified'` and
  records `verified_at` and the channel.
- Verification does not block login or payment access; it is a trust/identity
  signal and can be enforced later if required.
- SMS verification messages are logged in the normal SMS delivery log.
