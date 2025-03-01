document.addEventListener('DOMContentLoaded', function() {
    checkYouTubeAuth();
    
    const videoForm = document.getElementById('videoForm');
    videoForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const formData = {
            channelId: document.getElementById('channelSelect').value,
            videoType: document.querySelector('input[name="videoType"]:checked').value,
            niche: document.getElementById('niche').value,
            keywords: document.getElementById('keywords').value,
            additionalInstructions: document.getElementById('additionalInstructions').value
        };
        
        if (!formData.channelId || !formData.niche) {
            alert('Please select a channel and enter a niche topic');
            return;
        }
        
        document.getElementById('videoForm').style.display = 'none';
        document.getElementById('loadingSection').style.display = 'block';
        
        createVideo(formData);
    });
});

function checkYouTubeAuth() {
    fetch('/api/auth/check', {
        credentials: 'include'
    })
    .then(response => response.json())
    .then(data => {
        const channelSelect = document.getElementById('channelSelect');
        channelSelect.innerHTML = '<option value="">-- Select a channel --</option>';
        
        if (data.authenticated) {
            data.channels.forEach(channel => {
                const option = document.createElement('option');
                option.value = channel.id;
                option.textContent = channel.name;
                channelSelect.appendChild(option);
            });
        } else {
            alert('Please authenticate with YouTube first. Redirecting to login...');
            window.location.href = '/auth/youtube';
        }
    })
    .catch(error => {
        console.error('Authentication check failed:', error);
        alert('Error checking authentication. Please try again.');
    });
}

function createVideo(formData) {
    const progressBar = document.getElementById('progressBar');
    const statusText = document.getElementById('statusText');
    const detailStatus = document.getElementById('detailStatus');
    
    fetch('/api/create-video', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData),
        credentials: 'include'
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Video creation failed');
        }
        return response.json();
    })
    .then(data => {
        const steps = [
            { progress: 10, message: 'Generating video script...', detail: 'Analyzing your niche and creating content' },
            { progress: 25, message: 'Finding relevant media...', detail: 'Searching for high-quality visuals' },
            { progress: 40, message: 'Generating voiceover...', detail: 'Creating narration with Kavish voice' },
            { progress: 60, message: 'Assembling video...', detail: 'Combining media with voiceover' },
            { progress: 80, message: 'Preparing for upload...', detail: 'Finalizing video and metadata' },
            { progress: 95, message: 'Uploading to YouTube...', detail: 'Uploading to your channel' },
            { progress: 100, message: 'Video Created Successfully!', detail: 'Your video is now on YouTube' }
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