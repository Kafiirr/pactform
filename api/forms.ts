import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getDb, ensureSchema, generateId, now, parseForm } from './_db.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }

  try {
    await ensureSchema()
    const db = getDb()

    if (req.method === 'GET') {
      const result = await db.execute(
        `SELECT id, title, description, payment_mode, price_usdc, capacity, goal_count, deadline_ts,
                recipients, splits, questions, status, contract_address, chain_id, version, style_accent,
                created_at, published_at, confirmation_message
         FROM forms WHERE status = 'published' ORDER BY published_at DESC`
      )
      const forms = result.rows.map(r => parseForm(r as Record<string, unknown>))
      res.json({ forms })
      return
    }

    if (req.method === 'POST') {
      const {
        creator_address, title, description = '', confirmation_message = 'Thank you for registering!',
        payment_mode, price_usdc, capacity = 0, goal_count = 0, deadline_ts = 0,
        recipients, splits, questions = [], style_accent = '#b45309',
      } = req.body as Record<string, unknown>

      if (!creator_address || !title || !payment_mode) {
        res.status(400).json({ error: 'Missing required fields: creator_address, title, payment_mode' }); return
      }
      if (!['collect_split', 'goal_escrow', 'free'].includes(payment_mode as string)) {
        res.status(400).json({ error: 'Invalid payment_mode' }); return
      }
      // price_usdc defaults to '0' for free forms
      const effectivePriceUsdc = price_usdc || '0'

      const id = generateId()
      await db.execute({
        sql: `INSERT INTO forms (id, creator_address, title, description, confirmation_message, payment_mode,
                price_usdc, capacity, goal_count, deadline_ts, recipients, splits, questions, status, created_at, style_accent)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?)`,
        args: [
          id, (creator_address as string).toLowerCase(), title as string, description as string,
          confirmation_message as string, payment_mode as string, effectivePriceUsdc as string,
          capacity as number, goal_count as number, deadline_ts as number,
          JSON.stringify(recipients || []), JSON.stringify(splits || []), JSON.stringify(questions),
          now(), style_accent as string,
        ],
      })

      const row = (await db.execute({ sql: 'SELECT * FROM forms WHERE id = ?', args: [id] })).rows[0]
      res.status(201).json({ form: parseForm(row as Record<string, unknown>) })
      return
    }

    res.status(405).json({ error: 'Method not allowed' })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/forms]', message)
    res.status(500).json({ error: message })
  }
}
