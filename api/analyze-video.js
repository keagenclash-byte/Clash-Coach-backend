export const config = {
    api: {
        bodyParser: {
            sizeLimit: '4mb'
        }
    }
};

const MAX_REQUEST_BODY_BYTES = 3_800_000;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export default async function handler(req, res) {
    try {
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return res.status(405).json({ error: 'Method not allowed' });
        }

        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Groq API key is not configured' });
        }

        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return res.status(400).json({ error: 'Request body must be a JSON object' });
        }

        const { frames } = body;
        if (!Array.isArray(frames) || frames.length === 0) {
            return res.status(400).json({ error: 'Provide sampled video frames in a frames array' });
        }
        if (Buffer.byteLength(JSON.stringify({ frames }), 'utf8') > MAX_REQUEST_BODY_BYTES) {
            return res.status(413).json({ error: 'Compressed frames exceed the single-request size limit' });
        }

        for (const frame of frames) {
            if (!frame || typeof frame !== 'object' || Array.isArray(frame) || !Number.isFinite(frame.timestamp) || frame.timestamp < 0) {
                return res.status(400).json({ error: 'Each frame must include a valid non-negative timestamp' });
            }
            if (!SUPPORTED_IMAGE_TYPES.has(frame.mimeType) || typeof frame.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(frame.data) || frame.data.length === 0) {
                return res.status(400).json({ error: 'Each frame must contain a supported base64-encoded image' });
            }
        }

        const content = [{
            type: 'text',
            text: 'You are an expert Clash Royale tactical coach. Review these gameplay frames sampled every three seconds. Analyze only what is visible. Provide concise, actionable coaching on elixir management, card timing, troop placement and spacing, defensive trades, and the top three improvements for the next match. Cite frame timestamps where useful and note uncertainty when details are not visible.'
        }];
        for (const frame of frames) {
            content.push({ type: 'text', text: `Gameplay frame at ${frame.timestamp} seconds:` });
            content.push({
                type: 'image_url',
                image_url: { url: `data:${frame.mimeType};base64,${frame.data}` }
            });
        }

        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.2-11b-vision-preview',
                messages: [{ role: 'user', content }],
                temperature: 0.4
            })
        });

        const responseText = await groqResponse.text();
        let result;
        try {
            result = responseText ? JSON.parse(responseText) : {};
        } catch {
            console.error('Groq returned a non-JSON response:', responseText);
            return res.status(502).json({ error: 'Groq returned an invalid response' });
        }

        if (!groqResponse.ok) {
            const message = result.error?.message || result.error || `Groq request failed (HTTP ${groqResponse.status})`;
            return res.status(groqResponse.status >= 400 && groqResponse.status < 600 ? groqResponse.status : 502).json({
                error: typeof message === 'string' ? message : 'Groq request failed'
            });
        }

        const analysis = result.choices?.[0]?.message?.content;
        if (typeof analysis !== 'string' || !analysis.trim()) {
            return res.status(502).json({ error: 'Groq returned no coaching analysis' });
        }

        return res.status(200).json({ analysis: analysis.trim() });
    } catch (err) {
        console.error('Groq video analysis error:', err);
        return res.status(500).json({ error: err?.message || String(err) });
    }
}
