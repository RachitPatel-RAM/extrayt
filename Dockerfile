FROM node:16

# Install Python and pip
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg

# Set working directory
WORKDIR /app

# Copy package.json and install Node.js dependencies
COPY package.json ./
RUN npm install

# Copy Python requirements and install
COPY requirements.txt ./
RUN pip3 install -r requirements.txt

# Copy application code
COPY . .

# Create directories for temporary files
RUN mkdir -p temp/media temp/audio temp/output

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]