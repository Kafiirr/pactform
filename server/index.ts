/**
 * PACTFORM Backend Server
 * Express API for form CRUD, EIP-712 authorization signing, response management, and event reconciliation.
 * Runs on port 3001. Frontend proxies /api/* through Vite dev server.
 */

import express, { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import { createHmac } from 'crypto'
import Database from 'bun:sqlite'
import path from 'path'
import { spawnSync } from 'child_process'
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { type Hex } from 'viem'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || '3001', 10)
const ARC_CHAIN_ID = 5042

// Contract + demo addresses come from environment — never hardcoded.
const DEMO_ESCROW_ADDRESS = process.env.VITE_ESCROW_ADDRESS
const DEMO_INSTRUCTOR_ADDRESS = process.env.VITE_DEMO_INSTRUCTOR_ADDRESS

// In production this must be a securely stored private key, NOT prefixed VITE_.
// For testnet demo we fall back to a well-known Foundry test key if unset.
const SIGNER_PRIVATE_KEY: Hex = (process.env.PACTFORM_SIGNER_KEY as Hex) ||
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

const signerAccount: PrivateKeyAccount = privateKeyToAccount(SIGNER_PRIVATE_KEY)
const SIGNER_ADDRESS = signerAccount.address
const SIGNER_ADDR_FOR_DEPLOY = SIGNER_ADDRESS  // same key used in contracts

console.log(`[pactform] Signer address: ${SIGNER_ADDRESS}`)
if (!process.env.PACTFORM_SIGNER_KEY) {
  console.warn('[pactform] WARNING: Using default test signer key — set PACTFORM_SIGNER_KEY for production')
}

// ---------------------------------------------------------------------------
// SQLite database
// ---------------------------------------------------------------------------

const DB_PATH = path.join(process.cwd(), 'pactform.db')
const db = new Database(DB_PATH)
db.run('PRAGMA journal_mode=WAL')
db.run('PRAGMA foreign_keys=OFF')

db.run(`
  CREATE TABLE IF NOT EXISTS forms (
    id TEXT PRIMARY KEY,
    creator_address TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    confirmation_message TEXT NOT NULL,
    payment_mode TEXT NOT NULL CHECK(payment_mode IN ('collect_split', 'goal_escrow', 'free')),
    price_usdc TEXT NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 0,
    goal_count INTEGER NOT NULL DEFAULT 0,
    deadline_ts INTEGER NOT NULL DEFAULT 0,
    recipients TEXT NOT NULL,
    splits TEXT NOT NULL,
    questions TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
    contract_address TEXT,
    chain_id INTEGER,
    version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    published_at INTEGER,
    style_accent TEXT NOT NULL DEFAULT '#122d45'
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    form_id TEXT NOT NULL REFERENCES forms(id),
    payer_address TEXT NOT NULL,
    response_data TEXT NOT NULL,
    response_commitment TEXT NOT NULL,
    salt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','authorized','confirmed','failed')),
    tx_hash TEXT,
    auth_expiry INTEGER,
    auth_signature TEXT,
    created_at INTEGER NOT NULL,
    confirmed_at INTEGER
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS events (
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
  )
`)

// ---------------------------------------------------------------------------
// Migration: widen payment_mode CHECK to include 'free'
// SQLite doesn't support ALTER COLUMN, so we recreate the table if the old
// constraint is still in place (detected by checking the schema string).
// ---------------------------------------------------------------------------
;(function migratePaymentMode() {
  const schema = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='forms'`).get() as { sql: string } | undefined)?.sql ?? ''
  if (schema.includes("'collect_split', 'goal_escrow'") && !schema.includes("'free'")) {
    db.exec(`
      BEGIN;
      ALTER TABLE forms RENAME TO forms_old;
      CREATE TABLE forms (
        id TEXT PRIMARY KEY,
        creator_address TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        confirmation_message TEXT NOT NULL,
        payment_mode TEXT NOT NULL CHECK(payment_mode IN ('collect_split', 'goal_escrow', 'free')),
        price_usdc TEXT NOT NULL,
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
        published_at INTEGER,
        confirmation_message_override TEXT
      );
      INSERT INTO forms SELECT
        id, creator_address, title, description, confirmation_message,
        payment_mode, price_usdc, capacity, goal_count, deadline_ts,
        recipients, splits, questions, status, contract_address, chain_id,
        version, style_accent, created_at, published_at, NULL
      FROM forms_old;
      DROP TABLE forms_old;
      COMMIT;
    `)
    console.log('[pactform] Migrated forms table: added free payment_mode')
  }

  // Rebuild submissions to refresh FK references after forms table rebuild
  const subsCols = (db.query("PRAGMA table_info(submissions)").all() as {name:string}[]).map(r => r.name)
  if (subsCols.length > 0) {
    db.run(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS submissions_new (
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
        confirmed_at INTEGER,
        FOREIGN KEY(form_id) REFERENCES forms(id)
      );
      INSERT OR IGNORE INTO submissions_new SELECT
        id, form_id, payer_address,
        COALESCE(response_data,'{}'),
        COALESCE(response_commitment,''),
        COALESCE(salt,''),
        status, tx_hash, auth_expiry, auth_signature, created_at, confirmed_at
      FROM submissions;
      ALTER TABLE submissions RENAME TO submissions_old;
      ALTER TABLE submissions_new RENAME TO submissions;
      DROP TABLE submissions_old;
      COMMIT;
    `)
    console.log('[pactform] Rebuilt submissions table to refresh FK references')
  }
})()

