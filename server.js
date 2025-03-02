const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { google } = require('googleapis');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const OpenAI = require('openai');
const crypto = require('crypto');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware setup
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(session({
    secret: crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: true,
    cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// Google OAuth2 client setup with environment variables
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID || 'YOUR_CLIENT_ID', // Use env var or placeholder
    process.env.GOOGLE_CLIENT_SECRET || 'YOUR_CLIENT_SECRET', // Use env var or placeholder
    process.env.NODE_ENV === 'production' ? 'https://extrayt.onrender.com/auth/youtube/callback' : 'http://localhost:3000/auth/youtube/callback'
);

// OAuth redirect endpoint
app.get('/auth/youtube', (req, res) => {
    console.log('Redirecting to Google OAuth...');
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'https://www.googleapis.com/auth/youtube.upload',
            'https://www.googleapis.com/auth/youtube.readonly'
        ],
        prompt: 'consent'
    });
    res.redirect(authUrl);
});

// OAuth callback endpoint
app.get('/auth/youtube/callback', async (req, res) => {
    const { code } = req.query;
    try {
        console.log('Handling OAuth callback with code:', code);
        const { tokens } = await oauth2Client.getToken(code);
        req.session.youtubeToken = tokens.access_token;
        console.log('YouTube token stored in session:', tokens.access_token);
        res.redirect('/');
    } catch (error) {
        console.error('OAuth callback error:', error);
        res.status(500).send('Authentication failed');
    }
});

// Check authentication status
app.get('/api/auth/check', async (req, res) => {
    if (!req.session.youtubeToken) {
        console.log('No YouTube token in session');
        return res.json({ authenticated: false });
    }
    const youtube = google.youtube({ version: 'v3', auth: req.session.youtubeToken });
    try {
        console.log('Fetching YouTube channels for authenticated user...');
        const response = await youtube.channels.list({
            part: 'snippet',
            mine: true
        });
        const channels = response.data.items.map(item => ({
            id: item.id,
            name: item.snippet.title
        }));
        console.log('Channels fetched:', channels);
        res.json({ authenticated: true, channels });
    } catch (error) {
        console.error('Error checking auth:', error);
        res.json({ authenticated: false });
    }
});

