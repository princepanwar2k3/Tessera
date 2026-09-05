# Tessera

Block Settlement Protocol (BSP) — prepaid block settlement for continuous compute,
on Hedera x402.

**Status: pre-implementation.** The protocol is drafted; no code is written yet.

- Protocol: [`SPEC.md`](./SPEC.md)
- Implementation plan: [`docs/IMPLEMENTATION-PLAN.md`](./docs/IMPLEMENTATION-PLAN.md)

## The invariants

- The provider never computes on credit.
- The renter's maximum loss is one block.
- Termination is deterministic, at a block boundary.
- No escrow, no refunds, no custody. Payment goes provider-direct.
- Block size is set per listing, so billing granularity is something renters shop on.

This README is rewritten at freeze.
