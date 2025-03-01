import sys
import pyttsx3 # type: ignore
from pathlib import Path

def generate_speech(text_file, output_file):
    """
    Generate speech from text file and save to an audio file (fallback method).
    
    Args:
        text_file (str): Path to the text file containing the script
        output_file (str): Path where the audio file will be saved
    """
    print(f"Generating speech from {text_file} to {output_file}")
    
    # Read the text file
    with open(text_file, 'r', encoding='utf-8') as file:
        text = file.read()
    
    # Initialize the TTS engine
    engine = pyttsx3.init()
    
    # Adjust voice properties
    engine.setProperty('rate', 150)  # Speech speed
    engine.setProperty('volume', 0.9)  # Volume (0.0 to 1.0)
    
    # Try to set a female voice for better narration quality
    voices = engine.getProperty('voices')
    for voice in voices:
        if "female" in voice.name.lower():
            engine.setProperty('voice', voice.id)
            break
    
    # Save as WAV temporarily, then convert to MP3
    temp_wav = str(Path(output_file).with_suffix('.wav'))
    engine.save_to_file(text, temp_wav)
    engine.runAndWait()
    
    try:
        # Convert WAV to MP3 using FFmpeg
        import subprocess
        subprocess.run([
            'ffmpeg',
            '-i', temp_wav,
            '-codec:a', 'libmp3lame',
            '-qscale:a', '2',  # High quality
            output_file
        ], check=True)
        
        # Clean up temporary WAV file
        Path(temp_wav).unlink()
        
        print(f"Speech generated successfully: {output_file}")
    except Exception as e:
        print(f"Error converting to MP3: {e}")
        print(f"Using WAV file instead: {temp_wav}")
        Path(temp_wav).rename(output_file)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python pythontts.py input_text_file output_audio_file")
        sys.exit(1)
    
    text_file = sys.argv[1]
    output_file = sys.argv[2]
    generate_speech(text_file, output_file)