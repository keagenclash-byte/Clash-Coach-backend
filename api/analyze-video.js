import { GoogleGenAI } from '@google/genai';

export const config = {
    api: {
        bodyParser: {
            sizeLimit: '4mb'
        }
    }
};

const MAX_FRAMES = 60;
const MAX_TOTAL_IMAGE_BYTES = 3_000_000;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_GEMINI_ATTEMPTS = 3;

function isRetryableGeminiError(error) {
    const status = Number(error?.status || error?.statusCode || error?.response?.status);
    return !Number.isFinite(status) || status === 408 || status === 429 || status >= 500;
}

async function generateContentWithRetry(ai, request) {
    for (let attempt = 1; attempt <= MAX_GEMINI_ATTEMPTS; attempt += 1) {
        try {
            return await ai.models.generateContent(request);
        } catch (error) {
            if (attempt === MAX_GEMINI_ATTEMPTS || !isRetryableGeminiError(error)) {
                throw error;
            }

            const delayMs = 250 * (2 ** (attempt - 1));
            console.warn(`Gemini video analysis attempt ${attempt} failed; retrying in ${delayMs}ms`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'Gemini API key is not configured' });
    }

    try {
        const { frames } = req.body || {};
        if (!Array.isArray(frames) || frames.length === 0) {
            return res.status(400).json({ error: 'Provide sampled video frames in a frames array' });
        }
        if (frames.length > MAX_FRAMES) {
            return res.status(400).json({ error: `A maximum of ${MAX_FRAMES} sampled frames is allowed` });
        }

        let totalImageBytes = 0;
        for (const frame of frames) {
            if (!frame || !Number.isFinite(frame.timestamp) || frame.timestamp < 0) {
                return res.status(400).json({ error: 'Each frame must include a valid non-negative timestamp' });
            }
            if (!SUPPORTED_IMAGE_TYPES.has(frame.mimeType) || typeof frame.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(frame.data)) {
                return res.status(400).json({ error: 'Each frame must contain a supported base64-encoded image' });
            }
            totalImageBytes += Math.floor(frame.data.length * 3 / 4);
            if (totalImageBytes > MAX_TOTAL_IMAGE_BYTES) {
                return res.status(413).json({ error: 'Sampled images exceed the 3 MB limit' });
            }
        }

        const ai = new GoogleGenAI({ apiKey });
        const result = await generateContentWithRetry(ai, {
            model: 'gemini-3.8-flash',
            contents: [{
                parts: [
                    {
                        text: 'You are an expert Clash Royale tactical coach. The following images are sampled from a gameplay video at the indicated timestamps. Analyze only what is visible. Give concise, actionable feedback on opening plays and elixir management, troop placement and spacing, defensive trades, and the top three improvements for the next match. Cite timestamps where possible and state when details cannot be determined from the sampled frames.'
                    },
                    ...frames.flatMap((frame) => [
                        { text: `Gameplay frame at ${frame.timestamp} seconds:` },
                        { inlineData: { mimeType: frame.mimeType, data: frame.data } }
                    ])
                ]
            }]
        });

        return res.status(200).json({ analysis: result.text || 'No analysis was returned.' });
    } catch (error) {
        console.error('Video analysis error:', error);
        return res.status(500).json({ error: 'Failed to analyze the sampled video frames' });
    }
}
