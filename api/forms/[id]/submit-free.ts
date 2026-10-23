import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getDb, ensureSchema, generateId, now } from '../../_db.js'
import { createHmac, randomBytes } from 'crypto'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  await ensureSchema()
  const db = getDb()
  const { id } = req.query as { id: string }
  const { submitter_address, answers } = req.body as { submitter_address?: string; answers: Record<string, unknown> }

  const row = (await db.execute({ sql: 'SELECT * FROM forms WHERE id = ?', args: [id] })).rows[0]
  if (!row) { res.status(404).json({ error: 'Form not found' }); return }
  if (row.payment_mode !== 'free') { res.status(400).json({ error: 'Not a free form' }); return }

  const salt = randomBytes(32).toString('hex')
  const responseStr = JSON.stringify(answers || {})
  const commitment = '0x' + createHmac('sha256', salt).update(responseStr).digest('hex')
  const subId = generateId()
  const addr = submitter_address || `anon_${generateId().slice(0, 8)}`

  await db.execute({
    sql: `INSERT INTO submissions (id, form_id, payer_address, response_data, response_commitment, salt,
            status, confirmed_at, created_at)
          VALUES (?,?,?,?,?,?,'confirmed',?,?)`,
    args: [subId, id, addr, responseStr, commitment, salt, now(), now()],
  })

  res.json({ ok: true, submission_id: subId })
}
