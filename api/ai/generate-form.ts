import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const { prompt, apiKey } = req.body as { prompt: string; apiKey?: string }
  const key = apiKey || process.env.OPENROUTER_API_KEY
  if (!key) { res.status(400).json({ error: 'No OpenRouter API key' }); return }
  if (!prompt) { res.status(400).json({ error: 'prompt required' }); return }

  const systemPrompt = `You are a form designer. Given a description, output a JSON object with:
{
  "title": string,
  "description": string,
  "confirmation_message": string,
  "questions": Array<{
    "id": string (snake_case),
    "label": string,
    "type": "text"|"textarea"|"email"|"number"|"select"|"multiselect"|"checkbox",
    "required": boolean,
    "options"?: string[]
  }>
}
Output only the JSON, no markdown, no explanation.`

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    res.status(500).json({ error: `OpenRouter error: ${err}` }); return
  }

  const data = await response.json() as { choices: { message: { content: string } }[] }
  const content = data.choices?.[0]?.message?.content?.trim() || ''

  try {
    const json = JSON.parse(content.replace(/^```json\n?/, '').replace(/\n?```$/, ''))
    res.json({ form: json })
  } catch {
    res.status(500).json({ error: 'Failed to parse AI response', raw: content })
  }
}
