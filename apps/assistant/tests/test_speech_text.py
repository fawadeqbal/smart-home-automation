"""Replies are written in light Markdown for the chat; the voice must not read the symbols."""
from assistant.speech.tts import clean_for_speech


def test_steps_and_bold_are_spoken_as_sentences():
    reply = "To add your brother:\n\n1. Open **People**.\n2. Tap **Invite someone**\n3. Pick **Family**"
    assert clean_for_speech(reply) == "To add your brother: Open People. Tap Invite someone. Pick Family"


def test_lists_links_and_headings_lose_their_signs():
    reply = "## Offline\n- **Kitchen board** at Iyer apartment\n- Living room board\n\nSee [Wi-Fi changed](/help?a=x) in Help."
    assert clean_for_speech(reply) == "Offline. Kitchen board at Iyer apartment. Living room board. See Wi-Fi changed in Help."


def test_plain_sentences_stay_as_they_are():
    assert clean_for_speech("Done, the fan is on. It is 25°C.") == "Done, the fan is on. It is 25 degrees."
    assert clean_for_speech("Batti band kar di?") == "Batti band kar di?"
    assert clean_for_speech("بتی بند کر دی گئی ہے۔") == "بتی بند کر دی گئی ہے۔"
