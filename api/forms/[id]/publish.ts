import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getDb, ensureSchema, now } from '../../_db.js'

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
    const { contract_address = null, chain_id = 5042 } = (req.body ?? {}) as Record<string, unknown>

    const row = (await db.execute({ sql: 'SELECT * FROM forms WHERE id = ?', args: [id] })).rows[0]
    if (!row) { res.status(404).json({ error: 'Form not found' }); return }

    // Paid forms require a contract address
    if (row.payment_mode !== 'free' && !contract_address) {
      res.status(400).json({ error: 'contract_address required for paid forms' }); return
    }

    await db.execute({
      sql: `UPDATE forms SET status='published', contract_address=?, chain_id=?, published_at=? WHERE id=?`,
      args: [contract_address as string | null, chain_id as number, now(), id],
    })

    res.json({ ok: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/forms/:id/publish]', message)
    res.status(500).json({ error: message })
  }
}
