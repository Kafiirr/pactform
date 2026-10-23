import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getDb, ensureSchema, now } from '../../_db.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  await ensureSchema()
  const db = getDb()
  const { id } = req.query as { id: string }
  const { submission_id, tx_hash } = req.body as { submission_id: string; tx_hash: string }

  if (!submission_id || !tx_hash) { res.status(400).json({ error: 'submission_id and tx_hash required' }); return }

  await db.execute({
    sql: `UPDATE submissions SET status='confirmed', tx_hash=?, confirmed_at=? WHERE id=? AND form_id=?`,
    args: [tx_hash, now(), submission_id, id],
  })
  res.json({ ok: true })
}
