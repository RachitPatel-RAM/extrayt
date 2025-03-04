const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { google } = require('googleapis');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const session = require('express-session');
const FileStore = require('session-file-store')(session);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ credentials: true, origin: process.env.NODE_ENV === 'production' ? 'https://extrayt.onrender.com' : 'http://localhost:3000' }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(session({
    store: new FileStore({
        path: './sessions',
        secret: 'your-secret-key-here',
        ttl: 86400
    }),
    secret: 'your-secret-key-here',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 24 * 60 * 60 * 1000 }
}));

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.NODE_ENV === 'production' ? 'https://extrayt.onrender.com/auth/youtube/callback' : 'http://localhost:3000/auth/youtube/callback'
);

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

app.get('/auth/youtube/callback', async (req, res) => {
    const { code } = req.query;
    try {
        console.log('Handling OAuth callback with code:', code);
        const { tokens } = await oauth2Client.getToken(code);
        req.session.youtubeToken = tokens.access_token;
        console.log('YouTube token stored:', tokens.access_token);
        res.redirect(`/?token=${tokens.access_token}`);
    } catch (error) {
        console.error('OAuth callback error:', error.message);
        res.status(500).send('Authentication failed');
    }
});

app.get('/api/auth/check', async (req, res) => {
    const token = req.query.token || req.session.youtubeToken;
    console.log('Checking auth with token:', token);
    if (!token) {
        console.log('No token provided');
        return res.json({ authenticated: false, error: 'No token' });
    }
    const youtube = google.youtube({
        version: 'v3',
        auth: oauth2Client
    });
    oauth2Client.setCredentials({ access_token: token });
    try {
        console.log('Fetching YouTube channels...');
        const response = await youtube.channels.list({
            part: 'snippet',
            mine: true,
            key: process.env.GOOGLE_API_KEY
        });
        console.log('Raw API response:', JSON.stringify(response.data, null, 2));
        const channels = response.data.items ? response.data.items.map(item => ({
            id: item.id,
            name: item.snippet.title
        })) : [];
        console.log('Channels fetched:', channels);
        res.json({ authenticated: true, channels });
    } catch (error) {
        console.error('Error fetching channels:', error.message);
        if (error.response) {
            console.error('API error details:', error.response.data);
        }
        res.json({ authenticated: false, error: error.message });
    }
});

app.post('/api/create-shorts', async (req, res) => {
    try {
        const { channelId, videoUrl, clipCount, pexelsKey, token } = req.body;
        if (!token) {
            console.log('No YouTube token provided');
            return res.status(401).json({ success: false, error: 'No token provided' });
        }
        const youtube = google.youtube({
            version: 'v3',
            auth: oauth2Client
        });
        oauth2Client.setCredentials({ access_token: token });
        console.log('Starting short clip creation with:', { channelId, videoUrl, clipCount });

        // Step 1: Download and analyze video
        console.log('Step 1: Downloading and analyzing video...');
        const videoPath = await downloadVideo(videoUrl);
        const duration = await getVideoDuration(videoPath);
        const isHindi = await detectHindi(videoPath); // Basic detection

        // Step 2: Generate clips
        console.log('Step 2: Generating clips...');
        const clips = await generateClips(videoPath, duration, clipCount || 5, isHindi, pexelsKey);

        // Step 3: Upload clips to YouTube
        console.log('Step 3: Uploading clips to YouTube...');
        const uploadedClips = [];
        for (const clip of clips) {
            const uploadResult = await uploadToYouTube(clip.path, clip.metadata, channelId, youtube);
            uploadedClips.push({ id: uploadResult.id, url: `https://youtube.com/watch?v=${uploadResult.id}` });
            fs.unlinkSync(clip.path); // Clean up
        }
        console.log('All clips uploaded:', uploadedClips);

        // Clean up temporary video
        fs.unlinkSync(videoPath);

        res.json({
            success: true,
            clips: uploadedClips
        });
    } catch (error) {
        console.error('Error in short clip creation:', error.message);
        res.status(500).json({ success: false, error: error.message, stack: error.stack });
    }
});