db.run('PRAGMA foreign_keys=ON')

// ---------------------------------------------------------------------------
// App + middleware
// ---------------------------------------------------------------------------

const app = express()
app.use(express.json())

app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  if (_req.method === 'OPTIONS') { res.sendStatus(204); return }
  next()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return crypto.randomBytes(16).toString('hex')
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function parseUsdc(amount: string): bigint {
  const [integer, fractional = ''] = amount.split('.')
  const frac = fractional.padEnd(6, '0').slice(0, 6)
  return BigInt(integer) * 1_000_000n + BigInt(frac)
}

// Sign an EIP-712 SubmitAuthorization using viem's signTypedData, which
// correctly encodes the \x19\x01 prefix without adding the personal-sign prefix.
async function signAuth(
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
      payer:              payer as Hex,
      submissionId,
      responseCommitment,
      price,
      expiry,
    },
  })
}

// ---------------------------------------------------------------------------
// Routes: Forms
// ---------------------------------------------------------------------------

app.get('/api/forms', (_req: Request, res: Response) => {
  const forms = db.prepare(
    `SELECT id, title, description, payment_mode, price_usdc, capacity, goal_count, deadline_ts,
            recipients, splits, questions, status, contract_address, chain_id, version, style_accent,
            created_at, published_at, confirmation_message
     FROM forms WHERE status = 'published' ORDER BY published_at DESC`
  ).all() as Record<string, unknown>[]

  res.json({
    forms: forms.map(f => ({
      ...f,
      recipients: JSON.parse(f.recipients as string),
      splits: JSON.parse(f.splits as string),
      questions: JSON.parse(f.questions as string),
    }))
  })
})

app.get('/api/forms/:id', (req: Request, res: Response) => {
  const form = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
  if (!form) { res.status(404).json({ error: 'Form not found' }); return }

  res.json({
    form: {
      ...form,
      recipients: JSON.parse(form.recipients as string),
      splits: JSON.parse(form.splits as string),
      questions: JSON.parse(form.questions as string),
    }
  })
})

app.post('/api/forms', (req: Request, res: Response) => {
  const {
    creator_address,
    title,
    description = '',
    confirmation_message = 'Thank you for registering!',
    payment_mode,
    price_usdc,
    capacity = 0,
    goal_count = 0,
    deadline_ts = 0,
    recipients,
    splits,
    questions = [],
    style_accent = '#122d45',
  } = req.body

  if (!creator_address || !title || !payment_mode || !price_usdc) {
    res.status(400).json({ error: 'Missing required fields' }); return
  }
  if (!['collect_split', 'goal_escrow', 'free'].includes(payment_mode)) {
    res.status(400).json({ error: 'Invalid payment_mode' }); return
  }

  const id = generateId()
  db.prepare(
    `INSERT INTO forms (id, creator_address, title, description, confirmation_message, payment_mode,
      price_usdc, capacity, goal_count, deadline_ts, recipients, splits, questions, status, created_at, style_accent)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?)`
  ).run(
    id, creator_address.toLowerCase(), title, description, confirmation_message, payment_mode,
    price_usdc, capacity, goal_count, deadline_ts,
    JSON.stringify(recipients || []),
    JSON.stringify(splits || []),
    JSON.stringify(questions),
    now(),
    style_accent
  )

  const form = db.prepare('SELECT * FROM forms WHERE id = ?').get(id) as Record<string, unknown>
  res.status(201).json({ form: { ...form, recipients: JSON.parse(form.recipients as string), splits: JSON.parse(form.splits as string), questions: JSON.parse(form.questions as string) } })
})

