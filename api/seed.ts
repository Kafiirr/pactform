import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getDb, ensureSchema, generateId, now, ARC_CHAIN_ID } from './_db.js'

const DEMO_ESCROW_ADDRESS = process.env.VITE_ESCROW_ADDRESS || ''
const DEMO_INSTRUCTOR_ADDRESS = process.env.VITE_DEMO_INSTRUCTOR_ADDRESS || ''

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  try {
    if (!DEMO_ESCROW_ADDRESS || !DEMO_INSTRUCTOR_ADDRESS) {
      res.status(500).json({ error: 'Demo addresses not configured (VITE_ESCROW_ADDRESS, VITE_DEMO_INSTRUCTOR_ADDRESS)' })
      return
    }

    await ensureSchema()
    const db = getDb()

    // Idempotent — if demo already exists return it
    const existing = (await db.execute({
      sql: `SELECT id FROM forms WHERE contract_address = ?`,
      args: [DEMO_ESCROW_ADDRESS],
    })).rows[0]

    if (existing) {
      res.json({ ok: true, already_seeded: true, form_id: existing.id })
      return
    }

    const id = generateId()
    const deadlineTs = now() + 90 * 24 * 60 * 60 // 90 days from now

    const questions = JSON.stringify([
      { id: 'q1', type: 'short_text',    label: 'Your full name',                                          required: true  },
      { id: 'q2', type: 'email',         label: 'Email address',                                           required: true, placeholder: 'you@example.com' },
      { id: 'q3', type: 'single_choice', label: 'How did you hear about this workshop?',                   required: false, options: ['Twitter', 'Friend referral', 'Newsletter', 'Other'] },
      { id: 'q4', type: 'yes_no',        label: 'Have you completed any smart contract courses before?',   required: false },
      { id: 'q5', type: 'long_text',     label: 'What do you hope to learn from this workshop?',           required: false, placeholder: 'Share your goals...' },
    ])

    const recipients = JSON.stringify([
      DEMO_INSTRUCTOR_ADDRESS,
      DEMO_INSTRUCTOR_ADDRESS,
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
    ])

    const splits = JSON.stringify([7000, 3000, 0, 0, 0])

    await db.execute({
      sql: `INSERT INTO forms
              (id, creator_address, title, description, confirmation_message,
               payment_mode, price_usdc, capacity, goal_count, deadline_ts,
               recipients, splits, questions, status, contract_address, chain_id,
               created_at, published_at, style_accent)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'published',?,?,?,?,?)`,
      args: [
        id,
        DEMO_INSTRUCTOR_ADDRESS.toLowerCase(),
        'Arc Smart Contracts Workshop',
        'A 3-hour hands-on workshop covering Solidity fundamentals, Arc testnet deployment, and USDC payment flows. Includes live coding sessions and Q&A.',
        'You are registered! If 3 paid registrations arrive before the deadline, the workshop is on and proceeds split 70% to instructor and 30% to organizer. If not, you can claim your full registration fee back.',
        'goal_escrow',
        '0.10',
        0,
        3,
        deadlineTs,
        recipients,
        splits,
        questions,
        DEMO_ESCROW_ADDRESS,
        ARC_CHAIN_ID,
        now(),
        now(),
        '#b45309',
      ],
    })

    res.json({ ok: true, form_id: id, contract_address: DEMO_ESCROW_ADDRESS })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[POST seed]', message)
    res.status(500).json({ error: message })
  }
}
