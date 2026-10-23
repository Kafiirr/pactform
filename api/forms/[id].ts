import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getDb, ensureSchema, parseForm } from '../_db.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }

  await ensureSchema()
  const db = getDb()
  const { id } = req.query as { id: string }

  if (req.method === 'GET') {
    const row = (await db.execute({ sql: 'SELECT * FROM forms WHERE id = ?', args: [id] })).rows[0]
    if (!row) { res.status(404).json({ error: 'Form not found' }); return }
    res.json({ form: parseForm(row as Record<string, unknown>) })
    return
  }

  if (req.method === 'PUT') {
    const row = (await db.execute({ sql: 'SELECT * FROM forms WHERE id = ?', args: [id] })).rows[0]
    if (!row) { res.status(404).json({ error: 'Not found' }); return }
    if (row.status === 'deleted') { res.status(400).json({ error: 'Cannot edit a deleted form' }); return }

    const body = req.body as Record<string, unknown>
    const isDraft = row.status === 'draft'

    await db.execute({
      sql: `UPDATE forms SET
              title=COALESCE(?,title), description=COALESCE(?,description),
              confirmation_message=COALESCE(?,confirmation_message),
              questions=COALESCE(?,questions), style_accent=COALESCE(?,style_accent),
              payment_mode=CASE WHEN ? THEN COALESCE(?,payment_mode) ELSE payment_mode END,
              price_usdc=CASE WHEN ? THEN COALESCE(?,price_usdc) ELSE price_usdc END,
              capacity=CASE WHEN ? THEN COALESCE(?,capacity) ELSE capacity END,
              goal_count=CASE WHEN ? THEN COALESCE(?,goal_count) ELSE goal_count END,
              deadline_ts=CASE WHEN ? THEN COALESCE(?,deadline_ts) ELSE deadline_ts END,
              recipients=CASE WHEN ? THEN COALESCE(?,recipients) ELSE recipients END,
              splits=CASE WHEN ? THEN COALESCE(?,splits) ELSE splits END
            WHERE id = ?`,
      args: [
        body.title ?? null, body.description ?? null, body.confirmation_message ?? null,
        body.questions ? JSON.stringify(body.questions) : null, body.style_accent ?? null,
        isDraft ? 1 : 0, body.payment_mode ?? null,
        isDraft ? 1 : 0, body.price_usdc ?? null,
        isDraft ? 1 : 0, body.capacity ?? null,
        isDraft ? 1 : 0, body.goal_count ?? null,
        isDraft ? 1 : 0, body.deadline_ts ?? null,
        isDraft ? 1 : 0, body.recipients ? JSON.stringify(body.recipients) : null,
        isDraft ? 1 : 0, body.splits ? JSON.stringify(body.splits) : null,
        id,
      ],
    })

    const updated = (await db.execute({ sql: 'SELECT * FROM forms WHERE id = ?', args: [id] })).rows[0]
    res.json({ form: parseForm(updated as Record<string, unknown>) })
    return
  }

  if (req.method === 'DELETE') {
    const row = (await db.execute({ sql: 'SELECT * FROM forms WHERE id = ?', args: [id] })).rows[0]
    if (!row) { res.status(404).json({ error: 'Not found' }); return }
    await db.execute({ sql: `DELETE FROM submissions WHERE form_id = ?`, args: [id] })
    await db.execute({ sql: `DELETE FROM forms WHERE id = ?`, args: [id] })
    res.json({ ok: true })
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
