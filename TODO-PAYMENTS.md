# TODO — Click/Payme payment integration (deferred)

Pilot billing is invoice-based on purpose: online payment acceptance in
Uzbekistan requires business prerequisites that are not code. Nothing in this
repository talks to a payment provider, and nothing should until every item
below is settled.

## Prerequisites before any integration work

1. **Legal entity registration** — a registered Uzbek legal entity (MChJ/LLC or
   equivalent) with a corporate bank account able to receive acquiring
   settlements. Merchant agreements cannot be signed without it.
2. **Merchant onboarding** — separate merchant applications with Click and
   Payme: KYC documents, activity codes, settlement account details, and
   approval of the product description. Timelines and requirements differ per
   provider; start both early.
3. **Tax and fiscalization requirements** — determine the correct tax regime
   for SaaS credits, whether each payment needs an online fiscal receipt
   (OFD/fiscal module), how e-invoices are issued for corporate customers, and
   how VAT applies to prepaid credits versus consumed checks.
4. **Recurring-payment API** — whether each provider supports tokenized/
   recurring charges for plan renewals, what user consent flows they require,
   and what happens when a stored card expires. If unsupported, renewals stay
   invoice-based even after one-time payments go live.
5. **Refund flow** — provider-side refund API capabilities and deadlines,
   partial versus full refunds, and how a refunded payment maps onto the
   credit ledger (an appended negative `adjustment`/`refund` entry - never a
   mutation of history).
6. **Reconciliation with the credit ledger** — every provider settlement must
   reconcile against ledger grants: idempotent payment references (one
   payment = one grant, replays blocked by the existing unique reference
   index), a daily comparison of provider statements to `grant` entries, and
   an explicit process for mismatches.

## Open questions to ask each provider

- What are the exact merchant onboarding requirements and typical timelines?
- Which callback/webhook signature scheme is used, and can callback origins be
  IP-allowlisted? (Our webhook receiver must keep the SSRF and signature rules
  used elsewhere in this product.)
- Is there a sandbox environment with test cards/wallets, and how faithful is
  it to production behavior?
- What are the settlement schedule, fees, minimums, and chargeback/dispute
  processes?
- Does the API support recurring/tokenized payments for subscription renewal,
  and what consent UX is mandated?
- What are the refund API limits (window, partials) and the fiscal-receipt
  obligations on refund?
- What exactly must appear on the fiscal receipt for prepaid service credits?

## Explicitly out of scope until then

No Click or Payme SDKs, no card processing, no checkout pages, no payment
webhooks, no merchant credentials in any environment, and no automatic
charges. Manual grants (`pnpm billing:grant`) against paid invoices are the
only way credits enter the ledger.