// Video creation endpoint
app.post('/api/create-video', async (req, res) => {
    try {
        const { channelId, videoType, niche, keywords, additionalInstructions, openaiKey, pexelsKey, elevenlabsKey } = req.body;
        if (!req.session.youtubeToken) {
            console.log('No YouTube token for video creation');
            return res.status(401).json({ success: false, error: 'YouTube token not provided' });
        }
        const youtube = google.youtube({ version: 'v3', auth: req.session.youtubeToken });
        console.log('Creating video with:', { channelId, videoType, niche, keywords, additionalInstructions });
        
        const openai = new OpenAI({ apiKey: openaiKey });
        const script = await generateScript(niche, videoType, keywords, additionalInstructions, openai);
        const mediaFiles = await collectMedia(script, niche, pexelsKey);
        const voiceoverFile = await generateVoiceover(script, elevenlabsKey);
        const videoFile = await assembleVideo(mediaFiles, voiceoverFile, script, videoType);
        const uploadResult = await uploadToYouTube(videoFile, script, channelId, niche, keywords, youtube);
        
        console.log('Video uploaded successfully:', uploadResult.id);
        res.json({
            success: true,
            videoId: uploadResult.id,
            videoUrl: `https://youtube.com/watch?v=${uploadResult.id}`
        });
    } catch (error) {
        console.error('Error creating video:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Helper functions (unchanged)
async function generateScript(niche, videoType, keywords, additionalInstructions, openai) {
    console.log('Generating script...');
    const contentLength = videoType === 'short' ? 'approximately 60 seconds' : '5-6 minutes';
    const prompt = `
        Create an engaging script for a ${contentLength} YouTube video about ${niche}.
        ${keywords ? `Include these keywords: ${keywords}.` : ''}
        ${additionalInstructions ? `Additional instructions: ${additionalInstructions}` : ''}
        
        The script should include:
        1. An attention-grabbing intro
        2. Clear sections with logical flow
        3. A strong call to action at the end
        
        Format the output as a JSON object with:
        - title: A catchy title
        - description: YouTube description with hashtags
        - script: Full narration script
        - scenes: Array of scene objects (narration, visual_description, duration in seconds)
    `;
    const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
            { role: 'system', content: 'You are a professional YouTube script writer.' },
            { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' }
    });
    return JSON.parse(completion.choices[0].message.content);
}

async function collectMedia(script, niche, pexelsKey) {
    console.log('Collecting media...');
    const mediaDir = path.join(__dirname, 'temp', `media_${Date.now()}`);
    fs.mkdirSync(mediaDir, { recursive: true });
    const mediaFiles = [];
    for (let i = 0; i < script.scenes.length; i++) {
        const scene = script.scenes[i];
        const searchQuery = `${niche} ${scene.visual_description}`.substring(0, 100);
        try {
            const imageResponse = await axios.get('https://api.pexels.com/v1/search', {
                headers: { 'Authorization': pexelsKey },
                params: { query: searchQuery, per_page: 1 }
            });
            if (imageResponse.data.photos?.length > 0) {
                const imageUrl = imageResponse.data.photos[0].src.large;
                const imagePath = path.join(mediaDir, `scene_${i}_image.jpg`);
                const imageWriter = fs.createWriteStream(imagePath);
                const imageDownload = await axios({ url: imageUrl, method: 'GET', responseType: 'stream' });
                imageDownload.data.pipe(imageWriter);
                await new Promise((resolve, reject) => {
                    imageWriter.on('finish', resolve);
                    imageWriter.on('error', reject);
                });
                mediaFiles.push({ type: 'image', path: imagePath, scene: i, duration: scene.duration });
            }
        } catch (error) {
            console.error(`Error collecting media for scene ${i}:`, error);
        }
    }
    return mediaFiles;
}

async function generateVoiceover(script, elevenlabsKey) {
    console.log('Generating voiceover with ElevenLabs...');
    const audioDir = path.join(__dirname, 'temp', `audio_${Date.now()}`);
    fs.mkdirSync(audioDir, { recursive: true });
    const fullScript = script.scenes.map(scene => scene.narration).join(' ');
    const audioPath = path.join(audioDir, 'voiceover.mp3');
    try {
        const response = await axios.post(
            'https://api.elevenlabs.io/v1/text-to-speech/r21m7BAbXjtux814CeJE',
            { text: fullScript, voice_settings: { stability: 0.5, similarity_boost: 0.5 } },
            {
                headers: {
                    'xi-api-key': elevenlabsKey,
                    'Content-Type': 'application/json'
                },
                responseType: 'arraybuffer'
            }
        );
        fs.writeFileSync(audioPath, Buffer.from(response.data));
        return audioPath;
    } catch (error) {
        console.error('Error generating voiceover:', error);
        throw error;
    }
}

async function assembleVideo(mediaFiles, voiceoverFile, script, videoType) {
    console.log('Assembling video...');
    const outputDir = path.join(__dirname, 'temp', `output_${Date.now()}`);
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, 'final_video.mp4');
    const ffmpegFile = path.join(outputDir, 'ffmpeg_commands.txt');
    let ffmpegCommands = [];
    for (const media of mediaFiles) {
        ffmpegCommands.push(`file '${media.path}'`);
        ffmpegCommands.push(`duration ${media.duration}`);
    }
    fs.writeFileSync(ffmpegFile, ffmpegCommands.join('\n'));
    const subtitleFile = path.join(outputDir, 'subtitles.srt');
    let subtitleContent = '';
    let currentTime = 0;
    for (let i = 0; i < script.scenes.length; i++) {
        const scene = script.scenes[i];
        const startTime = formatSrtTime(currentTime);
        currentTime += scene.duration;
        const endTime = formatSrtTime(currentTime);
        subtitleContent += `${i + 1}\n${startTime} --> ${endTime}\n${scene.narration}\n\n`;
    }
    fs.writeFileSync(subtitleFile, subtitleContent);
    return new Promise((resolve, reject) => {
        const ffmpegProcess = spawn('ffmpeg', [
            '-f', 'concat',
            '-safe', '0',
            '-i', ffmpegFile,
            '-i', voiceoverFile,
            '-c:v', 'libx264',
            '-c:a', 'aac',
            '-map', '0:v',
            '-map', '1:a',
            '-shortest',
            '-vf', `subtitles=${subtitleFile}`,
            outputPath
        ]);
        ffmpegProcess.stderr.on('data', (data) => console.log(`FFmpeg: ${data}`));
        ffmpegProcess.on('close', (code) => {
            if (code === 0) resolve(outputPath);
            else reject(new Error(`FFmpeg process exited with code ${code}`));
        });
    });
}

async function uploadToYouTube(videoFile, script, channelId, niche, keywords, youtube) {
    console.log('Uploading to YouTube...');
    const videoMetadata = {
        snippet: {
            title: script.title,
            description: script.description,
            tags: keywords ? keywords.split(',').map(k => k.trim()) : [],
            categoryId: '22'
        },
        status: { privacyStatus: 'private' }
    };
    return new Promise((resolve, reject) => {
        const fileSize = fs.statSync(videoFile).size;
        const req = youtube.videos.insert({
            part: 'snippet,status',
            requestBody: videoMetadata,
            media: { body: fs.createReadStream(videoFile) }
        }, (err, response) => {
            if (err) return reject(err);
            resolve(response.data);
        });
    });
}

function formatSrtTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));