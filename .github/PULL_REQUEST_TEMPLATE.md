## Summary

<!-- What changes, and why. One paragraph. -->

## Changes

-

## Checklist

- [ ] `npm run ci` passes (Prettier, ESLint, 223 tests)
- [ ] `npm run typecheck` passes (Worker and app)
- [ ] Tests added or updated, each named after the behaviour or defect it pins
- [ ] `npm run seed` and `npm run seed:anomalies` leave `seed/` with no diff —
      or the byte change is explained below
- [ ] `npm run bench` still prints `17 / 39  (43.6%)` — or the arithmetic change
      is explained below
- [ ] No secret, key or `.env` value added anywhere in the tree

## Economy invariants

Tick both, or explain why the change is safe:

- [ ] The client still cannot name its own catch (no `fish`, `rarity` or `coins`
      accepted from the app)
- [ ] The client still cannot move its own balance (no local COIN increment; all
      grants and spends are server-side RevenueCat transactions)

## Related issues

Closes #
