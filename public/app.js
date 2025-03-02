let gapiClient;
const CLIENT_ID = '660771517152-fvrs23tgfmqd72k6lk8et0kea9ms0953.apps.googleusercontent.com'; // Your Google Client ID
const API_KEY = 'AIzaSyBYgnhOp0LsWpIF9wSn8Rl_gPS8a0-JMDQ'; // Your Google API Key
const DISCOVERY_DOCS = ['https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest'];
const SCOPES = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';

function initGapiClient() {
    gapi.load('client:auth2', () => {
        gapi.client.init({
            apiKey: API_KEY,
            clientId: CLIENT_ID,
            discoveryDocs: DISCOVERY_DOCS,
            scope: SCOPES
        }).then(() => {
            gapiClient = gapi.auth2.getAuthInstance();
            document.getElementById('youtubeLogin').addEventListener('click', handleAuthClick);
            checkYouTubeAuth();
        }).catch(error => {
            console.error('Error initializing gapi:', error);
            alert('Failed to initialize YouTube API. Please try again.');
        });
    });
}

function handleAuthClick() {
    gapiClient.signIn().then(() => {
        checkYouTubeAuth();
    }).catch(error => {
        console.error('Error signing in:', error);
        alert('YouTube login failed. Please try again.');
    });
}

function checkYouTubeAuth() {
    if (!gapiClient) {
        initGapiClient();
        return;
    }
    if (gapiClient.isSignedIn.get()) {
        gapi.client.youtube.channels.list({
            part: 'snippet',
            mine: true
        }).then(response => {
            const channels = response.result.items.map(item => ({
                id: item.id,
                name: item.snippet.title
            }));
            const channelSelect = document.getElementById('channelSelect');
            channelSelect.innerHTML = '<option value="">-- Select a channel --</option>';
            channels.forEach(channel => {
                const option = document.createElement('option');
                option.value = channel.id;
                option.textContent = channel.name;
                channelSelect.appendChild(option);
            });
            document.getElementById('videoForm').style.display = 'block';
            document.getElementById('youtubeLogin').style.display = 'none';
        }).catch(error => {
            console.error('Error fetching channels:', error);
            alert('Failed to fetch YouTube channels. Please try again.');
        });
    } else {
        document.getElementById('videoForm').style.display = 'none';
        document.getElementById('youtubeLogin').style.display = 'block';
    }
}

document.addEventListener('DOMContentLoaded', function() {
    initGapiClient();
    
    const videoForm = document.getElementById('videoForm');
    videoForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const formData = {
            channelId: document.getElementById('channelSelect').value,
            videoType: document.querySelector('input[name="videoType"]:checked').value,
            niche: document.getElementById('niche').value,
            keywords: document.getElementById('keywords').value,
            additionalInstructions: document.getElementById('additionalInstructions').value,
            openaiKey: document.getElementById('openaiKey').value,
            pexelsKey: document.getElementById('pexelsKey').value,
            elevenlabsKey: document.getElementById('elevenlabsKey').value,
            youtubeToken: gapiClient.getToken().access_token
        };
        
        if (!formData.channelId || !formData.niche || !formData.openaiKey || !formData.pexelsKey || !formData.elevenlabsKey || !formData.youtubeToken) {
            alert('Please fill all required fields and authenticate with YouTube');
            return;
        }
        
        document.getElementById('videoForm').style.display = 'none';
        document.getElementById('loadingSection').style.display = 'block';
        
        createVideo(formData);
    });
});

function createVideo(formData) {
    const progressBar = document.getElementById('progressBar');
    const statusText = document.getElementById('statusText');
    const detailStatus = document.getElementById('detailStatus');
    
    fetch('/api/create-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Video creation failed');
        }
        return response.json();
    })
    .then(data => {
        const steps = [
            { progress: 10, message: 'Generating video script...', detail: 'Analyzing your niche' },
            { progress: 25, message: 'Finding relevant media...', detail: 'Searching visuals' },
            { progress: 40, message: 'Generating voiceover...', detail: 'Creating narration' },
            { progress: 60, message: 'Assembling video...', detail: 'Combining media' },
            { progress: 80, message: 'Preparing for upload...', detail: 'Finalizing video' },
            { progress: 95, message: 'Uploading to YouTube...', detail: 'Uploading to channel' },
            { progress: 100, message: 'Video Created Successfully!', detail: 'Video is live' }
        ];
        
        let currentStep = 0;
        
        function updateProgress() {
            if (currentStep < steps.length) {
                const step = steps[currentStep];
                progressBar.style.width = step.progress + '%';
                statusText.textContent = step.message;
                detailStatus.textContent = step.detail;
                currentStep++;
                setTimeout(updateProgress, 2000);
            } else {
                setTimeout(() => {
                    alert(`Video created successfully! URL: ${data.videoUrl}`);
                    document.getElementById('videoForm').reset();
                    document.getElementById('videoForm').style.display = 'block';
                    document.getElementById('loadingSection').style.display = 'none';
                    progressBar.style.width = '0%';
                }, 1000);
            }
        }
        
        setTimeout(updateProgress, 1000);
    })
    .catch(error => {
        console.error('Error:', error);
        alert('An error occurred. Please try again.');
        document.getElementById('videoForm').style.display = 'block';
        document.getElementById('loadingSection').style.display = 'none';
    });
}