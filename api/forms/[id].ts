import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getDb, ensureSchema, parseForm } from '../_db.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }

  try {
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

      const body = req.body as Record<string, unknown>
      const isDraft = row.status === 'draft'

      // Build SET clause dynamically — only include provided fields
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
      // Payment fields — only editable on drafts
      maybeSet('payment_mode', body.payment_mode, true)
      maybeSet('price_usdc', body.price_usdc, true)
      maybeSet('capacity', body.capacity, true)
      maybeSet('goal_count', body.goal_count, true)
      maybeSet('deadline_ts', body.deadline_ts, true)
      maybeSet('recipients', body.recipients !== undefined ? JSON.stringify(body.recipients) : undefined, true)
      maybeSet('splits', body.splits !== undefined ? JSON.stringify(body.splits) : undefined, true)

      if (setClauses.length === 0) {
        const existing = (await db.execute({ sql: 'SELECT * FROM forms WHERE id = ?', args: [id] })).rows[0]
        res.json({ form: parseForm(existing as Record<string, unknown>) })
        return
      }

      args.push(id) // for WHERE id = $N
      await db.execute({ sql: `UPDATE forms SET ${setClauses.join(', ')} WHERE id = $${idx}`, args })

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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/forms/:id]', message)
    res.status(500).json({ error: message })
  }
}