async function downloadVideo(videoUrl) {
    const tempDir = path.join(__dirname, 'temp', `video_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const videoPath = path.join(tempDir, 'input.mp4');
    const writer = fs.createWriteStream(videoPath);
    const response = await axios({ url: videoUrl, method: 'GET', responseType: 'stream' });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(videoPath));
        writer.on('error', reject);
    });
}

async function getVideoDuration(videoPath) {
    return new Promise((resolve, reject) => {
        const ffmpegProcess = spawn('/usr/bin/ffmpeg', ['-i', videoPath]);
        let duration = 0;
        ffmpegProcess.stderr.on('data', (data) => {
            const output = data.toString();
            const match = output.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/);
            if (match) {
                duration = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
            }
        });
        ffmpegProcess.on('close', (code) => {
            if (code === 0 && duration) resolve(duration);
            else reject(new Error('Failed to get video duration'));
        });
    });
}

async function detectHindi(videoPath) {
    // Basic Hindi detection via metadata or simple audio check (limited without full ASR)
    return new Promise((resolve) => {
        const ffmpegProcess = spawn('/usr/bin/ffmpeg', ['-i', videoPath]);
        ffmpegProcess.stderr.on('data', (data) => {
            const output = data.toString();
            if (output.includes('hindi') || output.includes('hin')) resolve(true); // Crude check
        });
        ffmpegProcess.on('close', () => resolve(false)); // Default to non-Hindi if no hint
    });
}

async function generateClips(videoPath, duration, clipCount, isHindi, pexelsKey) {
    const clipDuration = Math.min(60 / clipCount, 15); // Max 15s per clip
    const clips = [];
    const segmentLength = Math.floor(duration / clipCount);
    
    for (let i = 0; i < clipCount; i++) {
        const startTime = i * segmentLength;
        if (startTime + clipDuration > duration) break; // Avoid exceeding video length
        
        const outputDir = path.join(__dirname, 'temp', `clip_${Date.now()}_${i}`);
        fs.mkdirSync(outputDir, { recursive: true });
        const clipPath = path.join(outputDir, `clip_${i}.mp4`);
        const subtitleFile = path.join(outputDir, `subtitle_${i}.srt`);

        // Generate subtitle for this segment
        const subtitleText = await generateSubtitle(startTime, clipDuration, isHindi);
        fs.writeFileSync(subtitleFile, subtitleText);

        // Extract clip with FFmpeg
        await new Promise((resolve, reject) => {
            const ffmpegProcess = spawn('/usr/bin/ffmpeg', [
                '-i', videoPath,
                '-ss', startTime,
                '-t', clipDuration,
                '-c:v', 'libx264',
                '-an', // Silent for now
                '-vf', `scale=1280:720,subtitles=${subtitleFile}`, // High-quality even dimensions
                '-preset', 'medium',
                '-crf', '23',
                clipPath,
                '-y' // Overwrite
            ]);
            ffmpegProcess.stderr.on('data', (data) => console.log(`FFmpeg Clip ${i}: ${data}`));
            ffmpegProcess.on('close', (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg clip ${i} failed with code ${code}`)));
            ffmpegProcess.on('error', reject);
        });

        clips.push({
            path: clipPath,
            metadata: {
                title: `Short ${i + 1}: ${niche} Highlights`,
                description: `Clip ${i + 1} from ${niche} - Enjoy this snippet! #${niche.replace(/ /g, '')} #Shorts`,
                tags: ['shorts', niche]
            }
        });
    }
    return clips;
}

async function generateSubtitle(startTime, duration, isHindi) {
    const subjects = isHindi ? ['ये', 'एक', 'इस', 'वो', 'अद्भुत'] : ['This', 'A', 'The', 'That', 'Amazing'];
    const actions = isHindi ? ['दिखाता है', 'प्रकट करता है', 'हैरान करता है', 'बताता है', 'रोमांचित करता है'] : ['shows', 'reveals', 'amazes', 'tells', 'thrills'];
    const twists = isHindi ? ['छिपा खजाना', 'अनोखा मोड़', 'चौंकाने वाला सच', 'रोमांचक खोज', 'दुर्लभ चमत्कार'] : ['hidden treasure', 'unique twist', 'shocking truth', 'exciting find', 'rare wonder'];
    const endings = isHindi ? ['जो आपको हैरान कर देगा!', 'जो कभी नहीं भूलेंगे!', 'जो सब बदल देगा!', 'जो देखने लायक है!', 'जो अविश्वसनीय है!'] : ['that’ll stun you!', 'you’ll never forget!', 'that changes everything!', 'worth seeing!', 'that’s unreal!'];

    const subject = subjects[Math.floor(Math.random() * subjects.length)];
    const action = actions[Math.floor(Math.random() * actions.length)];
    const twist = twists[Math.floor(Math.random() * twists.length)];
    const ending = endings[Math.floor(Math.random() * endings.length)];

    const narration = `${subject} ${action} ${twist} ${ending}`;
    const start = formatSrtTime(startTime);
    const end = formatSrtTime(startTime + duration);
    return `1\n${start} --> ${end}\n${narration}\n\n`;
}

async function uploadToYouTube(videoFile, metadata, channelId, youtube) {
    const videoMetadata = {
        snippet: {
            title: metadata.title,
            description: metadata.description,
            tags: metadata.tags,
            categoryId: '22'
        },
        status: { privacyStatus: 'public' } // Public upload
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