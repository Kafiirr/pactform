import type { VercelRequest, VercelResponse } from '@vercel/node'
import { SIGNER_ADDRESS } from './_db.js'

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.json({ ok: true, signer: SIGNER_ADDRESS })
}
