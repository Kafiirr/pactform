# Pactform

**Turn "I'm interested" into "I'm in."**

Pactform is an onchain form builder where creators publish conversational registration forms and respondents pay USDC on Arc to submit their answers. Every payment is enforced by a smart contract — no middlemen, no chargebacks, no broken commitments.

Built with [Arc Studio](https://studio.arc.io)

Live app: **https://www.pactform.web.id**

---

## What It Does

Creators build forms with a drag-and-drop question builder (short text, long text, single choice, multiple choice, yes/no). Each form has a payment mode:

- **Collect & Split** — every accepted payment is immediately distributed to one or more recipient wallets at a configured percentage split. No waiting, no manual withdrawals.
- **Goal Escrow** — payments are held in a smart contract until a deadline. If the registration goal is reached, recipients withdraw their share. If not, every payer can claim a full refund.

Free forms (0 USDC) are also supported — no wallet required for those respondents.

An AI generator lets creators describe the form they want in plain language and get a structured question set back instantly.

---

## Deployed Contracts (Arc Mainnet, Chain ID 5042)

| Contract | Address | Deploy Tx |
|---|---|---|
| PactFormCollectSplit | [`0x30fc8C0E9DCe79272F960F991d0A271D859C837C`](https://explorer.arc.io/address/0x30fc8C0E9DCe79272F960F991d0A271D859C837C) | [`0x6fd042...`](https://explorer.arc.io/tx/0x6fd042690e15932f20b3136c2fde924aee6603514cc7d19d09854b930c27a787) |
| PactFormEscrow | [`0x19F95Bb32CeD110B0221AD80336Be5f90cb0d0E0`](https://explorer.arc.io/address/0x19F95Bb32CeD110B0221AD80336Be5f90cb0d0E0) | [`0xeadc64...`](https://explorer.arc.io/tx/0xeadc64d5bf201d0249ae7ba548f12fa37d2d3f425d6a3d1641177094e99fbe78) |

Testnet deployments (Arc Testnet, Chain ID 5042002) are also available — see `AGENTS.md`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS |
| Web3 | wagmi v2, viem v2, ConnectKit |
| Smart Contracts | Solidity 0.8.28, Foundry (forge) |
| Payments | USDC on Arc Mainnet (EIP-712 signed vouchers) |
| Backend | Vercel Serverless Functions (single catch-all `api/index.ts`) |
| Database | Neon Postgres (`@neondatabase/serverless`) |
| AI | OpenRouter (form generation) |
| Fonts | Architects Daughter, IBM Plex Sans |

---

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.1
- [Foundry](https://getfoundry.sh) — for contract compilation and testing (`forge`)
- A Neon Postgres database (free tier works fine): https://neon.tech
- An OpenRouter API key (optional, for AI form generation): https://openrouter.ai
- A wallet private key for the backend EIP-712 signer

---

## Local Development

### 1. Clone

```bash
git clone https://github.com/Kafiirr/pactform.git
cd pactform
```

### 2. Install dependencies

```bash
bun install
```

### 3. Set up environment variables

```bash
cp .env.example .env
```

Fill in the values — see [Environment Variables](#environment-variables) below.

### 4. Run the dev server

```bash
bun run dev
```

The app runs at `http://localhost:5173`. The backend API is proxied through Vite at `/api/*` — no separate server process needed locally (Vite proxies to `http://localhost:3001`, but for local dev the serverless functions run via Vercel CLI or the Vite proxy).

To run the Express-compatible local API server:

```bash
bun run server
```

### 5. Build for production

```bash
bun run build
```

Output goes to `dist/`.

---

## Smart Contracts

Contracts live in `contracts/`. They are written in Solidity 0.8.28 and built with Foundry.

```bash
# Compile
bun run contracts:build     # or: forge build

# Run unit tests
bun run contracts:test      # or: forge test -vv
```

### Deploying contracts

Per-form contracts are deployed **client-side** from the browser via `walletClient.deployContract` — no forge scripts needed in production. The compiled bytecode is inlined in `src/contract-artifacts.ts`.

To deploy the base factory contracts yourself (mainnet or testnet), use the forge scripts in `contracts/script/` with your own RPC and private key.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the values.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Neon Postgres connection string (`postgresql://...`) |
| `PACTFORM_SIGNER_KEY` | Yes | Private key of the EIP-712 voucher signer wallet (backend only, never exposed to client) |
| `VITE_PACTFORM_SIGNER_ADDRESS` | Yes | Public address matching `PACTFORM_SIGNER_KEY` |
| `VITE_COLLECT_SPLIT_ADDRESS` | Yes | Deployed PactFormCollectSplit contract address |
| `VITE_ESCROW_ADDRESS` | Yes | Deployed PactFormEscrow contract address |
| `OPENROUTER_API_KEY` | No | OpenRouter API key — enables AI form generation |
| `VITE_RPC_PROXY_BASE_URL` | No | Arc Studio RPC proxy base URL (set automatically in Arc Studio) |
| `VITE_RPC_PROXY_TOKEN` | No | Arc Studio RPC proxy token (set automatically in Arc Studio) |
| `RPC_PROXY_BASE_URL` | No | Same as above, for server-side use (set automatically in Arc Studio) |
| `RPC_PROXY_TOKEN` | No | Same as above, for server-side use (set automatically in Arc Studio) |
| `RPC_PROXY_CHAINS` | No | Comma-separated list of proxy-supported chain keys (set automatically in Arc Studio) |
| `PRIVATE_KEY` | No | Deployer private key for forge scripts (local only) |
| `PACTFORM_SIGNER_ADDR` | No | Signer address alias for forge scripts (local only) |

> `VITE_`-prefixed variables are exposed to the browser bundle. Never put secrets under a `VITE_` prefix.

---

## Project Structure

```
pactform/
├── api/
│   ├── index.ts          # Single Vercel serverless catch-all handler
│   └── _db.ts            # Neon Postgres client + schema + helpers
├── contracts/
│   ├── PactFormCollectSplit.sol
│   ├── PactFormEscrow.sol
│   ├── script/           # Foundry deploy scripts
│   └── test/             # Foundry unit tests
├── src/
│   ├── App.tsx            # App shell + routing
│   ├── api.ts             # Frontend API client
│   ├── config.ts          # wagmi config
│   ├── contract-artifacts.ts  # Inlined ABI + bytecode
│   ├── contracts.ts       # Contract read/write helpers
│   ├── contracts-deploy.ts    # useDeployFormContract hook
│   ├── onchain-facts.ts   # Chain/USDC addresses (generated)
│   ├── onchain-money.ts   # USDC amount helpers (generated)
│   ├── utils/
│   │   ├── errors.ts      # isUserRejection, parseOnchainError
│   │   └── format.ts      # formatUsdc (handles sub-cent amounts)
│   └── components/
│       ├── ExploreView.tsx
│       ├── FormBuilder.tsx
│       ├── FormFlow.tsx
│       ├── FormCard.tsx
│       ├── QuestionView.tsx
│       ├── CreatorDashboard.tsx
│       ├── RespondentDashboard.tsx
│       └── PaymentRulesCard.tsx
├── .env.example
├── vercel.json
├── foundry.toml
└── vite.config.ts
```

---

## Deploying to Vercel

1. Push the repo to GitHub.
2. Import it in the [Vercel dashboard](https://vercel.com).
3. Set all required environment variables from the table above in Vercel's project settings.
4. Vercel auto-detects the Vite frontend and the `api/` serverless functions.

`vercel.json` routes all `/api/*` requests to `api/index.ts` as a single function, staying within Vercel Hobby's 12-function limit.

---

## How Payments Work

1. Creator deploys a per-form contract (CollectSplit or Escrow) when publishing.
2. Respondent opens the form and clicks "Start registration."
3. The backend signs an EIP-712 voucher authorizing that wallet address to pay.
4. The respondent approves the USDC spend and calls `registerWithVoucher` on the contract.
5. The backend records the confirmed transaction and marks the submission complete.

For free forms, no wallet or USDC is required — submissions go straight to the database.

---

## License

MIT
