# PACTFORM

## Mainnet Deployments (Arc Mainnet, chain ID 5042)
| Contract | Address | Tx Hash |
|---|---|---|
| PactFormCollectSplit | `0x30fc8C0E9DCe79272F960F991d0A271D859C837C` | `0x6fd042690e15932f20b3136c2fde924aee6603514cc7d19d09854b930c27a787` |
| PactFormEscrow | `0x19F95Bb32CeD110B0221AD80336Be5f90cb0d0E0` | `0xeadc64d5bf201d0249ae7ba548f12fa37d2d3f425d6a3d1641177094e99fbe78` |

Explorer: https://explorer.arc.io

> Built with Arc Studio - Typeform for funded commitments

Turn "I'm interested" into "I'm in." — Creators publish conversational forms. Respondents answer and pay USDC on Arc to submit.

---

## What This App Does

PACTFORM is a paid-form platform with two payment modes:
1. **Collect & Split** — each accepted payment immediately credits recipients per a published split.
2. **Goal Escrow** — payments held in escrow until deadline; if goal count reached, recipients withdraw; otherwise payers claim refunds.

Flagship use case: Workshop registration (0.10 USDC, goal=3 registrations, 70/30 instructor/organizer split, refundable if goal missed).

## Deployed Contracts (Arc Testnet, Chain ID 5042002)

Latest deployments from user wallet `0xf23480B0AFa902bb7646de92b2B538a6A769FdDA`:

| Contract | Address | Explorer |
|---|---|---|
| PactFormCollectSplit | 0x3967EDFE04c5C2c2de03566A5F4e9A85B454DeE7 | https://explorer.testnet.arc.io/address/0x3967EDFE04c5C2c2de03566A5F4e9A85B454DeE7 |
| PactFormEscrow (demo workshop) | 0x30fc8C0E9DCe79272F960F991d0A271D859C837C | https://explorer.testnet.arc.io/address/0x30fc8C0E9DCe79272F960F991d0A271D859C837C |

Demo workshop: 0.10 USDC/registration, goal=3, deadline=2026-10-23, 70/30 split. User wallet is signer, formCreator, and recipient.

## USDC on Arc Testnet
- Address: 0x3600000000000000000000000000000000000000
- Decimals: 6 (ERC-20 view used for all transfers/display)
- Native gas is also USDC (18 decimals) — single pool, never double-count

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```
