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
const ffmpegPath = require('ffmpeg-static');

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

app.post('/api/create-video', async (req, res) => {
    try {
        const { channelId, videoType, niche, keywords, additionalInstructions, pexelsKey, elevenlabsKey, token } = req.body;
        if (!token) {
            console.log('No YouTube token provided');
            return res.status(401).json({ success: false, error: 'YouTube token not provided' });
        }
        const youtube = google.youtube({
            version: 'v3',
            auth: oauth2Client
        });
        oauth2Client.setCredentials({ access_token: token });
        console.log('Starting video creation with:', { channelId, videoType, niche, keywords, additionalInstructions });

        // Step 1: Generate script
        console.log('Step 1: Generating script...');
        let script;
        try {
            script = await generateScript(niche, videoType, keywords, additionalInstructions);
            console.log('Script generated:', script);
        } catch (error) {
            console.error('Script generation failed:', error.message);
            throw error;
        }

        // Step 2: Collect media
        console.log('Step 2: Collecting media...');
        const mediaFiles = await collectMedia(script, niche, pexelsKey);
        if (!mediaFiles.length) throw new Error('No media files collected');
        console.log('Media collected:', mediaFiles);

        // Step 3: Generate voiceover
        console.log('Step 3: Generating voiceover...');
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1-second delay to mimic single-user behavior
        const voiceoverFile = await generateVoiceover(script, elevenlabsKey);
        console.log('Voiceover generated:', voiceoverFile);

        // Step 4: Assemble video
        console.log('Step 4: Assembling video...');
        const videoFile = await assembleVideo(mediaFiles, voiceoverFile, script, videoType);
        console.log('Video assembled:', videoFile);

        // Step 5: Upload to YouTube
        console.log('Step 5: Uploading to YouTube...');
        const uploadResult = await uploadToYouTube(videoFile, script, channelId, youtube);
        console.log('Video uploaded successfully:', uploadResult.id);

        res.json({
            success: true,
            videoId: uploadResult.id,
            videoUrl: `https://youtube.com/watch?v=${uploadResult.id}`
        });
    } catch (error) {
        console.error('Error in video creation:', error.message);
        if (error.response) {
            console.error('Detailed error response:', error.response.data);
        }
        res.status(500).json({ success: false, error: error.message, stack: error.stack });
    }
});

async function generateScript(niche, videoType, keywords, additionalInstructions) {
    const contentLength = videoType === 'short' ? 'approximately 60 seconds' : '5-6 minutes';
    const subjects = [
        `${niche}`,
        `a ${niche} marvel`,
        `the ${niche} realm`,
        `${niche} mysteries`,
        `secret ${niche}`
    ];
    const actions = [
        "unveils a surprise like",
        "shocks with",
        "amazes by",
        "reveals",
        "intrigues with"
    ];
    const twists = [
        "a hidden gem",
        "an odd twist",
        "a bizarre truth",
        "something wild",
        "a rare find"
    ];
    const endings = [
        "you won’t see coming!",
        "that flips everything!",
        "totally out there!",
        "you gotta hear!",
        "that’s unreal!"
    ];
    const scenes = [];
    let scriptText = "Hey everyone, buckle up for some wild " + niche + "! ";
    
    // Generate 5 unique facts, each with 3 sub-points
    for (let i = 0; i < 5; i++) {
        const subject = subjects[Math.floor(Math.random() * subjects.length)];
        const action = actions[Math.floor(Math.random() * actions.length)];
        const twist = twists[Math.floor(Math.random() * twists.length)];
        const ending = endings[Math.floor(Math.random() * endings.length)];
        
        scenes.push({ narration: `${subject} ${action}`, visual_description: `${niche} intro`, duration: 60 / 18 });
        scenes.push({ narration: `${twist}`, visual_description: `${niche} highlight`, duration: 60 / 18 });
        scenes.push({ narration: `${ending}`, visual_description: `${niche} reveal`, duration: 60 / 18 });
        scriptText += `${subject} ${action} ${twist} ${ending} `;
    }
    
    // Add outro as scenes 16-18
    scenes.push({ narration: "That’s " + niche + "—", visual_description: niche + " wrap-up", duration: 60 / 18 });
    scenes.push({ narration: "like and", visual_description: niche + " action", duration: 60 / 18 });
    scenes.push({ narration: "subscribe for more!", visual_description: niche + " outro", duration: 60 / 18 });
    scriptText += "That’s " + niche + "—like and subscribe for more!";

    const title = `Unbelievable ${niche} Secrets Revealed`;
    const description = `Discover wild ${niche} facts! #${niche.replace(/ /g, '')} #MindBlown`;

    return new Promise((resolve) => {
        setTimeout(() => {
            resolve({
                title,
                description,
                script: scriptText,
                scenes
            });
        }, 500); // Fast response simulation
    });
}

async function collectMedia(script, niche, pexelsKey) {
    const mediaDir = path.join(__dirname, 'temp', `media_${Date.now()}`);
    fs.mkdirSync(mediaDir, { recursive: true });
    const mediaFiles = [];
    const maxImages = 18;
    const requests = script.scenes.slice(0, maxImages).map(async (scene, i) => {
        const searchQuery = `${niche} ${scene.visual_description}`.substring(0, 100);
        try {
            const imageResponse = await axios.get('https://api.pexels.com/v1/search', {
                headers: { 'Authorization': pexelsKey },
                params: { query: searchQuery, per_page: 1 }
            });
            if (imageResponse.data.photos?.length > 0) {
                const imageUrl = imageResponse.data.photos[0].src.tiny;
                const imagePath = path.join(mediaDir, `scene_${i}_image.jpg`);
                const imageWriter = fs.createWriteStream(imagePath);
                const imageDownload = await axios({ url: imageUrl, method: 'GET', responseType: 'stream' });
                imageDownload.data.pipe(imageWriter);
                await new Promise((resolve, reject) => {
                    imageWriter.on('finish', resolve);
                    imageWriter.on('error', reject);
                });
                mediaFiles[i] = { type: 'image', path: imagePath, scene: i, duration: scene.duration };
            }
        } catch (error) {
            console.error(`Error collecting media for scene ${i}:`, error.message);
        }
    });
    await Promise.all(requests);
    return mediaFiles.filter(Boolean);
}

async function generateVoiceover(script, elevenlabsKey) {
    const audioDir = path.join(__dirname, 'temp', `audio_${Date.now()}`);
    fs.mkdirSync(audioDir, { recursive: true });
    const fullScript = script.scenes.map(scene => scene.narration).join(' ').substring(0, 400);
    const audioPath = path.join(audioDir, 'voiceover.mp3');
    try {
        const response = await axios.post(
            'https://api.elevenlabs.io/v1/text-to-speech/82hBsVN6GRUwWKT8d1Kz', // Your selected voice ID
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
        console.error('Error generating voiceover:', error.message);
        throw error;
    }
}

async function assembleVideo(mediaFiles, voiceoverFile, script, videoType) {
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
        const ffmpegProcess = spawn(ffmpegPath, [
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
            '-preset', 'ultrafast',
            outputPath
        ]);
        ffmpegProcess.stderr.on('data', (data) => console.log(`FFmpeg: ${data}`));
        ffmpegProcess.on('close', (code) => {
            if (code === 0) resolve(outputPath);
            else reject(new Error(`FFmpeg process exited with code ${code}`));
        });
    });
}

async function uploadToYouTube(videoFile, script, channelId, youtube) {
    const videoMetadata = {
        snippet: {
            title: script.title,
            description: script.description,
            tags: script.description.match(/#\w+/g)?.map(tag => tag.slice(1)) || [],
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