# Cloud pricing concept — not a published offer

Owner input on 2026-09-19: **EUR 2.50 net**, with marketplace charges to be investigated.
This replaces the older EUR 2.99 proposal. No billing period has been selected. This
document neither activates billing nor sets customer-facing contractual terms.

## Marketplace research

Primary documentation checked on 2026-09-19. Actual applicability depends on the chosen
market, distribution agreement, account eligibility and payment route; recheck before sale.

| Marketplace/payment route                                  | Published fee model relevant to planning                                                                                               | Source                                                                                                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Microsoft Store, non-game, Microsoft commerce              | 15% store fee for apps                                                                                                                 | [Microsoft revenue sharing](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/why-distribute-through-store)                               |
| Microsoft Store, non-game, own commerce                    | Developer keeps store revenue; external payment-provider charges still require separate calculation                                    | [Microsoft revenue sharing](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/why-distribute-through-store)                               |
| Apple App Store, standard program                          | Standard commission 30%; 15% for eligible programs or qualifying subscriptions. Small Business eligibility is not assumed              | [Apple membership details](https://developer.apple.com/programs/whats-included/), [subscription proceeds](https://developer.apple.com/app-store/subscriptions/) |
| Google Play, auto-renewing subscription using Play Billing | Published EEA/UK/US table from June 30, 2026 separates 10% service fee and 5% billing fee; other regional/program/payment rules differ | [Google Play service fees](https://support.google.com/googleplay/android-developer/answer/112622?hl=en)                                                         |

The Google page was available through indexed primary-source content; direct opening was
blocked by Google's verification page. Its regional table must not be generalized to every
country, purchase type or alternative billing route. This research does not assert that
Quiltor currently ships a production app on every listed marketplace.

## Two distinct interpretations of EUR 2.50

The following is a simplified percentage-only calculation, before tax, payment-provider
fixed fees, refunds, hosting, support and other operating costs. It is not a retail quote.

| Illustrative marketplace share | Proceeds if net customer price is EUR 2.50 | Net customer price needed for EUR 2.50 proceeds |
| ------------------------------ | ------------------------------------------ | ----------------------------------------------- |
| 0%                             | EUR 2.50                                   | EUR 2.50                                        |
| 15%                            | EUR 2.125                                  | EUR 2.941176…                                   |
| 30%                            | EUR 1.75                                   | EUR 3.571428…                                   |

Formula: `net customer price = target proceeds / (1 - percentage fee)`.
Adding 15% to EUR 2.50 would not preserve EUR 2.50 proceeds after a 15% deduction.
Consumer tax and store price tiers must be applied only after selecting the actual market
and contract. No tax rate or final gross price is assumed here.

## Decisions required before selling

- Billing period and whether EUR 2.50 means customer net price or desired net proceeds.
- Marketplaces, regions and payment route; actual program eligibility.
- Included storage, recoverable backup period, cancellation read/export period and deletion
  schedule, backed by operating cost/capacity checks.
- Production endpoint, identity provider and operator responsible for maintenance/deletion.

Engineering can test configurable quota, read-only policy, expiry and synchronization without
inventing these business terms. Public product copy continues to describe only tested
capabilities and does not show an unapproved price.
