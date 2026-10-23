/**
 * Shared DB + signer utilities for Vercel serverless functions.
 * Uses Turso (libSQL) for persistence — set TURSO_URL + TURSO_AUTH_TOKEN in env.
 * Falls back to local SQLite file via libsql for dev.
 */
import { createClient, type Client } from '@libsql/client'
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { type Hex } from 'viem'
import crypto from 'crypto'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const ARC_CHAIN_ID = 5042

const SIGNER_PRIVATE_KEY: Hex = (process.env.PACTFORM_SIGNER_KEY as Hex) ||
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

export const signerAccount: PrivateKeyAccount = privateKeyToAccount(SIGNER_PRIVATE_KEY)
export const SIGNER_ADDRESS = signerAccount.address

// ---------------------------------------------------------------------------
// DB client (singleton per lambda warm instance)
// ---------------------------------------------------------------------------

let _client: Client | null = null

export function getDb(): Client {
  if (_client) return _client
  const url = process.env.TURSO_URL || 'file:pactform.db'
  const authToken = process.env.TURSO_AUTH_TOKEN
  _client = createClient({ url, authToken })
  return _client
}

// ---------------------------------------------------------------------------
// Schema init (idempotent — called from each handler on cold start)
// ---------------------------------------------------------------------------

let _initialized = false

export async function ensureSchema(): Promise<void> {
  if (_initialized) return
  const db = getDb()
  await db.batch([
    {
      sql: `CREATE TABLE IF NOT EXISTS forms (
        id TEXT PRIMARY KEY,
        creator_address TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        confirmation_message TEXT NOT NULL DEFAULT 'Thank you!',
        payment_mode TEXT NOT NULL CHECK(payment_mode IN ('collect_split', 'goal_escrow', 'free')),
        price_usdc TEXT NOT NULL DEFAULT '0',
        capacity INTEGER NOT NULL DEFAULT 0,
        goal_count INTEGER NOT NULL DEFAULT 0,
        deadline_ts INTEGER NOT NULL DEFAULT 0,
        recipients TEXT NOT NULL DEFAULT '[]',
        splits TEXT NOT NULL DEFAULT '[]',
        questions TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
        contract_address TEXT,
        chain_id INTEGER,
        version INTEGER NOT NULL DEFAULT 1,
        style_accent TEXT NOT NULL DEFAULT '#b45309',
        created_at INTEGER NOT NULL,
        published_at INTEGER
      )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY,
        form_id TEXT NOT NULL,
        payer_address TEXT NOT NULL,
        response_data TEXT NOT NULL DEFAULT '{}',
        response_commitment TEXT NOT NULL DEFAULT '',
        salt TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','authorized','confirmed','failed')),
        tx_hash TEXT,
        auth_expiry INTEGER,
        auth_signature TEXT,
        created_at INTEGER NOT NULL,
        confirmed_at INTEGER
      )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        form_id TEXT NOT NULL,
        contract_address TEXT NOT NULL,
        event_name TEXT NOT NULL,
        tx_hash TEXT NOT NULL,
        block_number INTEGER NOT NULL,
        payer_address TEXT,
        submission_id TEXT,
        amount TEXT,
        logged_at INTEGER NOT NULL
      )`,
      args: [],
    },
  ], 'deferred')
  _initialized = true
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function generateId(): string {
  return crypto.randomBytes(16).toString('hex')
}

export function now(): number {
  return Math.floor(Date.now() / 1000)
}

export function parseUsdc(amount: string): bigint {
  const [integer, fractional = ''] = amount.split('.')
  const frac = fractional.padEnd(6, '0').slice(0, 6)
  return BigInt(integer) * 1_000_000n + BigInt(frac)
}

export function parseForm(f: Record<string, unknown>) {
  return {
    ...f,
    recipients: JSON.parse(f.recipients as string),
    splits: JSON.parse(f.splits as string),
    questions: JSON.parse(f.questions as string),
  }
}

export async function signAuth(
  contractAddress: string,
  chainId: number,
  payer: string,
  submissionId: Hex,
  responseCommitment: Hex,
  price: bigint,
  expiry: bigint
): Promise<Hex> {
  return signerAccount.signTypedData({
    domain: {
      name: 'Pactform',
      version: '1',
      chainId: BigInt(chainId),
      verifyingContract: contractAddress as Hex,
    },
    types: {
      SubmitAuthorization: [
        { name: 'payer',              type: 'address' },
        { name: 'submissionId',       type: 'bytes32' },
        { name: 'responseCommitment', type: 'bytes32' },
        { name: 'price',              type: 'uint256' },
        { name: 'expiry',             type: 'uint64'  },
      ],
    },
    primaryType: 'SubmitAuthorization',
    message: {
      payer:        payer as Hex,
      submissionId,
      responseCommitment,
      price,
      expiry,
    },
  })
}
