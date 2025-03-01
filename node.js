const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { google } = require('googleapis');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const OpenAI = require('openai');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Initialize OpenAI (you'll need to provide your API key in a .env file)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// YouTube API setup
const youtube = google.youtube('v3');
const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI
);

// API Routes
app.post('/api/create-video', async (req, res) => {
    try {
        const { channelId, videoType, niche, keywords, additionalInstructions } = req.body;
        
        // 1. Generate script
        const script = await generateScript(niche, videoType, keywords, additionalInstructions);
        
        // 2. Collect media
        const mediaFiles = await collectMedia(script, niche);
        
        // 3. Generate voiceover
        const voiceoverFile = await generateVoiceover(script);
        
        // 4. Assemble video
        const videoFile = await assembleVideo(mediaFiles, voiceoverFile, script, videoType);
        
        // 5. Upload to YouTube
        const uploadResult = await uploadToYouTube(videoFile, script, channelId, niche, keywords);
        
        res.json({
            success: true,
            videoId: uploadResult.id,
            videoUrl: `https://youtube.com/watch?v=${uploadResult.id}`
        });
    } catch (error) {
        console.error('Error creating video:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Helper functions
async function generateScript(niche, videoType, keywords, additionalInstructions) {
    console.log('Generating script...');
    
    // Determine content length based on video type
    const contentLength = videoType === 'short' ? 'approximately 60 seconds' : '5-6 minutes';
    
    // Craft the prompt for OpenAI
    const prompt = `
    Create an engaging script for a ${contentLength} YouTube video about ${niche}.
    ${keywords ? `Include these keywords: ${keywords}.` : ''}
    ${additionalInstructions ? `Additional instructions: ${additionalInstructions}` : ''}
    
    The script should include:
    1. An attention-grabbing intro
    2. Clear sections with logical flow
    3. A strong call to action at the end
    
    Format the output as a JSON object with these properties:
    - title: A catchy title for the video
    - description: YouTube description with relevant hashtags
    - script: The full narration script
    - scenes: An array of scene objects, each containing:
      - narration: What should be said in this scene
      - visual_description: What should be shown visually
      - duration: Approximate duration in seconds
    `;
    
    // Call OpenAI API
    const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
            { role: "system", content: "You are a professional YouTube script writer." },
            { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" }
    });
    
    // Parse the response
    const scriptData = JSON.parse(completion.choices[0].message.content);
    console.log('Script generated successfully');
    
    return scriptData;
}

async function collectMedia(script, niche) {
    console.log('Collecting media for video...');
    
    // Create a directory for media files
    const mediaDir = path.join(__dirname, 'temp', `media_${Date.now()}`);
    fs.mkdirSync(mediaDir, { recursive: true });
    
    const mediaFiles = [];
    
    // Process each scene to find appropriate media
    for (let i = 0; i < script.scenes.length; i++) {
        const scene = script.scenes[i];
        
        // Craft search query based on scene description
        const searchQuery = `${niche} ${scene.visual_description}`.substring(0, 100);
        
        // Use Pexels API (free) to find images/videos
        // Note: In a production app, you'd need to register for an API key
        try {
            // Image search
            const imageResponse = await axios.get('https://api.pexels.com/v1/search', {
                headers: {
                    'Authorization': process.env.PEXELS_API_KEY
                },
                params: {
                    query: searchQuery,
                    per_page: 1
                }
            });
            
            if (imageResponse.data.photos && imageResponse.data.photos.length > 0) {
                const imageUrl = imageResponse.data.photos[0].src.large;
                const imagePath = path.join(mediaDir, `scene_${i}_image.jpg`);
                
                // Download image
                const imageWriter = fs.createWriteStream(imagePath);
                const imageDownload = await axios({
                    url: imageUrl,
                    method: 'GET',
                    responseType: 'stream'
                });
                
                imageDownload.data.pipe(imageWriter);
                
                await new Promise((resolve, reject) => {
                    imageWriter.on('finish', resolve);
                    imageWriter.on('error', reject);
                });
                
                mediaFiles.push({
                    type: 'image',
                    path: imagePath,
                    scene: i,
                    duration: scene.duration
                });
            } else {
                // Fallback to video search if no images found
                const videoResponse = await axios.get('https://api.pexels.com/videos/search', {
                    headers: {
                        'Authorization': process.env.PEXELS_API_KEY
                    },
                    params: {
                        query: searchQuery,
                        per_page: 1
                    }
                });
                
                if (videoResponse.data.videos && videoResponse.data.videos.length > 0) {
                    // Get the video file URL (choosing the smallest file for simplicity)
                    const videoFiles = videoResponse.data.videos[0].video_files;
                    const videoFile = videoFiles.sort((a, b) => a.width - b.width)[0];
                    
                    const videoPath = path.join(mediaDir, `scene_${i}_video.mp4`);
                    
                    // Download video
                    const videoWriter = fs.createWriteStream(videoPath);
                    const videoDownload = await axios({
                        url: videoFile.link,
                        method: 'GET',
                        responseType: 'stream'
                    });
                    
                    videoDownload.data.pipe(videoWriter);
                    
                    await new Promise((resolve, reject) => {
                        videoWriter.on('finish', resolve);
                        videoWriter.on('error', reject);
                    });
                    
                    mediaFiles.push({
                        type: 'video',
                        path: videoPath,
                        scene: i,
                        duration: scene.duration
                    });
                }
            }
        } catch (error) {
            console.error(`Error collecting media for scene ${i}:`, error);
            // Create a placeholder image with text as fallback
            // In a real implementation, you would use a library to generate a basic image
        }
    }
    
    console.log(`Collected ${mediaFiles.length} media files`);
    return mediaFiles;
}

async function generateVoiceover(script) {
    console.log('Generating voiceover...');
    
    // Create a directory for the audio file
    const audioDir = path.join(__dirname, 'temp', `audio_${Date.now()}`);
    fs.mkdirSync(audioDir, { recursive: true });
    
    // Combine all narration into one script
    const fullScript = script.scenes.map(scene => scene.narration).join(' ');
    
    // ElevenLabs API is a good option for realistic voice generation
    // For a free alternative, we'll use a placeholder method
    // In a production app, you would use a proper TTS API
    
    try {
        // This is a placeholder for the actual API call
        // In a real implementation, you would use something like:
        /*
        const response = await axios.post('https://api.elevenlabs.io/v1/text-to-speech/voice_id', {
            text: fullScript,
            voice_settings: {
                stability: 0.5,
                similarity_boost: 0.5
            }
        }, {
            headers: {
                'xi-api-key': process.env.ELEVENLABS_API_KEY,
                'Content-Type': 'application/json'
            },
            responseType: 'arraybuffer'
        });
        
        const audioPath = path.join(audioDir, 'voiceover.mp3');
        fs.writeFileSync(audioPath, response.data);
        */
        
        // For this demo, we'll use a Python script to generate speech with pyttsx3
        // which is a free offline TTS engine
        const scriptPath = path.join(audioDir, 'script.txt');
        fs.writeFileSync(scriptPath, fullScript);
        
        const audioPath = path.join(audioDir, 'voiceover.mp3');
        
        // Execute Python script for TTS (you would need to create this Python script)
        await new Promise((resolve, reject) => {
            const pythonProcess = spawn('python', ['generate_speech.py', scriptPath, audioPath]);
            
            pythonProcess.stdout.on('data', (data) => {
                console.log(`Python TTS: ${data}`);
            });
            
            pythonProcess.stderr.on('data', (data) => {
                console.error(`Python TTS error: ${data}`);
            });
            
            pythonProcess.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Python process exited with code ${code}`));
                }
            });
        });
        
        console.log('Voiceover generated successfully');
        return audioPath;
    } catch (error) {
        console.error('Error generating voiceover:', error);
        throw error;
    }
}

async function assembleVideo(mediaFiles, voiceoverFile, script, videoType) {
    console.log('Assembling video...');
    
    // Create output directory
    const outputDir = path.join(__dirname, 'temp', `output_${Date.now()}`);
    fs.mkdirSync(outputDir, { recursive: true });
    
    const outputPath = path.join(outputDir, 'final_video.mp4');
    
    // Generate a temporary file with FFmpeg commands
    const ffmpegFile = path.join(outputDir, 'ffmpeg_commands.txt');
    let ffmpegCommands = [];
    
    // Add each media file to the command
    for (const media of mediaFiles) {
        if (media.type === 'image') {
            // For images, specify duration
            ffmpegCommands.push(`file '${media.path}'`);
            ffmpegCommands.push(`duration ${media.duration}`);
        } else {
            // For videos
            ffmpegCommands.push(`file '${media.path}'`);
        }
    }
    
    fs.writeFileSync(ffmpegFile, ffmpegCommands.join('\n'));
    
    // Generate subtitles file
    const subtitleFile = path.join(outputDir, 'subtitles.srt');
    let subtitleContent = '';
    let currentTime = 0;
    
    for (let i = 0; i < script.scenes.length; i++) {
        const scene = script.scenes[i];
        const startTime = formatSrtTime(currentTime);
        currentTime += scene.duration;
        const endTime = formatSrtTime(currentTime);
        
        // Split narration into multiple subtitle chunks if too long
        const narration = scene.narration;
        const chunks = splitTextIntoChunks(narration, 40);
        
        for (let j = 0; j < chunks.length; j++) {
            const chunkStartTime = formatSrtTime(currentTime - scene.duration + (scene.duration / chunks.length) * j);
            const chunkEndTime = formatSrtTime(currentTime - scene.duration + (scene.duration / chunks.length) * (j + 1));
            
            subtitleContent += `${i * chunks.length + j + 1}\n`;
            subtitleContent += `${chunkStartTime} --> ${chunkEndTime}\n`;
            subtitleContent += `${chunks[j]}\n\n`;
        }
    }
    
    fs.writeFileSync(subtitleFile, subtitleContent);
    
    // Use FFmpeg to assemble the video
    return new Promise((resolve, reject) => {
        try {
            // This is a simplified version - a real implementation would be more complex
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
            
            ffmpegProcess.stderr.on('data', (data) => {
                console.log(`FFmpeg: ${data}`);
            });
            
            ffmpegProcess.on('close', (code) => {
                if (code === 0) {
                    console.log('Video assembled successfully');
                    resolve(outputPath);
                } else {
                    reject(new Error(`FFmpeg process exited with code ${code}`));
                }
            });
        } catch (error) {
            console.error('Error assembling video:', error);
            reject(error);
        }
    });
}

async function uploadToYouTube(videoFile, script, channelId, niche, keywords) {
    console.log('Uploading video to YouTube...');
    
    // In a real application, you would handle OAuth authentication
    // For this demo, we'll assume the auth token is already set
    
    // Prepare video metadata
    const videoMetadata = {
        snippet: {
            title: script.title,
            description: script.description,
            tags: keywords ? keywords.split(',').map(k => k.trim()) : [],
            categoryId: '22' // People & Blogs
        },
        status: {
            privacyStatus: 'private' // Start as private for safety
        }
    };
    
    // This is a placeholder for the actual upload
    // In a real implementation, you would use the YouTube API:
    /*
    return new Promise((resolve, reject) => {
        const fileSize = fs.statSync(videoFile).size;
        
        const req = youtube.videos.insert({
            auth: oauth2Client,
            part: 'snippet,status',
            requestBody: videoMetadata,
            media: {
                body: fs.createReadStream(videoFile)
            }
        }, (err, response) => {
            if (err) {
                console.error('Error uploading to YouTube:', err);
                reject(err);
                return;
            }
            
            console.log('Video uploaded successfully');
            resolve(response.data);
        });
    });
    */
    
    // For demo purposes, return a mock response
    return {
        id: 'dQw4w9WgXcQ', // Example video ID
        snippet: {
            title: script.title,
            publishedAt: new Date().toISOString()
        }
    };
}

// Helper function to format time for SRT subtitles
function formatSrtTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

// Helper function to split text into chunks for subtitles
function splitTextIntoChunks(text, maxCharsPerLine) {
    const words = text.split(' ');
    const chunks = [];
    let currentChunk = '';
    
    words.forEach(word => {
        if ((currentChunk + ' ' + word).length <= maxCharsPerLine) {
            currentChunk += (currentChunk ? ' ' : '') + word;
        } else {
            chunks.push(currentChunk);
            currentChunk = word;
        }
    });
    
    if (currentChunk) {
        chunks.push(currentChunk);
    }
    
    return chunks;
}

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});