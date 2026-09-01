// Reads a receipt photo via Claude's vision and extracts structured fields
// for the transaction form to prefill. Always a suggestion, never applied
// without the user reviewing it - OCR on a crumpled gas station receipt is
// not going to be perfect.

const EXTRACTION_PROMPT = `You are extracting structured data from a photo of a purchase receipt or invoice for small-business bookkeeping. Return ONLY a raw JSON object, no markdown fences, no explanation, with exactly these fields:

{
  "date": "YYYY-MM-DD or null if not legible",
  "merchant": "store/vendor name as printed, or null",
  "total": "the final total amount paid as a plain number with no currency symbol or commas, or null",
  "category_hint": "a short 1-3 word guess at an expense category such as supplies, utilities, insurance, repairs and maintenance, cleaning, landscaping, marketing, or null"
}

If you cannot read a field confidently, use null for it rather than guessing. Respond with raw JSON only.`

export default async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return new Response('Unauthorized', { status: 401 })

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!supabaseUrl || !anonKey || !apiKey) {
    return new Response('Server not configured', { status: 500 })
  }

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
  })
  if (!userRes.ok) return new Response('Unauthorized', { status: 401 })

  let body
  try {
    body = await request.json()
  } catch {
    return new Response('Invalid request body', { status: 400 })
  }
  const { image, mimeType } = body
  if (!image || !mimeType) {
    return new Response('Missing image', { status: 400 })
  }

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: image } },
            { type: 'text', text: EXTRACTION_PROMPT },
          ],
        },
      ],
    }),
  })

  if (!claudeRes.ok) {
    const err = await claudeRes.text()
    console.error('Claude receipt scan failed', err)
    return new Response('Could not read receipt', { status: 502 })
  }

  const claudeData = await claudeRes.json()
  const rawText = claudeData.content?.[0]?.text ?? ''
  let extracted
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    extracted = JSON.parse(jsonMatch ? jsonMatch[0] : rawText)
  } catch {
    return new Response('Could not parse receipt', { status: 502 })
  }

  return new Response(JSON.stringify(extracted), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
