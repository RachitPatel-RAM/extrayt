document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, setting up login and form...');
    
    // Handle "Login with YouTube" button click
    const youtubeLoginButton = document.getElementById('youtubeLogin');
    youtubeLoginButton.addEventListener('click', function() {
        console.log('Login with YouTube clicked, redirecting to server OAuth...');
        window.location.href = '/auth/youtube';
    });

    // Check authentication status on page load
    checkYouTubeAuth();

    // Handle form submission
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
            elevenlabsKey: document.getElementById('elevenlabsKey').value
        };
        
        if (!formData.channelId || !formData.niche || !formData.openaiKey || !formData.pexelsKey || !formData.elevenlabsKey) {
            console.error('Form validation failed: Missing required fields');
            showError('Please fill all required fields');
            return;
        }
        
        console.log('Submitting video creation form:', formData);
        document.getElementById('videoForm').style.display = 'none';
        document.getElementById('loadingSection').style.display = 'block';
        document.getElementById('error-message').style.display = 'none';
        
        createVideo(formData);
    });
});

function checkYouTubeAuth() {
    fetch('/api/auth/check', { credentials: 'include' })
        .then(response => {
            if (!response.ok) throw new Error('Auth check failed');
            return response.json();
        })
        .then(data => {
            console.log('Auth check response:', data);
            const channelSelect = document.getElementById('channelSelect');
            channelSelect.innerHTML = '<option value="">-- Select a channel --</option>';
            
            if (data.authenticated && data.channels && data.channels.length > 0) {
                data.channels.forEach(channel => {
                    const option = document.createElement('option');
                    option.value = channel.id;
                    option.textContent = channel.name;
                    channelSelect.appendChild(option);
                });
                document.getElementById('videoForm').style.display = 'block';
                document.getElementById('youtubeLogin').style.display = 'none';
            } else {
                console.log('User not authenticated or no channels found');
                document.getElementById('videoForm').style.display = 'none';
                document.getElementById('youtubeLogin').style.display = 'block';
            }
        })
        .catch(error => {
            console.error('Error checking authentication:', error);
            showError('Error checking authentication. Please try again.');
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
            throw new Error('Video creation failed: ' + response.statusText);
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
        showError('An error occurred during video creation. Please try again.');
        document.getElementById('videoForm').style.display = 'block';
        document.getElementById('loadingSection').style.display = 'none';
    });
}

function showError(message) {
    const errorDiv = document.getElementById('error-message');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}