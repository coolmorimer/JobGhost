"""On-device speech recognition; no audio leaves this computer."""

import io
import os
import re
import sys
import threading
from pathlib import Path

TECHNICAL_TRANSCRIPT_REPLACEMENTS = (
    (re.compile(r"\bNod\b"), "Node"),
    (re.compile(r"\bfast\s+api\b", re.IGNORECASE), "FastAPI"),
    (re.compile(r"\bкубернетес\b", re.IGNORECASE), "Kubernetes"),
)
_NVIDIA_DLL_HANDLES: list[object] = []


def configure_nvidia_dlls() -> list[str]:
    """Add NVIDIA wheel DLL folders without changing the user's global PATH."""
    if os.name != "nt" or not hasattr(os, "add_dll_directory"):
        return []
    roots = [Path(sys.prefix) / "Lib/site-packages"]
    if bundle := getattr(sys, "_MEIPASS", ""):
        roots.insert(0, Path(bundle))
    added: list[str] = []
    for root in roots:
        for relative in ("nvidia/cublas/bin",):
            folder = root / relative
            if folder.is_dir() and str(folder) not in added:
                _NVIDIA_DLL_HANDLES.append(os.add_dll_directory(str(folder)))
                added.append(str(folder))
    if added:
        # CTranslate2 resolves CUDA libraries itself with LoadLibrary; process-local PATH
        # is required in addition to Python's DLL directory handles on Windows.
        current = os.environ.get("PATH", "")
        os.environ["PATH"] = os.pathsep.join([*added, current])
    return added


def normalize_transcript(text: str) -> str:
    """Fix only high-confidence technical terms without rewriting user speech."""
    value = " ".join(text.split())
    for pattern, replacement in TECHNICAL_TRANSCRIPT_REPLACEMENTS:
        value = pattern.sub(replacement, value)
    return value


class LocalSpeech:
    def __init__(self):
        self.model = None
        self.requested_model = os.environ.get("JOBGHOST_SPEECH_MODEL", "").strip()
        self.model_name = self.requested_model or "large-v3-turbo"
        bundled = os.environ.get("JOBGHOST_SPEECH_MODEL_PATH", "")
        self.model_source = bundled if bundled and Path(bundled).is_dir() else ""
        self.lock = threading.Lock()
        self.state = "not_loaded"
        self.error = None
        self.device = "не выбран"
        self.compute_type = ""

    @staticmethod
    def _runtime_options() -> list[tuple[str, str]]:
        """Prefer NVIDIA CUDA, but keep startup recoverable on machines without it."""
        requested = os.environ.get("JOBGHOST_SPEECH_DEVICE", "auto").strip().lower()
        if requested == "cpu":
            return [("cpu", "int8")]
        if requested == "cuda":
            return [("cuda", "float16")]
        try:
            import ctranslate2

            if "float16" in ctranslate2.get_supported_compute_types("cuda"):
                return [("cuda", "float16"), ("cpu", "int8")]
        except Exception:
            pass
        return [("cpu", "int8")]

    def load(self):
        with self.lock:
            if self.model is not None:
                return
            self.state = "loading"
            try:
                configure_nvidia_dlls()
                from faster_whisper import WhisperModel

                cache = Path(os.environ['JOBGHOST_USER_DATA']) / 'models' if os.environ.get('JOBGHOST_USER_DATA') else Path(__file__).resolve().parents[3] / '.jobghost/models'
                failures: list[str] = []
                for device, compute_type in self._runtime_options():
                    try:
                        source = self.model_source or self.requested_model or (
                            "large-v3-turbo" if device == "cuda" else "small"
                        )
                        candidate = WhisperModel(
                            source,
                            device=device,
                            compute_type=compute_type,
                            download_root=str(cache),
                            cpu_threads=max(4, min(8, os.cpu_count() or 4)),
                            num_workers=1,
                        )
                        if device == "cuda":
                            import numpy as np

                            probe, _ = candidate.transcribe(
                                np.zeros(3200, dtype=np.float32),
                                language="ru",
                                beam_size=1,
                                vad_filter=False,
                                without_timestamps=True,
                            )
                            list(probe)  # Force the first CUDA encoder call before reporting ready.
                        self.model = candidate
                        self.device = "NVIDIA CUDA" if device == "cuda" else "CPU"
                        self.compute_type = compute_type
                        self.model_name = (
                            self.requested_model or "large-v3-turbo"
                            if Path(source).is_dir()
                            else source
                        )
                        break
                    except Exception as exc:
                        failures.append(f"{device}: {type(exc).__name__}")
                if self.model is None:
                    raise RuntimeError(", ".join(failures))
                self.state = "ready"
                self.error = None
            except Exception:
                self.state = "error"
                self.error = "Не удалось загрузить локальную модель речи. Проверьте соединение при первой загрузке."
                raise

    def transcribe(
        self, content: bytes, *, language: str | None = None, context: str = ""
    ) -> dict:
        if self.model is None:
            raise ValueError("Сначала загрузите модель речи")
        from faster_whisper.audio import decode_audio

        audio = decode_audio(io.BytesIO(content), sampling_rate=16000)
        if not 1600 <= len(audio) <= 16000 * 30:
            raise ValueError("Допустима запись от 0.1 до 30 секунд")
        with self.lock:
            segments, info = self.model.transcribe(
                audio,
                language=language if language in {"ru", "en"} else None,
                beam_size=1,
                best_of=1,
                temperature=0,
                without_timestamps=True,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 700, "speech_pad_ms": 250},
                condition_on_previous_text=False,
                initial_prompt=(
                    "Техническое интервью на русском или английском. Technical interview in "
                    "Russian or English. Python, JavaScript, TypeScript, React, Kubernetes, "
                    f"Docker, SQL, API, DevOps. Предыдущий текст: {context[-500:]}"
                ),
            )
            text = normalize_transcript(
                " ".join(s.text.strip() for s in segments if s.no_speech_prob < 0.7)
            )
        return {
            "text": text,
            "language": info.language,
            "language_probability": round(float(info.language_probability), 3),
            "local": True,
            "engine": "local",
        }


speech = LocalSpeech()
