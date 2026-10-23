import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getDb, ensureSchema } from '../../_db.js'

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
    const { action } = (req.body ?? {}) as { action?: string }

    const newStatus = action === 'restore' ? 'published' : 'archived'
    await db.execute({ sql: `UPDATE forms SET status=? WHERE id=?`, args: [newStatus, id] })
    res.json({ ok: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[POST archive]', message)
    res.status(500).json({ error: message })
  }
}
