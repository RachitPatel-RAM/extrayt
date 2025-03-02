document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, setting up login and form...');
    
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    if (token) {
        localStorage.setItem('youtubeToken', token);
        console.log('Token from URL stored in localStorage:', token);
        window.history.replaceState({}, document.title, '/');
    }

    const youtubeLoginButton = document.getElementById('youtubeLogin');
    youtubeLoginButton.addEventListener('click', function() {
        console.log('Login with YouTube clicked, redirecting to server OAuth...');
        window.location.href = '/auth/youtube';
    });

    checkYouTubeAuth();

    const videoForm = document.getElementById('videoForm');
    videoForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const formData = {
            channelId: document.getElementById('channelSelect').value || document.getElementById('manualChannelId').value,
            videoType: document.querySelector('input[name="videoType"]:checked').value,
            niche: document.getElementById('niche').value,
            keywords: document.getElementById('keywords').value,
            additionalInstructions: document.getElementById('additionalInstructions').value,
            openaiKey: document.getElementById('openaiKey').value,
            pexelsKey: document.getElementById('pexelsKey').value,
            elevenlabsKey: document.getElementById('elevenlabsKey').value,
            token: localStorage.getItem('youtubeToken')
        };
        
        if (!formData.channelId || !formData.niche || !formData.openaiKey || !formData.pexelsKey || !formData.elevenlabsKey || !formData.token) {
            console.error('Form validation failed: Missing required fields');
            showError('Please fill all required fields');
            return;
        }
        
        console.log('Submitting video creation form:', formData);
        document.getElementById('videoForm').style.display = 'none';
        document.getElementById('loadingSection').style.display = 'block';
        document.getElementById('error-message').style.display = 'none';
        document.getElementById('success-message').style.display = 'none';
        
        createVideo(formData);
    });
});

function checkYouTubeAuth() {
    const token = localStorage.getItem('youtubeToken');
    console.log('Checking auth with token from localStorage:', token);
    if (!token) {
        console.log('No token in localStorage');
        document.getElementById('videoForm').style.display = 'none';
        document.getElementById('youtubeLogin').style.display = 'block';
        return;
    }

    fetch(`/api/auth/check?token=${token}`, { credentials: 'include' })
        .then(response => {
            if (!response.ok) throw new Error('Auth check failed: ' + response.statusText);
            return response.json();
        })
        .then(data => {
            console.log('Auth check response:', data);
            const channelSelect = document.getElementById('channelSelect');
            channelSelect.innerHTML = '<option value="">-- Select a channel --</option>';
            
            if (data.authenticated) {
                if (data.channels && data.channels.length > 0) {
                    data.channels.forEach(channel => {
                        const option = document.createElement('option');
                        option.value = channel.id;
                        option.textContent = channel.name;
                        channelSelect.appendChild(option);
                    });
                    console.log('Channels loaded successfully');
                } else {
                    console.log('No channels found, allowing manual input');
                    showWarning('No channels found. Please enter your Channel ID manually below.');
                    document.getElementById('manualChannelSection').style.display = 'block';
                }
                console.log('User authenticated, showing form');
                showSuccess('Login successful! Please fill in the video details below.');
                document.getElementById('videoForm').style.display = 'block';
                document.getElementById('youtubeLogin').style.display = 'none';
            } else {
                console.log('Authentication failed:', data.error);
                showError('Authentication failed: ' + data.error);
                localStorage.removeItem('youtubeToken');
                document.getElementById('videoForm').style.display = 'none';
                document.getElementById('youtubeLogin').style.display = 'block';
            }
        })
        .catch(error => {
            console.error('Error checking authentication:', error);
            showError('Error verifying login: ' + error.message);
            localStorage.removeItem('youtubeToken');
            document.getElementById('videoForm').style.display = 'none';
            document.getElementById('youtubeLogin').style.display = 'block';
        });
}

function createVideo(formData) {
    const progressBar = document.getElementById('progressBar');
    const statusText = document.getElementById('statusText');
    const detailStatus = document.getElementById('detailStatus');
    
    fetch('/api/create-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
        credentials: 'include'
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(err => { throw new Error(err.error || 'Unknown server error'); });
        }
        return response.json();
    })
    .then(data => {
        console.log('Video creation successful:', data);
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
                }, 1000);
            }
        }
        
        setTimeout(updateProgress, 1000);
    })
    .catch(error => {
        console.error('Error during video creation:', error);
        showError('Error during video creation: ' + error.message);
        document.getElementById('videoForm').style.display = 'block';
        document.getElementById('loadingSection').style.display = 'none';
    });
}

function showSuccess(message) {
    const successDiv = document.getElementById('success-message');
    successDiv.textContent = message;
    successDiv.style.display = 'block';
}

function showError(message) {
    const errorDiv = document.getElementById('error-message');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}

function showWarning(message) {
    const errorDiv = document.getElementById('error-message');
    errorDiv.textContent = message;
    errorDiv.style.color = 'orange';
    errorDiv.style.display = 'block';
}