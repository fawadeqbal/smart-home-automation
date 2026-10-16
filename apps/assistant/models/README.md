Put the Piper voice here (both files), e.g. from your old pi-voice-assistant/voices folder:

    en_US-lessac-medium.onnx
    en_US-lessac-medium.onnx.json

Download: https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/lessac/medium
The Whisper speech model downloads itself the first time someone speaks.

For natural Urdu replies, also put the Urdu Piper voice here (both files):

    ur_PK-fasih-medium.onnx
    ur_PK-fasih-medium.onnx.json

Download: https://huggingface.co/rhasspy/piper-voices/tree/main/ur/ur_PK/fasih/medium
The server's deploy downloads it by itself. Without it, Urdu replies use espeak-ng's Urdu voice.
Set URDU_PIPER_MODEL=off to use espeak-ng anyway.
