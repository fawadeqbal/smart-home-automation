"""The Urdu voice: English names inside an Urdu reply are spoken, and the natural voice is preferred."""
from pathlib import Path

from assistant.config import Settings
from assistant.speech.tts import ChainTTS, EspeakTTS, UrduPiperTTS, create_tts
from assistant.speech.urdu import by_sound, for_urdu_voice, urdu_word


def test_known_words_become_urdu_script():
    said = for_urdu_voice("جی، Bedroom کا Fan آن ہے")
    assert "بیڈروم" in said and "فین" in said
    assert not any("a" <= c.lower() <= "z" for c in said)


def test_abbreviations_are_spelled_out():
    assert urdu_word("AC") == "اے سی"
    assert urdu_word("TV") == "ٹی وی"
    assert urdu_word("UPS") == "یو پی ایس"


def test_unknown_words_go_by_sound():
    word = urdu_word("Sofa")
    assert word and all("؀" <= c <= "ۿ" for c in word)
    assert by_sound("gate").endswith("ٹ")              # the last "e" is silent


def test_english_replies_are_left_alone():
    assert for_urdu_voice("Done, the Bedroom Fan is off.") == "Done, the Bedroom Fan is off."
    assert for_urdu_voice("Theek hai, fan band kar diya") == "Theek hai, fan band kar diya"


def test_the_urdu_piper_voice_hears_urdu_script_only():
    voice = UrduPiperTTS(Path("missing.onnx"))
    seen = []
    voice._load = lambda: object()                       # noqa: E731 - no real model in tests
    import assistant.speech.tts as tts_module
    original = tts_module.PiperTTS.synthesize
    tts_module.PiperTTS.synthesize = lambda self, text: seen.append(text) or b"wav"
    try:
        assert voice.synthesize("Kitchen کی Light بند ہے") == b"wav"
    finally:
        tts_module.PiperTTS.synthesize = original
    assert seen == ["کچن کی لائٹ بند ہے"]


def test_the_natural_urdu_voice_comes_first_when_installed(tmp_path):
    model = tmp_path / "ur.onnx"
    model.write_bytes(b"x")
    tts = create_tts(tmp_path / "en.onnx", model)
    assert isinstance(tts, ChainTTS)
    assert isinstance(tts._urdu[0], UrduPiperTTS) and isinstance(tts._urdu[-1], EspeakTTS)


def test_without_the_model_urdu_uses_espeak(tmp_path):
    tts = create_tts(tmp_path / "en.onnx", tmp_path / "missing.onnx")
    assert [type(v) for v in tts._urdu] == [EspeakTTS]
    assert [type(v) for v in create_tts(tmp_path / "en.onnx", None)._urdu] == [EspeakTTS]


def test_the_urdu_voice_can_be_turned_off(monkeypatch):
    monkeypatch.setenv("URDU_PIPER_MODEL", "off")
    assert Settings.from_env().urdu_piper_model is None
    monkeypatch.setenv("URDU_PIPER_MODEL", "")
    assert Settings.from_env().urdu_piper_model is not None    # empty in compose means the default
