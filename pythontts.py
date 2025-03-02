import sys
import pyttsx3
from pathlib import Path

def generate_speech(text_file, output_file):
    print(f"Generating speech from {text_file} to {output_file}")
    with open(text_file, 'r', encoding='utf-8') as file:
        text = file.read()
    
    engine = pyttsx3.init()
    engine.setProperty('rate', 150)
    engine.setProperty('volume', 0.9)
    voices = engine.getProperty('voices')
    for voice in voices:
        if "female" in voice.name.lower():
            engine.setProperty('voice', voice.id)
            break
    
    temp_wav = str(Path(output_file).with_suffix('.wav'))
    engine.save_to_file(text, temp_wav)
    engine.runAndWait()
    
    try:
        import subprocess
        subprocess.run([
            'ffmpeg',
            '-i', temp_wav,
            '-codec:a', 'libmp3lame',
            '-qscale:a', '2',
            output_file
        ], check=True)
        Path(temp_wav).unlink()
        print(f"Speech generated successfully: {output_file}")
    except Exception as e:
        print(f"Error converting to MP3: {e}")
        Path(temp_wav).rename(output_file)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python pythontts.py input_text_file output_audio_file")
        sys.exit(1)
    generate_speech(sys.argv[1], sys.argv[2])