import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getDb, ensureSchema } from '../../_db.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return }

  await ensureSchema()
  const db = getDb()
  const { id } = req.query as { id: string }

  const rows = (await db.execute({
    sql: `SELECT id, payer_address, status, tx_hash, created_at, confirmed_at, response_data
          FROM submissions WHERE form_id=? ORDER BY created_at DESC`,
    args: [id],
  })).rows

  const responses = rows.map(r => ({
    ...r,
    response_data: (() => {
      try { return JSON.parse(r.response_data as string) } catch { return {} }
    })(),
  }))

  res.json({ responses })
}
