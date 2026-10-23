/**
 * Shared DB + signer utilities for Vercel serverless functions.
 * Uses Neon (Postgres) for persistence — set DATABASE_URL in env.
 * Provides the same execute({sql, args}) interface as the former libSQL client
 * so all route handlers need zero changes.
 */
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
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

let _sql: NeonQueryFunction<false, false> | null = null

function getSql(): NeonQueryFunction<false, false> {
  if (_sql) return _sql
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL environment variable is not set')
  // Neon serverless driver requires postgresql:// scheme
  const normalizedUrl = url.replace(/^postgres:\/\//, 'postgresql://')
  _sql = neon(normalizedUrl)
  return _sql
}

// ---------------------------------------------------------------------------
// Thin compat wrapper: execute({sql, args}) with ? → $N substitution
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

interface ExecResult {
  rows: Row[]
}

/**
 * Accepts either:
 *   execute('SELECT ...') — no args
 *   execute({ sql: 'SELECT ... WHERE id = ?', args: [id] }) — positional ?
 * Converts ? placeholders to $1, $2, … for Postgres.
 */
export async function dbExecute(
  query: string | { sql: string; args?: unknown[] }
): Promise<ExecResult> {
  const sql = getSql()
  let text: string
  let params: unknown[]

  if (typeof query === 'string') {
    text = query
    params = []
  } else {
    text = query.sql
    params = query.args ?? []
  }

  // Replace ? placeholders with $1, $2, … (left-to-right)
  let idx = 0
  const pgText = text.replace(/\?/g, () => `$${++idx}`)

  // sql.query() returns Row[] directly (not {rows:[]}), so wrap it
  const result = await sql.query(pgText, params as unknown[])
  const rows = Array.isArray(result) ? result : (result as { rows?: Row[] }).rows ?? []
  return { rows: rows as Row[] }
}

// ---------------------------------------------------------------------------
// getDb() — returns an object with the same .execute() shape as libSQL
// ---------------------------------------------------------------------------

export function getDb() {
  return {
    execute: dbExecute,
    // batch() used only in ensureSchema — run sequentially
    batch: async (queries: { sql: string; args?: unknown[] }[]) => {
      for (const q of queries) await dbExecute(q)
    },
  }
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
        deadline_ts BIGINT NOT NULL DEFAULT 0,
        recipients TEXT NOT NULL DEFAULT '[]',
        splits TEXT NOT NULL DEFAULT '[]',
        questions TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
        contract_address TEXT,
        chain_id INTEGER,
        version INTEGER NOT NULL DEFAULT 1,
        style_accent TEXT NOT NULL DEFAULT '#b45309',
        created_at BIGINT NOT NULL,
        published_at BIGINT
      )`,
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
        auth_expiry BIGINT,
        auth_signature TEXT,
        created_at BIGINT NOT NULL,
        confirmed_at BIGINT
      )`,
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        form_id TEXT NOT NULL,
        contract_address TEXT NOT NULL,
        event_name TEXT NOT NULL,
        tx_hash TEXT NOT NULL,
        block_number BIGINT NOT NULL,
        payer_address TEXT,
        submission_id TEXT,
        amount TEXT,
        logged_at BIGINT NOT NULL
      )`,
    },
  ])
  // Add confirmation_message column if missing (older schemas)
  await dbExecute(`ALTER TABLE forms ADD COLUMN IF NOT EXISTS confirmation_message TEXT NOT NULL DEFAULT 'Thank you!'`)
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

// Normalize question types from AI or legacy values to canonical QuestionType
const TYPE_MAP: Record<string, string> = {
  text: 'short_text', short: 'short_text', string: 'short_text',
  textarea: 'long_text', long: 'long_text', paragraph: 'long_text',
  select: 'single_choice', dropdown: 'single_choice', radio: 'single_choice',
  multiselect: 'multiple_choice', checkboxes: 'multiple_choice',
  // single checkbox (agree/disagree) → yes_no
  checkbox: 'yes_no', bool: 'yes_no', boolean: 'yes_no', yesno: 'yes_no', toggle: 'yes_no',
  number: 'short_text', phone: 'short_text', url: 'short_text',
}

function normalizeQuestions(raw: unknown): unknown[] {
  let arr: unknown[]
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw) } catch { return [] }
  } else if (Array.isArray(raw)) {
    arr = raw
  } else {
    return []
  }
  return arr.map((q: unknown) => {
    if (!q || typeof q !== 'object') return q
    const question = q as Record<string, unknown>
    const t = String(question.type ?? '').toLowerCase()
    const normalized = TYPE_MAP[t] ?? t
    return { ...question, type: normalized }
  })
}

export function parseForm(f: Record<string, unknown>) {
  return {
    ...f,
    recipients: typeof f.recipients === 'string' ? JSON.parse(f.recipients) : (f.recipients ?? []),
    splits: typeof f.splits === 'string' ? JSON.parse(f.splits) : (f.splits ?? []),
    questions: normalizeQuestions(f.questions),
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
