# Payment Provider Secrets — ALATPay First

Secrets and API keys are **never** committed to this repository. Set them with
Wrangler (`wrangler secret put NAME`) or in the Cloudflare dashboard for the
Worker environment. Database `provider_configs` rows only hold non-secret
operational settings (status, webhook path, environment, default flag).

## ALATPay checklist

| Secret / variable | Required | Purpose |
|---|---|---|
| `ALATPAY_SECRET_KEY` | Yes | Server-side `Ocp-Apim-Subscription-Key` used for ALATPay virtual-account creation and transaction re-query. |
| `ALATPAY_BUSINESS_ID` | Yes | ALATPay business identifier used when creating a virtual account. |
| `ALATPAY_BASE_URL` | Optional | Override only if ALATPay supplies a different API base URL. |
| `ALATPAY_DEFAULT_EMAIL` | Optional | Fallback customer email when a client has no email address. |

Current ALATPay mode-specific secrets (recommended; used by `PAYMENT_MODE`):

Test mode:

```text
ALATPAY_TEST_SECRET_KEY
ALATPAY_TEST_BUSINESS_ID
ALATPAY_TEST_WEBHOOK_SECRET
ALATPAY_TEST_BASE_URL       (optional)
```

Live mode:

```text
ALATPAY_LIVE_SECRET_KEY
ALATPAY_LIVE_BUSINESS_ID
ALATPAY_LIVE_WEBHOOK_SECRET
ALATPAY_LIVE_BASE_URL       (optional)
```

Set `PAYMENT_MODE=test` for staging and `PAYMENT_MODE=live` only in production.

Legacy `ALATPAY_SECRET_KEY` / `ALATPAY_BUSINESS_ID` are no longer used for the
mode-specific ALATPay integration. See `ALATPAY_INTEGRATION.md`.

Set them separately for production before deploying.

## Webhook configuration

In the ALATPay dashboard, set the callback URL to:

```text
https://<worker-host>/api/webhooks/alatpay
```

For the staging Worker:

```text
https://bliss-property.easterntechexpo.workers.dev/api/webhooks/alatpay
```

ALATPay callbacks are trusted by re-querying ALATPay with `ALATPAY_SECRET_KEY`;
the webhook payload alone never verifies a payment.

The legacy Wema ALAT webhook remains available at
`/api/webhooks/wema-alat` and uses the `webhook_secret` stored in
`provider_configs` for that provider. It is disabled until the provider is
marked `Configured` or `Active` with a secret.

## Additional providers

Every provider adapter has its own webhook route and its own verification:

- ALATPay: `/api/webhooks/alatpay` (server re-query)
- Wema ALAT: `/api/webhooks/wema-alat` (`X-Webhook-Secret`)
- Paystack: `/api/webhooks/paystack` (`x-paystack-signature`, HMAC SHA-512)

For Paystack set `PAYSTACK_SECRET_KEY` as a Worker secret. Activate the provider
and set the default with `POST /api/finance/providers`. No payment, revenue or
commission code needs to change when another adapter is added: register the
adapter and its `provider_configs` row, then use its webhook path.

## Provider default

`provider_configs.is_default` selects the provider used for manually recorded
payments. Exactly one provider should be marked default. Change it through:

```text
POST /api/finance/providers
{ "provider_key": "alatpay", "is_default": true }
```

## Never commit

- `ALATPAY_SECRET_KEY`
- `ALATPAY_BUSINESS_ID` (operational identifier)
- `PAYSTACK_SECRET_KEY`
- Provider webhook signing secrets
- `.dev.vars`, `.env`, or exported Cloudflare credentials
