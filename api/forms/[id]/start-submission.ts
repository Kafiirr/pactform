import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getDb, ensureSchema, generateId, now, parseUsdc, signAuth, ARC_CHAIN_ID } from '../../_db.js'
import { createHmac, randomBytes } from 'crypto'
import type { Hex } from 'viem'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  try {
  await ensureSchema()
  const db = getDb()
  const { id } = req.query as { id: string }
  const { payer_address, answers } = req.body as { payer_address: string; answers: Record<string, unknown> }

  if (!payer_address || !answers) { res.status(400).json({ error: 'payer_address and answers required' }); return }

  const row = (await db.execute({ sql: 'SELECT * FROM forms WHERE id = ?', args: [id] })).rows[0]
  if (!row) { res.status(404).json({ error: 'Form not found' }); return }
  if (row.status !== 'published') { res.status(400).json({ error: 'Form is not published' }); return }
  if (!row.contract_address) { res.status(400).json({ error: 'Form has no contract' }); return }

  const chainId = (row.chain_id as number) || ARC_CHAIN_ID
  const priceRaw = parseUsdc(row.price_usdc as string)
  const payerLower = payer_address.toLowerCase()

  // Idempotency: reuse existing authorized submission
  const existing = (await db.execute({
    sql: `SELECT * FROM submissions WHERE form_id=? AND payer_address=? AND status='authorized' ORDER BY created_at DESC LIMIT 1`,
    args: [id, payerLower],
  })).rows[0]

  if (existing) {
    const expiryTs = existing.auth_expiry as number
    const bufferSecs = 120
    if (expiryTs > now() + bufferSecs) {
      res.json({
        submission_id: existing.id,
        response_commitment: existing.response_commitment,
        auth_signature: existing.auth_signature,
        auth_expiry: existing.auth_expiry,
        contract_address: row.contract_address,
        chain_id: chainId,
        price_raw: priceRaw.toString(),
      })
      return
    }
    // Expired — re-sign same submissionId + commitment with new expiry
    const newExpiry = BigInt(now() + 1800)
    const newSig = await signAuth(
      row.contract_address as string, chainId, payer_address,
      existing.id as Hex, existing.response_commitment as Hex,
      priceRaw, newExpiry
    )
    await db.execute({
      sql: `UPDATE submissions SET auth_expiry=?, auth_signature=? WHERE id=?`,
      args: [Number(newExpiry), newSig, existing.id],
    })
    res.json({
      submission_id: existing.id,
      response_commitment: existing.response_commitment,
      auth_signature: newSig,
      auth_expiry: Number(newExpiry),
      contract_address: row.contract_address,
      chain_id: chainId,
      price_raw: priceRaw.toString(),
    })
    return
  }

  // New submission
  const salt = randomBytes(32).toString('hex')
  const responseStr = JSON.stringify(answers)
  const commitment = '0x' + createHmac('sha256', salt).update(responseStr).digest('hex') as Hex
  const submissionId = ('0x' + generateId() + generateId().slice(0, 32)) as Hex
  const expiry = BigInt(now() + 1800)
  const sig = await signAuth(
    row.contract_address as string, chainId, payer_address,
    submissionId, commitment, priceRaw, expiry
  )

  await db.execute({
    sql: `INSERT INTO submissions (id, form_id, payer_address, response_data, response_commitment, salt,
            status, auth_expiry, auth_signature, created_at)
          VALUES (?,?,?,?,?,?,'authorized',?,?,?)`,
    args: [submissionId, id, payerLower, responseStr, commitment, salt, Number(expiry), sig, now()],
  })

  res.json({
    submission_id: submissionId,
    response_commitment: commitment,
    auth_signature: sig,
    auth_expiry: Number(expiry),
    contract_address: row.contract_address,
    chain_id: chainId,
    price_raw: priceRaw.toString(),
  })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[POST start-submission]', message)
    res.status(500).json({ error: message })
  }
}
