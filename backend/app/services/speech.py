"""On-device speech recognition; no audio leaves this computer."""

import io
import os
import threading
from pathlib import Path


class LocalSpeech:
    def __init__(self):
        self.model = None
        self.model_name = os.environ.get("JOBGHOST_SPEECH_MODEL", "small")
        bundled = os.environ.get("JOBGHOST_SPEECH_MODEL_PATH", "")
        self.model_source = bundled if bundled and Path(bundled).is_dir() else self.model_name
        self.lock = threading.Lock()
        self.state = "not_loaded"
        self.error = None

    def load(self):
        with self.lock:
            if self.model is not None:
                return
            self.state = "loading"
            try:
                from faster_whisper import WhisperModel

                cache = Path(os.environ['JOBGHOST_USER_DATA']) / 'models' if os.environ.get('JOBGHOST_USER_DATA') else Path(__file__).resolve().parents[3] / '.jobghost/models'
                self.model = WhisperModel(
                    self.model_source,
                    device="cpu",
                    compute_type="int8",
                    download_root=str(cache),
                    cpu_threads=4,
                )
                self.state = "ready"
                self.error = None
            except Exception:
                self.state = "error"
                self.error = "Не удалось загрузить локальную модель речи. Проверьте соединение при первой загрузке."
                raise

    def transcribe(self, content: bytes) -> dict:
        if self.model is None:
            raise ValueError("Сначала загрузите модель речи")
        from faster_whisper.audio import decode_audio

        audio = decode_audio(io.BytesIO(content), sampling_rate=16000)
        if not 1600 <= len(audio) <= 16000 * 30:
            raise ValueError("Допустима запись от 0.1 до 30 секунд")
        with self.lock:
            segments, info = self.model.transcribe(
                audio,
                language=None,
                beam_size=3,
                best_of=3,
                temperature=0,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 350, "speech_pad_ms": 250},
                condition_on_previous_text=False,
                initial_prompt=(
                    "Техническое интервью на русском или английском. Technical interview in "
                    "Russian or English. Python, JavaScript, TypeScript, React, Kubernetes, "
                    "Docker, SQL, API, DevOps."
                ),
            )
            text = " ".join(s.text.strip() for s in segments if s.no_speech_prob < 0.7)
        return {
            "text": text,
            "language": info.language,
            "language_probability": round(float(info.language_probability), 3),
            "local": True,
        }


speech = LocalSpeech()
