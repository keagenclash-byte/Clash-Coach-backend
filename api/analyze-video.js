export const config = {
    api: {
        bodyParser: {
            sizeLimit: '4.2mb'
        }
    }
};

const MAX_FRAMES = 18;
const MAX_GEMINI_FRAMES = 8;
const MAX_REQUEST_BODY_BYTES = 4_200_000;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export default async function handler(req, res) {
    try {
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return res.status(405).json({ error: 'Method not allowed' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Gemini API key is not configured' });
        }

        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return res.status(400).json({ error: 'Request body must be a JSON object' });
        }

        const { frames } = body;
        if (!Array.isArray(frames) || frames.length === 0) {
            return res.status(400).json({ error: 'Provide sampled video frames in a frames array' });
        }
        if (frames.length > MAX_FRAMES) {
            return res.status(400).json({ error: `A maximum of ${MAX_FRAMES} sampled frames is allowed` });
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

        const selectedFrames = frames.length <= MAX_GEMINI_FRAMES
            ? frames
            : Array.from({ length: MAX_GEMINI_FRAMES }, (_, index) => {
                const sourceIndex = Math.round(index * (frames.length - 1) / (MAX_GEMINI_FRAMES - 1));
                return frames[sourceIndex];
            });

        const parts = [{
            text: 'You are an expert Clash Royale tactical coach. Review gameplay frames sampled evenly across the full video. Analyze only what is visible. Provide concise, actionable coaching on elixir management, card timing, troop placement and spacing, defensive trades, and the top three improvements for the next match. Cite frame timestamps where useful and note uncertainty when details are not visible.'
        }];
        for (const frame of selectedFrames) {
            parts.push({ text: `Gameplay frame at ${frame.timestamp} seconds:` });
            parts.push({ inlineData: { mimeType: frame.mimeType, data: frame.data } });
        }

        const geminiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent', {
            method: 'POST',
            headers: {
                'x-goog-api-key': apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{ parts }],
                generationConfig: { temperature: 0.4, maxOutputTokens: 512 }
            })
        });

        const responseText = await geminiResponse.text();
        let result;
        try {
            result = responseText ? JSON.parse(responseText) : {};
        } catch {
            console.error('Gemini returned a non-JSON response:', responseText);
            return res.status(502).json({ error: 'Gemini returned an invalid response' });
        }

        if (!geminiResponse.ok) {
            const message = result.error?.message || `Gemini request failed (HTTP ${geminiResponse.status})`;
            return res.status(geminiResponse.status >= 400 && geminiResponse.status < 600 ? geminiResponse.status : 502).json({
                error: typeof message === 'string' ? message : 'Gemini request failed'
            });
        }

        const analysis = result.candidates?.[0]?.content?.parts
            ?.map((part) => part.text || '')
            .join('')
            .trim();
        if (!analysis) {
            return res.status(502).json({ error: 'Gemini returned no coaching analysis' });
        }

        return res.status(200).json({ analysis });
    } catch (err) {
        console.error('Gemini video analysis error:', err);
        return res.status(500).json({ error: err?.message || String(err) });
    }
}