app.put('/api/forms/:id', (req: Request, res: Response) => {
  const form = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
  if (!form) { res.status(404).json({ error: 'Not found' }); return }
  if (form.status === 'deleted') { res.status(400).json({ error: 'Cannot edit a deleted form' }); return }

  const {
    title, description, confirmation_message, payment_mode, price_usdc,
    capacity, goal_count, deadline_ts, recipients, splits, questions, style_accent
  } = req.body

  const isDraft = form.status === 'draft'

  // Published/archived forms: only non-payment fields can be changed.
  // Payment fields (mode, price, recipients, splits, goal, deadline) are locked
  // once published because they are baked into the deployed contract.
  db.prepare(
    `UPDATE forms SET
      title=COALESCE(?,title),
      description=COALESCE(?,description),
      confirmation_message=COALESCE(?,confirmation_message),
      questions=COALESCE(?,questions),
      style_accent=COALESCE(?,style_accent),
      payment_mode=CASE WHEN ? THEN COALESCE(?,payment_mode) ELSE payment_mode END,
      price_usdc=CASE WHEN ? THEN COALESCE(?,price_usdc) ELSE price_usdc END,
      capacity=CASE WHEN ? THEN COALESCE(?,capacity) ELSE capacity END,
      goal_count=CASE WHEN ? THEN COALESCE(?,goal_count) ELSE goal_count END,
      deadline_ts=CASE WHEN ? THEN COALESCE(?,deadline_ts) ELSE deadline_ts END,
      recipients=CASE WHEN ? THEN COALESCE(?,recipients) ELSE recipients END,
      splits=CASE WHEN ? THEN COALESCE(?,splits) ELSE splits END
     WHERE id = ?`
  ).run(
    title ?? null, description ?? null, confirmation_message ?? null,
    questions ? JSON.stringify(questions) : null,
    style_accent ?? null,
    isDraft ? 1 : 0, payment_mode ?? null,
    isDraft ? 1 : 0, price_usdc ?? null,
    isDraft ? 1 : 0, capacity ?? null,
    isDraft ? 1 : 0, goal_count ?? null,
    isDraft ? 1 : 0, deadline_ts ?? null,
    isDraft ? 1 : 0, recipients ? JSON.stringify(recipients) : null,
    isDraft ? 1 : 0, splits ? JSON.stringify(splits) : null,
    req.params.id
  )

  const updated = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id) as Record<string, unknown>
  res.json({ form: { ...updated, recipients: JSON.parse(updated.recipients as string), splits: JSON.parse(updated.splits as string), questions: JSON.parse(updated.questions as string) } })
})

// ---------------------------------------------------------------------------
// Contract deployment helper (runs forge script --broadcast)
// ---------------------------------------------------------------------------

