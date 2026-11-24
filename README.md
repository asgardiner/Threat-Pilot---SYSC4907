# ThreatPilot

Browser-based threat modelling tool built as a microkernel with plug-ins. Read `docs/conventions.md` before contributing.

## Setup

Requires Node 22 (same as CI).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest, single run
npm run lint       # includes the plug-in import rules
npm run typecheck
npm run build
```

## Architecture

```
            ┌──────────────────────── kernel (src/kernel) ────────────────────────┐
 toolbar ──▶│ UI shell ── slots ──▶ canvas │ right panel │ threats                │
            │    │                                                                │
            │    ▼                                                                │
            │ services/projectIO ──▶ state/store (K2, Zod-validated) ◀── rule     │
            │    │                         │                            engine    │
            │    │                    event bus (K1)                     (R1)     │
            │    ▼                         │                                      │
            │ plug-in registry (K1) ───────┘                                      │
            └────┬─────────────┬──────────────┬──────────────┬───────────────────┘
                 ▼             ▼              ▼              ▼
             storage/      exporter/     methodology/     diagram/
             local-file    html          stride, cia      dfd-canvas
```

- The **kernel** owns the domain model (`Project`) and is the only thing that writes to it.
- **Plug-ins** implement one interface from `src/kernel/contracts.ts` and import nothing else from the kernel.
- `src/plugins/index.ts` is the single place plug-ins get registered. The kernel finds them through the registry, never by import.
- Everything loaded from storage passes through K2 validation (`store.loadProject`) before it reaches the model.

## How to add a plug-in

1. Create `src/plugins/<kind>/<name>/` with a `plugin.ts` that exports a factory, for example `createMyExporterPlugin(): Exporter`.
2. Implement the matching contract from `@kernel/contracts` (`Methodology`, `Storage`, `Exporter` or `Diagram`). Import types only, and only from `@kernel/contracts`.
3. Declare `permissions` honestly, e.g. `[{ type: 'model', access: 'read' }]`.
4. Re-export the factory from `index.ts` in that folder and add it to the array in `src/plugins/index.ts`.
5. Add `plugin.test.ts` next to it that tests the plug-in against the contract alone, with no kernel running. Inject browser APIs (pickers, `fetch`, clocks) so tests run in Node.
6. Run `npm run lint`. It fails if you imported anything you shouldn't have.

See `src/plugins/storage/local-file` and `src/plugins/exporter/html` for small, complete examples.

## Smoke test

The manual end-to-end script for the Day 5 bug bash is in `docs/smoke-test.md`.
