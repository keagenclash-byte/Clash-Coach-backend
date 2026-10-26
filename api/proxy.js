export default async function handler(req, res) {
    const { endpoint, action, type } = req.query;

    if (endpoint === 'analyze' || action === 'analyze' || type === 'analyze') {
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return res.status(405).json({ error: 'Use POST for analysis requests' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Gemini API key is not configured' });
        }

        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { profile, battleLog } = body || {};
            if (!profile && !battleLog) {
                return res.status(400).json({ error: 'Provide a profile and/or battleLog in the request body' });
            }

            const geminiRes = await fetch(
                'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': apiKey
                    },
                    body: JSON.stringify({
                        contents: [{
                            parts: [{
                                text: `Analyze this Clash Royale player data and recent battle log. Give concise, actionable gameplay feedback, identify patterns, and avoid claiming details not supported by the data.\n\n${JSON.stringify({ profile, battleLog })}`
                            }]
                        }]
                    })
                }
            );

            if (!geminiRes.ok) {
                console.error('Gemini API request failed with status:', geminiRes.status);
                return res.status(502).json({ error: 'Gemini analysis request failed' });
            }

            const result = await geminiRes.json();
            const analysis = result.candidates?.[0]?.content?.parts
                ?.map((part) => part.text || '')
                .join('')
                .trim();
            if (!analysis) {
                return res.status(502).json({ error: 'Gemini returned no analysis' });
            }

            return res.status(200).json({ analysis });
        } catch (error) {
            console.error('Gemini analysis error:', error);
            return res.status(500).json({ error: 'Failed to analyze player data' });
        }
    }

    const playerTag = req.query.playerTag || req.query.tag;
    if (!playerTag) {
        return res.status(400).json({ error: 'Player tag is required' });
    }

    const token = process.env.CLASH_ROYALE_TOKEN;
    if (!token) {
        return res.status(500).json({ error: 'Clash Royale API token is not configured on Vercel' });
    }

    try {
        const formattedTag = playerTag.startsWith('#') ? playerTag : `#${playerTag}`;
        const encodedTag = encodeURIComponent(formattedTag);
        const [profileRes, battleRes] = await Promise.all([
            fetch(`https://api.clashroyale.com/v1/players/${encodedTag}`, {
                headers: { Authorization: `Bearer ${token}` }
            }),
            fetch(`https://api.clashroyale.com/v1/players/${encodedTag}/battlelog`, {
                headers: { Authorization: `Bearer ${token}` }
            })
        ]);

        if (!profileRes.ok || !battleRes.ok) {
            const failedRes = !profileRes.ok ? profileRes : battleRes;
            return res.status(failedRes.status).json({ error: 'Failed to fetch data from Clash Royale API' });
        }

        const profile = await profileRes.json();
        const battleLog = await battleRes.json();
        return res.status(200).json({ profile, battleLog });
    } catch (error) {
        console.error('Proxy error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}

