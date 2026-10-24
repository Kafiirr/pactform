/**
 * Single Vercel serverless function — routes all /api/* requests internally.
 * Keeps the deployment under Hobby plan's 12-function limit.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  getDb, ensureSchema, generateId, now, parseUsdc, parseForm,
  signAuth, ARC_CHAIN_ID, SIGNER_ADDRESS,
} from './_db.js'
import { createHmac, randomBytes } from 'crypto'
import type { Hex } from 'viem'

// ---------------------------------------------------------------------------
// CORS helper
// ---------------------------------------------------------------------------
function cors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

// ---------------------------------------------------------------------------
// Body parser (Vercel catch-all functions may receive raw Buffer bodies)
// ---------------------------------------------------------------------------
function parseBody(req: VercelRequest): Record<string, unknown> {
  // Already parsed by Vercel runtime
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body as Record<string, unknown>
  }
  // Raw Buffer or string — parse manually
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body ?? '')
    return raw ? JSON.parse(raw) as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Route helpers
// ---------------------------------------------------------------------------
function getSegments(req: VercelRequest): string[] {
  // req.url is like /api/forms/abc123/publish?foo=bar
  const pathname = (req.url ?? '').split('?')[0]
  // strip leading /api/
  return pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean)
}

// ---------------------------------------------------------------------------
// Handler implementations
// ---------------------------------------------------------------------------

// GET /api/forms  —  list published
async function listPublishedForms(res: VercelResponse) {
  await ensureSchema()
  const db = getDb()
  const result = await db.execute(
    `SELECT id, title, description, payment_mode, price_usdc, capacity, goal_count, deadline_ts,
            recipients, splits, questions, status, contract_address, chain_id, version, style_accent,
            created_at, published_at, confirmation_message
     FROM forms WHERE status = 'published' ORDER BY published_at DESC`
  )
  res.json({ forms: result.rows.map(r => parseForm(r as Record<string, unknown>)) })
}

// POST /api/forms  — create draft
async function createForm(req: VercelRequest, res: VercelResponse) {
  await ensureSchema()
  const db = getDb()
  const {
    creator_address, title, description = '', confirmation_message = 'Thank you for registering!',
    payment_mode, price_usdc, capacity = 0, goal_count = 0, deadline_ts = 0,
    recipients, splits, questions = [], style_accent = '#b45309',
  } = parseBody(req)

  if (!creator_address || !title || !payment_mode) {
    res.status(400).json({ error: 'Missing required fields: creator_address, title, payment_mode' }); return
  }
  if (!['collect_split', 'goal_escrow', 'free'].includes(payment_mode as string)) {
    res.status(400).json({ error: 'Invalid payment_mode' }); return
  }
  const effectivePriceUsdc = price_usdc || '0'
  const id = generateId()
  await db.execute({
    sql: `INSERT INTO forms (id, creator_address, title, description, confirmation_message, payment_mode,
            price_usdc, capacity, goal_count, deadline_ts, recipients, splits, questions, status, created_at, style_accent)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?)`,
    args: [
      id, (creator_address as string).toLowerCase(), title as string, description as string,
      confirmation_message as string, payment_mode as string, effectivePriceUsdc as string,
      capacity as number, goal_count as number, deadline_ts as number,
      JSON.stringify(recipients ?? []), JSON.stringify(splits ?? []), JSON.stringify(questions),
      now(), style_accent as string,
    ],
  })
  const row = (await db.execute({ sql: 'SELECT * FROM forms WHERE id = ?', args: [id] })).rows[0]
  res.status(201).json({ form: parseForm(row as Record<string, unknown>) })
}

// GET /api/forms/:id
async function getForm(id: string, res: VercelResponse) {
  await ensureSchema()
  const db = getDb()
  const row = (await db.execute({ sql: 'SELECT * FROM forms WHERE id = ?', args: [id] })).rows[0]
  if (!row) { res.status(404).json({ error: 'Form not found' }); return }
  res.json({ form: parseForm(row as Record<string, unknown>) })
}

// PUT /api/forms/:id
async function updateForm(id: string, req: VercelRequest, res: VercelResponse) {
  await ensureSchema()
  const db = getDb()
  const row = (await db.execute({ sql: 'SELECT * FROM forms WHERE id = ?', args: [id] })).rows[0]
  if (!row) { res.status(404).json({ error: 'Not found' }); return }

  const body = parseBody(req)
  const isDraft = row.status === 'draft'
  const setClauses: string[] = []
  const args: unknown[] = []
  let idx = 1

  function maybeSet(col: string, value: unknown, draftOnly = false) {
    if (value === undefined || value === null) return
    if (draftOnly && !isDraft) return
    setClauses.push(`${col} = $${idx++}`)
    args.push(value)
  }

  maybeSet('title', body.title)
  maybeSet('description', body.description)
  maybeSet('confirmation_message', body.confirmation_message)
  maybeSet('style_accent', body.style_accent)
  maybeSet('questions', body.questions !== undefined ? JSON.stringify(body.questions) : undefined)
  maybeSet('payment_mode', body.payment_mode, true)
  maybeSet('price_usdc', body.price_usdc, true)
  maybeSet('capacity', body.capacity, true)
  maybeSet('goal_count', body.goal_count, true)
  maybeSet('deadline_ts', body.deadline_ts, true)
  maybeSet('recipients', body.recipients !== undefined ? JSON.stringify(body.recipients) : undefined, true)
  maybeSet('splits', body.splits !== undefined ? JSON.stringify(body.splits) : undefined, true)

  if (setClauses.length === 0) {
    const existing = (await db.execute({ sql: 'SELECT * FROM forms WHERE id = ?', args: [id] })).rows[0]
    res.json({ form: parseForm(existing as Record<string, unknown>) }); return
  }

  args.push(id)
  await db.execute({ sql: `UPDATE forms SET ${setClauses.join(', ')} WHERE id = $${idx}`, args })
  const updated = (await db.execute({ sql: 'SELECT * FROM forms WHERE id = ?', args: [id] })).rows[0]
  res.json({ form: parseForm(updated as Record<string, unknown>) })
}

// DELETE /api/forms/:id
async function deleteForm(id: string, res: VercelResponse) {
  await ensureSchema()
  const db = getDb()
  const row = (await db.execute({ sql: 'SELECT * FROM forms WHERE id = ?', args: [id] })).rows[0]
  if (!row) { res.status(404).json({ error: 'Not found' }); return }
  await db.execute({ sql: `DELETE FROM submissions WHERE form_id = ?`, args: [id] })
  await db.execute({ sql: `DELETE FROM forms WHERE id = ?`, args: [id] })
  res.json({ ok: true })
}

// POST /api/forms/:id/publish
async function publishForm(id: string, req: VercelRequest, res: VercelResponse) {
  await ensureSchema()
  const db = getDb()
  const { contract_address = null, chain_id = 5042 } = (parseBody(req))
  const row = (await db.execute({ sql: 'SELECT * FROM forms WHERE id = ?', args: [id] })).rows[0]
  if (!row) { res.status(404).json({ error: 'Form not found' }); return }
  if (row.payment_mode !== 'free' && !contract_address) {
    res.status(400).json({ error: 'contract_address required for paid forms' }); return
  }
  await db.execute({
    sql: `UPDATE forms SET status='published', contract_address=?, chain_id=?, published_at=? WHERE id=?`,
    args: [contract_address as string | null, chain_id as number, now(), id],
  })
  res.json({ ok: true })
}

// POST /api/forms/:id/archive
async function archiveForm(id: string, req: VercelRequest, res: VercelResponse) {
  await ensureSchema()
  const db = getDb()
  const { action } = (parseBody(req) as { action?: string })
  const newStatus = action === 'restore' ? 'published' : 'archived'
  await db.execute({ sql: `UPDATE forms SET status=? WHERE id=?`, args: [newStatus, id] })
  res.json({ ok: true })
}

// POST /api/forms/:id/start-submission
async function startSubmission(id: string, req: VercelRequest, res: VercelResponse) {
  try {
  await ensureSchema()
  const db = getDb()
  const { payer_address, answers } = parseBody(req) as { payer_address: string; answers: Record<string, unknown> }
  if (!payer_address || !answers) { res.status(400).json({ error: 'payer_address and answers required' }); return }

  const row = (await db.execute({ sql: 'SELECT * FROM forms WHERE id = ?', args: [id] })).rows[0]
  if (!row) { res.status(404).json({ error: 'Form not found' }); return }
  if (row.status !== 'published') { res.status(400).json({ error: 'Form is not published' }); return }
  // Free forms (no contract) use submit-free endpoint instead
  if (!row.contract_address) { res.status(400).json({ error: 'Free forms use /submit-free endpoint' }); return }

  const chainId = (row.chain_id as number) || ARC_CHAIN_ID
  const priceRaw = parseUsdc(row.price_usdc as string)
  const payerLower = payer_address.toLowerCase()

  const existing = (await db.execute({
    sql: `SELECT * FROM submissions WHERE form_id=? AND payer_address=? AND status='authorized' ORDER BY created_at DESC LIMIT 1`,
    args: [id, payerLower],
  })).rows[0]

  if (existing) {
    const expiryTs = existing.auth_expiry as number
    if (expiryTs > now() + 120) {
      res.json({
        submission_id: existing.id, response_commitment: existing.response_commitment,
        auth_signature: existing.auth_signature, auth_expiry: existing.auth_expiry,
        contract_address: row.contract_address, chain_id: chainId, price_raw: priceRaw.toString(),
      }); return
    }
    const newExpiry = BigInt(now() + 1800)
    const newSig = await signAuth(
      row.contract_address as string, chainId, payer_address,
      existing.id as Hex, existing.response_commitment as Hex, priceRaw, newExpiry
    )
    await db.execute({ sql: `UPDATE submissions SET auth_expiry=?, auth_signature=? WHERE id=?`, args: [Number(newExpiry), newSig, existing.id] })
    res.json({
      submission_id: existing.id, response_commitment: existing.response_commitment,
      auth_signature: newSig, auth_expiry: Number(newExpiry),
      contract_address: row.contract_address, chain_id: chainId, price_raw: priceRaw.toString(),
    }); return
  }

  const salt = randomBytes(32).toString('hex')
  const responseStr = JSON.stringify(answers)
  const commitment = ('0x' + createHmac('sha256', salt).update(responseStr).digest('hex')) as Hex
  const submissionId = ('0x' + generateId() + generateId().slice(0, 32)) as Hex
  const expiry = BigInt(now() + 1800)
  const sig = await signAuth(row.contract_address as string, chainId, payer_address, submissionId, commitment, priceRaw, expiry)

  await db.execute({
    sql: `INSERT INTO submissions (id, form_id, payer_address, response_data, response_commitment, salt,
            status, auth_expiry, auth_signature, created_at)
          VALUES (?,?,?,?,?,?,'authorized',?,?,?)`,
    args: [submissionId, id, payerLower, responseStr, commitment, salt, Number(expiry), sig, now()],
  })
  res.json({
    submission_id: submissionId, response_commitment: commitment, auth_signature: sig,
    auth_expiry: Number(expiry), contract_address: row.contract_address, chain_id: chainId, price_raw: priceRaw.toString(),
  })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[start-submission error]', msg)
    res.status(500).json({ error: msg })
  }
}

// POST /api/forms/:id/confirm-submission
async function confirmSubmission(id: string, req: VercelRequest, res: VercelResponse) {
  await ensureSchema()
  const db = getDb()
  const { submission_id, tx_hash } = parseBody(req) as { submission_id: string; tx_hash: string }
  if (!submission_id || !tx_hash) { res.status(400).json({ error: 'submission_id and tx_hash required' }); return }
  await db.execute({
    sql: `UPDATE submissions SET status='confirmed', tx_hash=?, confirmed_at=? WHERE id=? AND form_id=?`,
    args: [tx_hash, now(), submission_id, id],
  })
  res.json({ ok: true })
}

// POST /api/forms/:id/submit-free
async function submitFree(id: string, req: VercelRequest, res: VercelResponse) {
  await ensureSchema()
  const db = getDb()
  const { submitter_address, answers } = parseBody(req) as { submitter_address?: string; answers: Record<string, unknown> }
  const row = (await db.execute({ sql: 'SELECT * FROM forms WHERE id = ?', args: [id] })).rows[0]
  if (!row) { res.status(404).json({ error: 'Form not found' }); return }
  // Allow free forms AND effectively-free paid forms (price = 0, no contract)
  const isFreeForm = row.payment_mode === 'free' || !row.contract_address ||
    parseFloat(String(row.price_usdc ?? '0')) === 0
  if (!isFreeForm) { res.status(400).json({ error: 'Not a free form' }); return }

  const addr = submitter_address || null

  // Duplicate check: one submission per wallet address (skip for anonymous)
  if (addr) {
    const existing = (await db.execute({
      sql: `SELECT id FROM submissions WHERE form_id=? AND payer_address=? LIMIT 1`,
      args: [id, addr],
    })).rows[0]
    if (existing) {
      res.status(409).json({ error: 'Already submitted', submission_id: existing.id })
      return
    }
  }

  const salt = randomBytes(32).toString('hex')
  const responseStr = JSON.stringify(answers ?? {})
  const commitment = '0x' + createHmac('sha256', salt).update(responseStr).digest('hex')
  const subId = generateId()
  const payer = addr || `anon_${generateId().slice(0, 8)}`
  await db.execute({
    sql: `INSERT INTO submissions (id, form_id, payer_address, response_data, response_commitment, salt,
            status, confirmed_at, created_at)
          VALUES (?,?,?,?,?,?,'confirmed',?,?)`,
    args: [subId, id, payer, responseStr, commitment, salt, now(), now()],
  })
  res.json({ ok: true, submission_id: subId })
}

// GET /api/forms/:id/responses
async function getResponses(id: string, res: VercelResponse) {
  await ensureSchema()
  const db = getDb()
  const rows = (await db.execute({
    sql: `SELECT id, payer_address, status, tx_hash, created_at, confirmed_at, response_data
          FROM submissions WHERE form_id=? ORDER BY created_at DESC`,
    args: [id],
  })).rows
  const responses = rows.map(r => ({
    ...r,
    response_data: (() => { try { return JSON.parse(r.response_data as string) } catch { return {} } })(),
  }))
  res.json({ responses })
}

// GET /api/forms/creator/:address
async function getCreatorForms(address: string, res: VercelResponse) {
  await ensureSchema()
  const db = getDb()
  const rows = (await db.execute({
    sql: `SELECT id, title, description, payment_mode, price_usdc, capacity, goal_count, deadline_ts,
               recipients, splits, questions, status, contract_address, chain_id, version, style_accent,
               created_at, published_at, confirmation_message, creator_address
          FROM forms WHERE LOWER(creator_address) = LOWER(?) ORDER BY created_at DESC`,
    args: [address],
  })).rows
  res.json({ forms: rows.map(r => parseForm(r as Record<string, unknown>)) })
}

// GET /api/forms/respondent/:address
async function getRespondentForms(address: string, res: VercelResponse) {
  await ensureSchema()
  const db = getDb()
  const rows = (await db.execute({
    sql: `SELECT f.id, f.title, f.description, f.payment_mode, f.price_usdc, f.capacity, f.goal_count,
               f.deadline_ts, f.recipients, f.splits, f.questions, f.status, f.contract_address,
               f.chain_id, f.version, f.style_accent, f.created_at, f.published_at, f.confirmation_message,
               s.id as submission_id, s.status as submission_status, s.tx_hash, s.confirmed_at, s.payer_address
          FROM submissions s JOIN forms f ON s.form_id = f.id
          WHERE LOWER(s.payer_address) = LOWER(?) AND s.status = 'confirmed'
          ORDER BY s.confirmed_at DESC`,
    args: [address],
  })).rows
  const forms = rows.map(r => ({
    ...parseForm(r as Record<string, unknown>),
    user_submission: { id: r.submission_id, status: r.submission_status, tx_hash: r.tx_hash, confirmed_at: r.confirmed_at, payer_address: r.payer_address },
  }))
  res.json({ forms })
}

// POST /api/seed-demo
async function seedDemo(res: VercelResponse) {
  const DEMO_ESCROW_ADDRESS = process.env.VITE_ESCROW_ADDRESS || ''
  const DEMO_INSTRUCTOR_ADDRESS = process.env.VITE_DEMO_INSTRUCTOR_ADDRESS || ''
  if (!DEMO_ESCROW_ADDRESS || !DEMO_INSTRUCTOR_ADDRESS) {
    res.status(500).json({ error: 'Demo addresses not configured' }); return
  }
  await ensureSchema()
  const db = getDb()
  const existing = (await db.execute({ sql: `SELECT id FROM forms WHERE contract_address = ?`, args: [DEMO_ESCROW_ADDRESS] })).rows[0]
  if (existing) { res.json({ ok: true, already_seeded: true, form_id: existing.id }); return }

  const id = generateId()
  const deadlineTs = now() + 90 * 24 * 60 * 60
  const questions = JSON.stringify([
    { id: 'q1', type: 'short_text', label: 'Your full name', required: true },
    { id: 'q2', type: 'email', label: 'Email address', required: true, placeholder: 'you@example.com' },
    { id: 'q3', type: 'single_choice', label: 'How did you hear about this workshop?', required: false, options: ['Twitter', 'Friend referral', 'Newsletter', 'Other'] },
    { id: 'q4', type: 'yes_no', label: 'Have you completed any smart contract courses before?', required: false },
    { id: 'q5', type: 'long_text', label: 'What do you hope to learn from this workshop?', required: false, placeholder: 'Share your goals...' },
  ])
  const recipients = JSON.stringify([DEMO_INSTRUCTOR_ADDRESS, DEMO_INSTRUCTOR_ADDRESS, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000'])
  const splits = JSON.stringify([7000, 3000, 0, 0, 0])

  await db.execute({
    sql: `INSERT INTO forms (id, creator_address, title, description, confirmation_message, payment_mode, price_usdc, capacity, goal_count, deadline_ts, recipients, splits, questions, status, contract_address, chain_id, created_at, published_at, style_accent)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'published',?,?,?,?,?)`,
    args: [
      id, DEMO_INSTRUCTOR_ADDRESS.toLowerCase(),
      'Arc Smart Contracts Workshop',
      'A 3-hour hands-on workshop covering Solidity fundamentals, Arc testnet deployment, and USDC payment flows.',
      'You are registered! If 3 paid registrations arrive before the deadline, the workshop is on and proceeds split 70/30. If not, claim your full refund.',
      'goal_escrow', '0.10', 0, 3, deadlineTs,
      recipients, splits, questions,
      DEMO_ESCROW_ADDRESS, ARC_CHAIN_ID, now(), now(), '#b45309',
    ],
  })
  res.json({ ok: true, form_id: id, contract_address: DEMO_ESCROW_ADDRESS })
}

// POST /api/ai/generate-form
async function generateForm(req: VercelRequest, res: VercelResponse) {
  try {
    const { prompt, apiKey } = parseBody(req) as { prompt: string; apiKey?: string }
    const key = apiKey || process.env.OPENROUTER_API_KEY
    if (!key) { res.status(400).json({ error: 'No OpenRouter API key provided. Add your key in the AI panel or set OPENROUTER_API_KEY in your environment.' }); return }
    if (!prompt) { res.status(400).json({ error: 'prompt required' }); return }

    const systemPrompt = `You are a form designer. Given a description, output a JSON object with:
{"title":string,"description":string,"confirmation_message":string,"payment_mode":"collect_split"|"goal_escrow"|"free","price_usdc":string,"goal_count":number,"capacity":number,"deadline_ts":number,"questions":Array<{"id":string,"label":string,"type":"short_text"|"long_text"|"email"|"number"|"yes_no"|"single_choice"|"multiple_choice","required":boolean,"options"?:string[]}>}
Output only the JSON, no markdown fences, no explanation. Use type "short_text" for short answers, "long_text" for paragraphs, "single_choice" for dropdowns/radio, "multiple_choice" for checkboxes, "yes_no" for boolean.`

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'google/gemini-2.5-flash', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }] }),
    })
    if (!response.ok) {
      const errText = await response.text()
      res.status(500).json({ error: `OpenRouter error ${response.status}: ${errText}` }); return
    }
    const data = await response.json() as { choices: { message: { content: string } }[] }
    const content = data.choices?.[0]?.message?.content?.trim() || ''
    try {
      const json = JSON.parse(content.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim())
      res.json({ form: json })
    } catch {
      res.status(500).json({ error: 'Failed to parse AI response', raw: content.slice(0, 500) })
    }
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || 'AI generation failed' })
  }
}

// ---------------------------------------------------------------------------
// Main router
// ---------------------------------------------------------------------------
export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res)
  if (req.method === 'OPTIONS') { res.status(204).end(); return }

  const segments = getSegments(req)
  const method = req.method ?? 'GET'

  try {
    // GET /api/health
    if (segments[0] === 'health') {
      res.json({ ok: true, signer: SIGNER_ADDRESS }); return
    }

    // GET /api/debug/form/:id — raw DB row (temp debugging)
    if (segments[0] === 'debug' && segments[1] === 'form' && segments[2]) {
      await ensureSchema()
      const db = getDb()
      const row = (await db.execute({ sql: 'SELECT id, title, questions, status FROM forms WHERE id = ?', args: [segments[2]] })).rows[0]
      if (!row) { res.status(404).json({ error: 'not found' }); return }
      res.json({ raw_questions: row.questions, type_of: typeof row.questions, parsed: parseForm(row as Record<string, unknown>).questions }); return
    }

    // POST /api/seed-demo
    if (segments[0] === 'seed-demo') {
      await seedDemo(res); return
    }

    // POST /api/ai/generate-form
    if (segments[0] === 'ai' && segments[1] === 'generate-form') {
      await generateForm(req, res); return
    }

    // /api/forms/creator/:address
    if (segments[0] === 'forms' && segments[1] === 'creator' && segments[2]) {
      await getCreatorForms(segments[2], res); return
    }

    // /api/forms/respondent/:address
    if (segments[0] === 'forms' && segments[1] === 'respondent' && segments[2]) {
      await getRespondentForms(segments[2], res); return
    }

    // /api/forms  (no id)
    if (segments[0] === 'forms' && !segments[1]) {
      if (method === 'GET') { await listPublishedForms(res); return }
      if (method === 'POST') { await createForm(req, res); return }
      res.status(405).json({ error: 'Method not allowed' }); return
    }

    // /api/forms/:id/...
    if (segments[0] === 'forms' && segments[1]) {
      const id = segments[1]
      const sub = segments[2]

      if (sub === 'publish'            && method === 'POST') { await publishForm(id, req, res); return }
      if (sub === 'archive'            && method === 'POST') { await archiveForm(id, req, res); return }
      if (sub === 'start-submission'   && method === 'POST') { await startSubmission(id, req, res); return }
      if (sub === 'confirm-submission' && method === 'POST') { await confirmSubmission(id, req, res); return }
      if (sub === 'submit-free'        && method === 'POST') { await submitFree(id, req, res); return }
      if (sub === 'responses'          && method === 'GET')  { await getResponses(id, res); return }

      // /api/forms/:id  CRUD
      if (!sub) {
        if (method === 'GET')    { await getForm(id, res); return }
        if (method === 'PUT')    { await updateForm(id, req, res); return }
        if (method === 'DELETE') { await deleteForm(id, res); return }
      }
      res.status(405).json({ error: 'Method not allowed' }); return
    }

    res.status(404).json({ error: 'Not found' })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[api/index]', segments.join('/'), message)
    res.status(500).json({ error: message })
  }
}
