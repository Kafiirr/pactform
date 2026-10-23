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
    sql: `SELECT id, title, description, payment_mode, price_usdc, capacity, goal_count, deadline_ts,
                 recipients, splits, questions, status, contract_address, chain_id, version, style_accent,
                 created_at, published_at, confirmation_message, creator_address
          FROM forms WHERE LOWER(creator_address) = LOWER(?) ORDER BY created_at DESC`,
    args: [address],
  })).rows

  res.json({ forms: rows.map(r => parseForm(r as Record<string, unknown>)) })
}
