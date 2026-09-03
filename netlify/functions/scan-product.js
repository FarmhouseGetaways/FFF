// Reads a photo of a product held up to the camera and extracts a
// suggested name, price, and category for the Inventory form to
// prefill - same idea as scan-receipt.js, but for "what is this and
// what does it cost" instead of a receipt's line items. Always a
// suggestion, never applied without the user reviewing it.

const EXTRACTION_PROMPT = `You are looking at a photo of a single product held up to a camera, for a small farm stand or shop's inventory. Return ONLY a raw JSON object, no markdown fences, no explanation, with exactly these fields:

{
  "name": "what the product actually is, in plain terms, including any visible size (e.g. 'Buckwheat Honey — 12oz'), or null if you genuinely cannot tell",
  "price": "a price ONLY if one is visibly printed/labeled on the product or its packaging, as a plain number with no currency symbol, otherwise null - never guess a price that isn't shown",
  "category_hint": "a short 1-3 word guess at a product category such as Honey, Eggs, Produce, Jam, Drinks, or null"
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
    console.error('Claude product scan failed', err)
    return new Response('Could not read product', { status: 502 })
  }

  const claudeData = await claudeRes.json()
  const rawText = claudeData.content?.[0]?.text ?? ''
  let extracted
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    extracted = JSON.parse(jsonMatch ? jsonMatch[0] : rawText)
  } catch {
    return new Response('Could not parse product', { status: 502 })
  }

  return new Response(JSON.stringify(extracted), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
