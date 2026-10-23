import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getDb, ensureSchema, parseForm } from '../../_db.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return }

  await ensureSchema()
  const db = getDb()
  const { address } = req.query as { address: string }

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
    user_submission: {
      id: r.submission_id,
      status: r.submission_status,
      tx_hash: r.tx_hash,
      confirmed_at: r.confirmed_at,
      payer_address: r.payer_address,
    },
  }))

  res.json({ forms })
}