function deployContract(form: Record<string, unknown>): { address: string } | { error: string } {
  const PRIVATE_KEY = process.env.PRIVATE_KEY
  if (!PRIVATE_KEY) return { error: 'PRIVATE_KEY not set in environment' }

  const recipients: string[] = JSON.parse(form.recipients as string)
  const splits: number[] = JSON.parse(form.splits as string)

  // Pad to 5 slots
  const ZERO = '0x0000000000000000000000000000000000000000'
  while (recipients.length < 5) recipients.push(ZERO)
  while (splits.length < 5) splits.push(0)

  const priceRaw = parseUsdc(form.price_usdc as string).toString()
  const isEscrow = form.payment_mode === 'goal_escrow'
  const script = isEscrow
    ? 'contracts/script/DeployEscrowParam.s.sol:DeployEscrowParam'
    : 'contracts/script/DeployCollectSplitParam.s.sol:DeployCollectSplitParam'

  // formCreator is the connected user's wallet — they own the contract.
  // The PRIVATE_KEY (server-held) just pays gas for the deployment tx.
  const formCreator = (form.creator_address as string) || ''
  if (!formCreator || formCreator === '0x0000000000000000000000000000000000000000') {
    return { error: 'Form has no creator_address — connect your wallet before publishing.' }
  }

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PRIVATE_KEY,
    FORM_CREATOR: formCreator,
    PACTFORM_SIGNER_ADDR: SIGNER_ADDR_FOR_DEPLOY,
    FORM_PRICE: priceRaw,
    FORM_CAPACITY: String(form.capacity || 0),
    FORM_RECIPIENT_0: recipients[0] || ZERO,
    FORM_RECIPIENT_1: recipients[1] || ZERO,
    FORM_RECIPIENT_2: recipients[2] || ZERO,
    FORM_RECIPIENT_3: recipients[3] || ZERO,
    FORM_RECIPIENT_4: recipients[4] || ZERO,
    FORM_SPLIT_0: String(splits[0] || 0),
    FORM_SPLIT_1: String(splits[1] || 0),
    FORM_SPLIT_2: String(splits[2] || 0),
    FORM_SPLIT_3: String(splits[3] || 0),
    FORM_SPLIT_4: String(splits[4] || 0),
  }

  if (isEscrow) {
    env.FORM_GOAL_COUNT = String(form.goal_count || 1)
    env.FORM_DEADLINE = String(form.deadline_ts || 0)
  }

  const args = [
    'script', script,
    '--rpc-url', 'arc_mainnet',
    '--broadcast',
    '--private-key', PRIVATE_KEY,
    '--skip-simulation',
  ]

  const result = spawnSync('forge', args, {
    env,
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 120_000,
  })

  const output = (result.stdout || '') + (result.stderr || '')
  console.log('[deploy]', output)

  if (result.status !== 0) {
    return { error: `forge script failed: ${output.slice(-500)}` }
  }

  // Parse "DEPLOYED_ADDRESS=0x..." from console.log output
  const match = output.match(/DEPLOYED_ADDRESS=?(0x[0-9a-fA-F]{40})/)
  if (!match) return { error: `Could not parse deployed address from output: ${output.slice(-300)}` }

  return { address: match[1] }
}

app.post('/api/forms/:id/deploy-contract', async (req: Request, res: Response) => {
  const form = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
  if (!form) { res.status(404).json({ error: 'Not found' }); return }
  if (form.status !== 'draft') { res.status(400).json({ error: 'Only drafts can be deployed' }); return }

  const result = deployContract(form)
  if ('error' in result) { res.status(500).json({ error: result.error }); return }

  res.json({ contract_address: result.address, chain_id: 5042 })
})

app.post('/api/forms/:id/publish', (req: Request, res: Response) => {
  const form = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
  if (!form) { res.status(404).json({ error: 'Not found' }); return }
  if (form.status !== 'draft') { res.status(400).json({ error: 'Already published' }); return }

  // Free forms have no contract — publish directly without a contract address
  if (form.payment_mode === 'free') {
    db.prepare(`UPDATE forms SET status='published', published_at=? WHERE id=?`).run(now(), req.params.id)
    const updated = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id) as Record<string, unknown>
    res.json({ form: { ...updated, recipients: JSON.parse(updated.recipients as string), splits: JSON.parse(updated.splits as string), questions: JSON.parse(updated.questions as string) } })
    return
  }

  const { contract_address, chain_id = ARC_CHAIN_ID } = req.body
  if (!contract_address) { res.status(400).json({ error: 'contract_address required' }); return }

  db.prepare(
    `UPDATE forms SET status='published', contract_address=?, chain_id=?, published_at=? WHERE id=?`
  ).run(contract_address, chain_id, now(), req.params.id)

  const updated = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id) as Record<string, unknown>
  res.json({ form: { ...updated, recipients: JSON.parse(updated.recipients as string), splits: JSON.parse(updated.splits as string), questions: JSON.parse(updated.questions as string) } })
})

