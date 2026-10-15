<!-- satellite-contributing -->
# Contributing

Thank you for improving the **eSIM operator kit** ([github.com/alexar76/esim-operator-kit](https://github.com/alexar76/esim-operator-kit)):
a reference eSIM operator on the AIMarket rails, and the SDK existing operators onboard with.

## The most useful contributions

- **A supplier adapter** for a wholesale platform the kit does not know yet: one file implementing
  `catalog`, `order`, `profiles`, `cancel`, `balance` (see `rails/src/supplier.js` and
  `rails/src/suppliers-more.js`), tests against answers shaped like the platform's documented
  examples, and a section in `docs/<lang>/integrations.md` in all five languages.
- **Live confirmation** of a 🟡 integration (Airalo, eSIM Go): run `scripts/catalog.mjs` and one
  cancelled test order on a real account and tell us what you saw. That turns it ✅.
- **A recipe** for a business system (CRM, accounting, chat) built on the webhooks.
- **Fixes** to the payment networks, with a test that fails before the fix.

## Development

```bash
cd rails && npm ci && npm test
cd ../store && npm ci && npm test
node rails/bin/esim-rails.mjs check https://modelmarket.dev/providers/esim --country JP
```

The tests need no network and no keys. A change to the order flow, the payments or the signatures
without a test is not merged.

## Rules

- **Money and secrets.** Never log, store or send in an event an activation code, an order token, a
  key or a seed phrase. Never ask an operator for a private key: the kit takes addresses only.
- **The contract.** `esim.*@v1` only grows: add optional fields, never change the meaning of one.
  Update `rails/spec/esim-v1/*.schema.json` with the code; the tests validate the node's answers
  against them.
- **Five languages.** A change to a user-facing claim updates `README*.md` and `docs/<lang>/*` in
  English, Russian, Spanish, French and Chinese. The store's tests check that every translation keeps
  the English sections, code blocks and tables, and that every relative link resolves.
- **Honest status.** An integration is ✅ only after it ran against the real service.
- **Pinned versions.** Dependencies are pinned exactly; a new one needs a reason in the pull request.

## Pull requests

Small and focused. Say what you tested and how. By contributing you agree that your work is
licensed under the MIT licence of this repository.
