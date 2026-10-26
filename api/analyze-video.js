import { GoogleGenAI } from '@google/genai';
import formidable from 'formidable';
import fs from 'node:fs/promises';

export const config = {
    api: {
        bodyParser: false
    }
};

const MAX_VIDEO_SIZE = 18 * 1024 * 1024;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'Gemini API key is not configured' });
    }

    const form = formidable({
        keepExtensions: true,
        maxFiles: 1,
        maxFileSize: MAX_VIDEO_SIZE,
        filter: ({ mimetype }) => Boolean(mimetype?.startsWith('video/'))
    });

    let videoFile;
    try {
        const [, files] = await form.parse(req);
        const uploadedFile = files.video?.[0] || files.video;
        if (!uploadedFile) {
            return res.status(400).json({ error: 'Select a video file to analyze' });
        }
        videoFile = uploadedFile;

        const videoBuffer = await fs.readFile(videoFile.filepath);
        const ai = new GoogleGenAI({ apiKey });
        const result = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{
                parts: [
                    {
                        inlineData: {
                            mimeType: videoFile.mimetype || 'video/mp4',
                            data: videoBuffer.toString('base64')
                        }
                    },
                    {
                        text: 'You are an expert Clash Royale tactical coach. Analyze only what is visible in this gameplay video. Give concise, actionable feedback with timestamps when possible. Cover opening play and elixir management, troop placement and spacing, defensive trades, and the top three improvements for the next match. State when details cannot be determined from the footage.'
                    }
                ]
            }]
        });

        return res.status(200).json({ analysis: result.text || 'No analysis was returned.' });
    } catch (error) {
        console.error('Video analysis error:', error);
        const isTooLarge = error.code === 'maxFileSizeExceeded' || error.httpCode === 413;
        return res.status(isTooLarge ? 413 : 500).json({
            error: isTooLarge ? 'Video must be smaller than 18 MB' : 'Failed to analyze the video'
        });
    } finally {
        if (videoFile?.filepath) {
            await fs.rm(videoFile.filepath, { force: true }).catch(() => {});
        }
    }
}