// DELETE — permanently removes the form and all its submissions regardless of status
app.delete('/api/forms/:id', (req: Request, res: Response) => {
  const form = db.prepare('SELECT status FROM forms WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
  if (!form) { res.status(404).json({ error: 'Not found' }); return }
  db.prepare('DELETE FROM submissions WHERE form_id = ?').run(req.params.id)
  db.prepare('DELETE FROM forms WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// ARCHIVE — soft-delete for published forms (hides from Explore, keeps submission records)
app.post('/api/forms/:id/archive', (req: Request, res: Response) => {
  const form = db.prepare('SELECT status FROM forms WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
  if (!form) { res.status(404).json({ error: 'Not found' }); return }
  if (form.status === 'draft') {
    res.status(400).json({ error: 'Use delete for drafts.' }); return
  }
  db.prepare(`UPDATE forms SET status='archived' WHERE id=?`).run(req.params.id)
  res.json({ ok: true })
})

// UNARCHIVE — restore archived form back to published
app.post('/api/forms/:id/unarchive', (req: Request, res: Response) => {
  const form = db.prepare('SELECT status FROM forms WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
  if (!form) { res.status(404).json({ error: 'Not found' }); return }
  if (form.status !== 'archived') { res.status(400).json({ error: 'Form is not archived.' }); return }
  db.prepare(`UPDATE forms SET status='published' WHERE id=?`).run(req.params.id)
  res.json({ ok: true })
})

app.get('/api/forms/:id/responses', (req: Request, res: Response) => {
  const rows = db.prepare(
    `SELECT id, form_id, payer_address, status, tx_hash, created_at, confirmed_at, response_data
     FROM submissions WHERE form_id = ? ORDER BY created_at DESC`
  ).all(req.params.id) as Record<string, unknown>[]
  // Parse response_data JSON for each row
  const parsed = rows.map(r => ({
    ...r,
    response_data: r.response_data ? (() => { try { return JSON.parse(r.response_data as string) } catch { return {} } })() : {}
  }))
  res.json({ responses: parsed })
})

// ---------------------------------------------------------------------------
// Routes: Submissions / Authorization
// ---------------------------------------------------------------------------

app.post('/api/forms/:id/start-submission', async (req: Request, res: Response) => {
  const form = db.prepare('SELECT * FROM forms WHERE id = ? AND status = ?')
    .get(req.params.id, 'published') as Record<string, unknown> | undefined

  if (!form) { res.status(404).json({ error: 'Form not found or not published' }); return }

  const { payer_address, response_data } = req.body
  if (!payer_address || !response_data) {
    res.status(400).json({ error: 'payer_address and response_data required' }); return
  }

  if (!form.contract_address) {
    res.status(400).json({ error: 'Form has no contract address' }); return
  }

  // Idempotency: return existing authorized submission if still valid.
  // If it exists but has expired, re-sign it with a fresh expiry rather than
  // creating a new submission — the USDC approve was already issued for the
  // original submissionId + responseCommitment pair.
  const existing = db.prepare(
    `SELECT * FROM submissions WHERE form_id = ? AND LOWER(payer_address) = LOWER(?) AND status IN ('authorized')`
  ).get(req.params.id, payer_address) as Record<string, unknown> | undefined

  const price = parseUsdc(form.price_usdc as string)
  const chainId = (form.chain_id as number) || ARC_CHAIN_ID
  const authExpiry = BigInt(now() + 1800) // 30 minutes

  if (existing) {
    const stillValid = (existing.auth_expiry as number) > now() + 60

    if (stillValid) {
      // Return cached auth as-is
      res.json({
        submission_id: existing.id,
        auth_signature: existing.auth_signature,
        auth_expiry: (existing.auth_expiry as number).toString(),
        response_commitment: existing.response_commitment,
        price_raw: price.toString(),
        contract_address: form.contract_address,
        chain_id: chainId,
        signer_address: SIGNER_ADDRESS,
      })
      return
    }

    // Expired — re-sign the same submissionId + responseCommitment with a new expiry
    const freshSig = await signAuth(
      form.contract_address as string,
      chainId,
      payer_address,
      existing.id as Hex,
      existing.response_commitment as Hex,
      price,
      authExpiry
    )

    db.prepare(
      `UPDATE submissions SET auth_expiry = ?, auth_signature = ? WHERE id = ?`
    ).run(Number(authExpiry), freshSig, existing.id)

    res.json({
      submission_id: existing.id,
      auth_signature: freshSig,
      auth_expiry: authExpiry.toString(),
      response_commitment: existing.response_commitment,
      price_raw: price.toString(),
      contract_address: form.contract_address,
      chain_id: chainId,
      signer_address: SIGNER_ADDRESS,
    })
    return
  }

  const submissionId = `0x${generateId()}${generateId()}` as Hex
  const salt = crypto.randomBytes(32).toString('hex')

  const canonicalized = JSON.stringify(response_data, Object.keys(response_data).sort())
  const hmac = createHmac('sha256', salt)
  hmac.update(canonicalized)
  const responseCommitment = `0x${hmac.digest('hex')}` as Hex

  const signature = await signAuth(
    form.contract_address as string,
    chainId,
    payer_address,
    submissionId,
    responseCommitment,
    price,
    authExpiry
  )

  db.prepare(
    `INSERT OR REPLACE INTO submissions
     (id, form_id, payer_address, response_data, response_commitment, salt, status, auth_expiry, auth_signature, created_at)
     VALUES (?,?,?,?,?,?,'authorized',?,?,?)`
  ).run(
    submissionId, req.params.id, payer_address.toLowerCase(),
    JSON.stringify(response_data), responseCommitment, salt,
    Number(authExpiry), signature, now()
  )

  res.json({
    submission_id: submissionId,
    auth_signature: signature,
    auth_expiry: authExpiry.toString(),
    response_commitment: responseCommitment,
    price_raw: price.toString(),
    contract_address: form.contract_address,
    chain_id: chainId,
    signer_address: SIGNER_ADDRESS,
  })
})

app.post('/api/submissions/:id/confirm', (req: Request, res: Response) => {
  const { tx_hash } = req.body
  if (!tx_hash) { res.status(400).json({ error: 'tx_hash required' }); return }

  const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
  if (!sub) { res.status(404).json({ error: 'Not found' }); return }

  db.prepare(
    `UPDATE submissions SET status='confirmed', tx_hash=?, confirmed_at=? WHERE id=?`
  ).run(tx_hash, now(), req.params.id)

  res.json({ ok: true })
})

app.get('/api/submissions/:id', (req: Request, res: Response) => {
  const sub = db.prepare(
    `SELECT id, form_id, payer_address, status, tx_hash, created_at, confirmed_at, response_commitment FROM submissions WHERE id = ?`
  ).get(req.params.id) as Record<string, unknown> | undefined

  if (!sub) { res.status(404).json({ error: 'Not found' }); return }
  res.json({ submission: sub })
})

app.get('/api/forms/:id/my-submission', (req: Request, res: Response) => {
  const { payer } = req.query
  if (!payer) { res.status(400).json({ error: 'payer query param required' }); return }

  const sub = db.prepare(
    `SELECT id, status, tx_hash, created_at, confirmed_at FROM submissions
     WHERE form_id = ? AND LOWER(payer_address) = LOWER(?) AND status = 'confirmed'`
  ).get(req.params.id, payer as string) as Record<string, unknown> | undefined

  res.json({ submission: sub || null })
})

// ---------------------------------------------------------------------------
// Routes: Creator dashboard
// ---------------------------------------------------------------------------

app.get('/api/creator-forms', (req: Request, res: Response) => {
  const { address } = req.query
  if (!address) { res.status(400).json({ error: 'address required' }); return }

  const forms = db.prepare(
    `SELECT id, title, payment_mode, price_usdc, status, contract_address, chain_id,
            goal_count, capacity, deadline_ts, recipients, splits, questions, created_at, published_at,
            description, confirmation_message, style_accent
     FROM forms WHERE LOWER(creator_address) = LOWER(?) AND status != 'deleted'
     ORDER BY created_at DESC`
  ).all(address as string) as Record<string, unknown>[]

  res.json({
    forms: forms.map(f => ({
      ...f,
      recipients: JSON.parse(f.recipients as string),
      splits: JSON.parse(f.splits as string),
      questions: JSON.parse(f.questions as string),
    }))
  })
})

// ---------------------------------------------------------------------------
// Routes: Free form submission (no payment required)
// ---------------------------------------------------------------------------

app.post('/api/forms/:id/submit-free', (req: Request, res: Response) => {
  const form = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
  if (!form) { res.status(404).json({ error: 'Form not found' }); return }
  if (form.status !== 'published') { res.status(400).json({ error: 'Form is not published' }); return }
  if (form.payment_mode !== 'free') { res.status(400).json({ error: 'This form requires payment — use start-submission instead' }); return }

  const { submitter_address, response_data } = req.body as { submitter_address?: string; response_data?: Record<string, unknown> }
  // For free forms, submitter_address is optional (anonymous submissions allowed)
  const addr = submitter_address ? submitter_address.toLowerCase() : `anon_${generateId()}`

  // One submission per address per form (only enforced for wallet-connected submitters)
  if (submitter_address) {
    const existing = db.prepare(
      `SELECT id FROM submissions WHERE form_id = ? AND LOWER(payer_address) = LOWER(?) AND status = 'confirmed'`
    ).get(req.params.id, submitter_address)
    if (existing) { res.status(409).json({ error: 'Already submitted' }); return }
  }

  const submissionId = `0x${generateId()}${generateId()}`
  const commitment = createHmac('sha256', generateId()).update(JSON.stringify(response_data ?? {})).digest('hex')

  try {
    db.prepare(
      `INSERT INTO submissions (id, form_id, payer_address, status, response_commitment, response_data, salt, created_at, confirmed_at)
       VALUES (?, ?, ?, 'confirmed', ?, ?, '', ?, ?)`
    ).run(submissionId, req.params.id, addr, commitment, JSON.stringify(response_data ?? {}), now(), now())
  } catch (err) {
    console.error('[submit-free] INSERT failed:', err)
    res.status(500).json({ error: 'Failed to store submission', detail: String(err) }); return
  }

  res.json({ submission_id: submissionId })
})

// ---------------------------------------------------------------------------
// Routes: Respondent dashboard
// ---------------------------------------------------------------------------

app.get('/api/respondent-submissions', (req: Request, res: Response) => {
  const { address } = req.query
  if (!address) { res.status(400).json({ error: 'address required' }); return }

  const subs = db.prepare(
    `SELECT s.id, s.form_id, s.payer_address, s.status, s.tx_hash, s.created_at, s.confirmed_at,
            f.title, f.payment_mode, f.price_usdc, f.contract_address, f.chain_id,
            f.goal_count, f.capacity, f.deadline_ts, f.recipients, f.splits
     FROM submissions s JOIN forms f ON s.form_id = f.id
     WHERE LOWER(s.payer_address) = LOWER(?) AND s.status = 'confirmed'
     ORDER BY s.created_at DESC`
  ).all(address as string) as Record<string, unknown>[]

  res.json({
    submissions: subs.map(s => ({
      ...s,
      recipients: JSON.parse(s.recipients as string),
      splits: JSON.parse(s.splits as string),
    }))
  })
})

// ---------------------------------------------------------------------------
// Routes: Seed demo data
// ---------------------------------------------------------------------------

app.post('/api/seed-demo', (_req: Request, res: Response) => {
  if (!DEMO_ESCROW_ADDRESS || !DEMO_INSTRUCTOR_ADDRESS) {
    res.status(500).json({ error: 'Demo addresses not configured in environment' }); return
  }

  const existing = db.prepare(`SELECT id FROM forms WHERE contract_address = ?`).get(DEMO_ESCROW_ADDRESS)
  if (existing) {
    res.json({ ok: true, already_seeded: true, form_id: (existing as Record<string, unknown>).id })
    return
  }

  const id = generateId()

  const questions = [
    { id: 'q1', type: 'short_text', label: 'Your full name', required: true },
    { id: 'q2', type: 'email', label: 'Email address', required: true, placeholder: 'you@example.com' },
    { id: 'q3', type: 'single_choice', label: 'How did you hear about this workshop?', required: false, options: ['Twitter', 'Friend referral', 'Newsletter', 'Other'] },
    { id: 'q4', type: 'yes_no', label: 'Have you completed any smart contract courses before?', required: false },
    { id: 'q5', type: 'long_text', label: 'What do you hope to learn from this workshop?', required: false, placeholder: 'Share your goals...' },
  ]

  const recipientsArr = [
    DEMO_INSTRUCTOR_ADDRESS,
    DEMO_INSTRUCTOR_ADDRESS,
    '0x0000000000000000000000000000000000000000',
    '0x0000000000000000000000000000000000000000',
    '0x0000000000000000000000000000000000000000',
  ]

  db.prepare(
    `INSERT INTO forms
     (id, creator_address, title, description, confirmation_message, payment_mode,
      price_usdc, capacity, goal_count, deadline_ts, recipients, splits, questions, status,
      contract_address, chain_id, created_at, published_at, style_accent)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'published',?,?,?,?,?)`
  ).run(
    id,
    DEMO_INSTRUCTOR_ADDRESS.toLowerCase(),
    'Arc Smart Contracts Workshop',
    'A 3-hour hands-on workshop covering Solidity fundamentals, Arc testnet deployment, and USDC payment flows. Includes live coding sessions and Q&A.',
    'You are registered! If 3 paid registrations arrive before the deadline, the workshop is on and proceeds split 70% to instructor and 30% to organizer. If not, claim your full registration payment back.',
    'goal_escrow',
    '0.10',
    0,
    3,
    1792713600, // 2026-10-23 00:00:00 UTC
    JSON.stringify(recipientsArr),
    JSON.stringify([7000, 3000, 0, 0, 0]),
    JSON.stringify(questions),
    DEMO_ESCROW_ADDRESS,
    ARC_CHAIN_ID,
    now(),
    now(),
    '#b45309'
  )

  res.json({ ok: true, form_id: id, contract_address: DEMO_ESCROW_ADDRESS })
})

// ---------------------------------------------------------------------------
// Routes: AI form generation (BYOK OpenRouter)
// ---------------------------------------------------------------------------

const AI_SYSTEM_PROMPT = `You are a form designer for PACTFORM — a platform where forms require USDC payment to submit.
Given a description, return a JSON object with this exact shape (no markdown, no extra keys):

{
  "title": "string",
  "description": "string (1-2 sentences shown to respondents)",
  "confirmation_message": "string (shown after successful registration)",
  "questions": [
    {
      "id": "q1",
      "type": "short_text|long_text|email|single_choice|multiple_choice|yes_no",
      "label": "string",
      "required": true|false,
      "placeholder": "string (optional)",
      "options": ["string"] (only for single_choice or multiple_choice)
    }
  ],
  "payment_mode": "collect_split|goal_escrow|free",
  "price_usdc": "string (e.g. '0.50', '10.00')",
  "goal_count": number (only meaningful for goal_escrow, else 0),
  "capacity": 0,
  "deadline_days": number (days from today; only for goal_escrow, else 0),
  "splits_equal": true,
  "style_accent": "#hex color that fits the form theme"
}

Rules:
- Generate 3-8 relevant questions.
- For bug bounties / grants / competitions: use goal_escrow, reasonable USD prize as price.
- For memberships / newsletters / communities: use collect_split.
- For events / workshops / courses: use goal_escrow with goal_count 5-20 and deadline_days 14-60.
- price_usdc should be realistic for the use case (e.g. $5-$50 for events, $100-$500 for bounties).
- deadline_days: 7-90 days depending on context.
- style_accent: pick a hex color that suits the form's theme.
- Output ONLY valid JSON. No prose, no markdown fences.`

app.post('/api/ai/generate-form', async (req: Request, res: Response) => {
  const { prompt, api_key } = req.body as { prompt?: string; api_key?: string }
  const openrouterKey = api_key || process.env.OPENROUTER_API_KEY

  if (!prompt) { res.status(400).json({ error: 'prompt required' }); return }
  if (!openrouterKey) { res.status(400).json({ error: 'OpenRouter API key required. Set OPENROUTER_API_KEY in .env or pass api_key in request.' }); return }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openrouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://pactform.app',
        'X-Title': 'PACTFORM',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 2048,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('[pactform] OpenRouter error', response.status, err)
      res.status(502).json({ error: `OpenRouter error (${response.status}): ${err.slice(0, 500)}` }); return
    }

    const data = await response.json() as { choices?: { message?: { content?: string } }[] }
    const content = data.choices?.[0]?.message?.content?.trim() ?? ''

    // Strip markdown code fences if the model added them
    const clean = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(clean) as Record<string, unknown>
    } catch {
      res.status(502).json({ error: `Model returned invalid JSON: ${clean.slice(0, 200)}` }); return
    }

    // Compute deadline_ts from deadline_days
    const deadlineDays = Number(parsed.deadline_days ?? 0)
    const deadlineTs = deadlineDays > 0
      ? Math.floor(Date.now() / 1000) + deadlineDays * 86400
      : 0

    res.json({ ...parsed, deadline_ts: deadlineTs })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get('/api/health', (_req, res) => res.json({ ok: true, signer: SIGNER_ADDRESS }))

// Serve Vite static build in production
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const distPath = path.join(__dirname, '..', 'dist')
if (existsSync(path.join(distPath, 'index.html'))) {
  app.use(express.static(distPath))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
  console.log(`[pactform] Serving static build from ${distPath}`)
} else {
  console.log('[pactform] No dist/ found — running in dev proxy mode')
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[pactform] Backend listening on port ${PORT}`)
})

export { SIGNER_ADDRESS }
