#!/usr/bin/env python3
"""
Coqui TTS fallback script for YouTube AI Platform.
Used when the Coqui API server is unavailable.
"""

import argparse
import sys


def main():
    parser = argparse.ArgumentParser(description='Coqui TTS fallback')
    parser.add_argument('--text', type=str, required=True, help='Text to synthesize')
    parser.add_argument('--output', type=str, required=True, help='Output audio file path')
    parser.add_argument('--language', type=str, default='en', help='Language code')

    args = parser.parse_args()

    try:
        from TTS.api import TTS

        tts = TTS(model_name="tts_models/en/ljspeech/tacotron2-DDC", progress_bar=False, gpu=False)
        tts.tts_to_file(text=args.text, file_path=args.output)
        print(f"TTS generated successfully: {args.output}")
    except ImportError:
        print("TTS library not installed. Install with: pip install TTS", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"TTS generation failed: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
