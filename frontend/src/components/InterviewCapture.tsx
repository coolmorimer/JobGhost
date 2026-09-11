import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChatAnswer } from "./ChatAnswer";
import { assistantContext, preparationOptions } from "./assistantContext";
import { ChatPairing } from "./ChatPairing";
import { RealtimeTranscriber } from "./RealtimeTranscriber";
import { SerialWorkQueue } from "./SerialWorkQueue";
import { VoiceUtteranceAssembler } from "./VoiceUtteranceAssembler";
import { speechLabel } from "../labels";

type CaptureKind = "display" | "mic";
type SpeechEngine = "local" | "openai";
type CaptureStream = {
  stream: MediaStream;
  source: string;
  kind: CaptureKind;
  node?: MediaStreamAudioSourceNode;
  recorder?: MediaRecorder;
  recorderTimer?: ReturnType<typeof setInterval>;
  live?: RealtimeTranscriber;
  assembler: VoiceUtteranceAssembler;
  language?: "ru" | "en";
  speechToken: number;
  draftId?: number;
};
type VoiceLine = {
  id: number;
  text: string;
  source: string;
  question: boolean;
  language: string;
  complete: boolean;
};

function savedBoolean(key: string, fallback: boolean) {
  const value = localStorage.getItem(key);
  return value === null ? fallback : value === "true";
}
function looksLikeInterviewQuestion(text: string) {
  const value = text.trim().toLocaleLowerCase();
  return (
    /[?？]\s*$/.test(value) ||
    /^(что|кто|где|когда|зачем|почему|как|какие|какой|расскажите|объясните|опишите|сравните|можете|приведите|what|who|where|when|why|how|which|tell me|explain|describe|compare|could you|would you|walk me through)\b/u.test(
      value,
    )
  );
}

export function InterviewCapture() {
  const video = useRef<HTMLVideoElement>(null),
    streams = useRef<CaptureStream[]>([]),
    audio = useRef<AudioContext | null>(null),
    destination = useRef<MediaStreamAudioDestinationNode | null>(null),
    analyserSource = useRef<MediaStreamAudioSourceNode | null>(null);
  const meter = useRef<ReturnType<typeof setInterval> | null>(null),
    epoch = useRef(0),
    transcriptSequence = useRef(0),
    speechLoadRequested = useRef(false);
  const [speechQueue] = useState(() => new SerialWorkQueue(8));
  const [screen, setScreen] = useState(false),
    [mic, setMic] = useState(false),
    [systemAudio, setSystemAudio] = useState(false),
    [level, setLevel] = useState(0),
    [error, setError] = useState("");
  const [resumeId, setResumeId] = useState(
      () => localStorage.getItem("jobghost-interview-resume") || "",
    ),
    [roleReady, setRoleReady] = useState(""),
    [busy, setBusy] = useState(false),
    [snapshot, setSnapshot] = useState("");
  const [contextMode, setContextMode] = useState(()=>localStorage.getItem('jobghost-context-mode') || 'resume');
  const [customPrompt, setCustomPrompt] = useState(()=>localStorage.getItem('jobghost-custom-prompt') || '');
  const [queued, setQueued] = useState(0),
    [dropped, setDropped] = useState(0),
    [speechEnabled, setSpeechEnabled] = useState(() =>
      savedBoolean("jobghost-speech-enabled", true),
    );
  const [speechEngine, setSpeechEngine] = useState<SpeechEngine>(() =>
    localStorage.getItem("jobghost-speech-engine") === "openai"
      ? "openai"
      : "local",
  );
  const [wantScreen, setWantScreen] = useState(() =>
      savedBoolean("jobghost-capture-screen", true),
    ),
    [wantMic, setWantMic] = useState(() =>
      savedBoolean("jobghost-capture-mic", true),
    );
  const [latestVoice, setLatestVoice] = useState<VoiceLine>(),
    [transcript, setTranscript] = useState<VoiceLine[]>([]);

  useEffect(() => {
    void window.jobghostDesktop?.setCapture?.(screen || mic).catch(() => {});
  }, [screen, mic]);
  const speechStatus = useQuery({
    queryKey: ["speech"],
    queryFn: async () => {
      const response = await fetch("/api/speech/status");
      if (!response.ok) throw new Error("Сервис речи недоступен");
      return response.json();
    },
    refetchInterval: 3000,
  });
  const speechReady =
    speechEngine === "openai"
      ? Boolean(speechStatus.data?.openai_ready)
      : speechStatus.data?.state === "ready";
  const resumes = useQuery({
    queryKey: ["resumes"],
    queryFn: async () => {
      const response = await fetch("/api/resumes");
      if (!response.ok) throw Error("Не удалось загрузить резюме");
      return response.json() as Promise<
        {
          id: string;
          name: string;
          hh_resume_id?: string;
          is_active: boolean;
        }[]
      >;
    },
  });
  useEffect(() => {
    if (!resumes.data?.length) return;
    const available = resumes.data.filter((item) => item.is_active);
    if (available.some((item) => item.id === resumeId)) return;
    const preferred =
      available.find((item) => item.hh_resume_id) || available[0];
    if (preferred) {
      setResumeId(preferred.id);
      localStorage.setItem("jobghost-interview-resume", preferred.id);
    }
  }, [resumes.data, resumeId]);
  useEffect(() => {
    if (
      speechEngine !== "local" ||
      speechStatus.data?.state !== "not_loaded" ||
      speechLoadRequested.current
    )
      return;
    speechLoadRequested.current = true;
    void fetch("/api/speech/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
      .then(() => speechStatus.refetch())
      .catch(() =>
        setError("Не удалось подготовить локальное распознавание речи"),
      );
  }, [speechEngine, speechStatus]);
  useEffect(() => {
    speechQueue.onChange = setQueued;
    speechQueue.onError = () => setError("Ошибка очереди распознавания");
    return () => {
      speechQueue.onChange = undefined;
      speechQueue.onError = undefined;
      speechQueue.clear();
    };
  }, [speechQueue]);

  function publish(
    item: CaptureStream,
    text: string,
    complete: boolean,
    language = item.language || "auto",
    isQuestion?: boolean,
  ) {
    const value = text.trim();
    if (!value) return;
    const id = item.draftId || (item.draftId = ++transcriptSequence.current);
    const line: VoiceLine = {
      id,
      text: value,
      source: item.source,
      question: complete && (isQuestion ?? looksLikeInterviewQuestion(value)),
      language,
      complete,
    };
    setLatestVoice(line);
    if (complete) {
      setTranscript((items) => [...items, line].slice(-30));
      item.draftId = undefined;
    }
  }
  async function sendAudio(
    blob: Blob,
    item: CaptureStream,
    generation: number,
    token: number,
  ) {
    if (
      generation !== epoch.current ||
      token !== item.speechToken ||
      !blob.size
    )
      return;
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (generation !== epoch.current || token !== item.speechToken) return;
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const response = await fetch("/api/speech/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audio: btoa(binary),
          mime_type: blob.type || "audio/webm",
          engine: "local",
          language: item.language,
          context: item.assembler.context(),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.detail || "Ошибка распознавания");
      if (generation !== epoch.current || token !== item.speechToken) return;
      if (
        (result.language === "ru" || result.language === "en") &&
        Number(result.language_probability) >= 0.65
      )
        item.language = result.language;
      const utterance = item.assembler.add({
        text: result.text || "",
        isQuestion: Boolean(result.is_question),
        language: result.language || item.language || "auto",
      });
      if (utterance)
        publish(
          item,
          utterance.text,
          utterance.complete,
          utterance.language,
          utterance.isQuestion,
        );
    } catch (e) {
      if (generation === epoch.current && token === item.speechToken)
        setError(e instanceof Error ? e.message : "Ошибка речи");
    }
  }
  function stopSpeech(item: CaptureStream) {
    item.speechToken++;
    if (item.recorderTimer) clearInterval(item.recorderTimer);
    item.recorderTimer = undefined;
    if (item.recorder) {
      item.recorder.onstop = null;
      if (item.recorder.state !== "inactive") item.recorder.stop();
    }
    item.recorder = undefined;
    item.live?.stop();
    item.live = undefined;
    item.assembler.clear();
    item.language = undefined;
    item.draftId = undefined;
  }
  function startLocalRecorder(item: CaptureStream) {
    if (
      item.recorder ||
      !item.stream.getAudioTracks().some((track) => track.readyState === "live")
    )
      return;
    const generation = epoch.current,
      token = ++item.speechToken;
    const active = new MediaRecorder(
      new MediaStream(item.stream.getAudioTracks()),
    );
    item.recorder = active;
    active.ondataavailable = (event) => {
      if (
        generation !== epoch.current ||
        token !== item.speechToken ||
        !event.data.size
      )
        return;
      if (
        !speechQueue.enqueue(() =>
          sendAudio(event.data, item, generation, token),
        )
      ) {
        setDropped((value) => value + 1);
        setError(
          `Распознавание ${item.source.toLocaleLowerCase()} не успевает: фрагмент пропущен.`,
        );
      }
    };
    active.onstop = () => {
      if (
        generation === epoch.current &&
        token === item.speechToken &&
        item.recorder === active &&
        item.stream
          .getAudioTracks()
          .some((track) => track.readyState === "live")
      )
        active.start();
    };
    active.start();
    item.recorderTimer = setInterval(() => {
      if (active.state === "recording") active.stop();
    }, 2500);
  }
  function startLive(item: CaptureStream) {
    if (
      item.live ||
      !item.stream.getAudioTracks().some((track) => track.readyState === "live")
    )
      return;
    const generation = epoch.current,
      token = ++item.speechToken;
    const live = new RealtimeTranscriber(item.stream, {
      onPartial: (text) => {
        if (generation === epoch.current && token === item.speechToken)
          publish(item, text, false);
      },
      onFinal: (text) => {
        if (generation === epoch.current && token === item.speechToken)
          publish(item, text, true);
      },
      onError: (message) => {
        if (generation === epoch.current && token === item.speechToken)
          setError(`${item.source}: ${message}`);
      },
    });
    item.live = live;
    void live.start().catch((e) => {
      if (generation === epoch.current && token === item.speechToken)
        setError(
          `${item.source}: ${e instanceof Error ? e.message : "OpenAI Live недоступен"}`,
        );
    });
  }
  function startSpeech(item: CaptureStream) {
    if (!speechEnabled || !speechReady) return;
    if (speechEngine === "openai") startLive(item);
    else startLocalRecorder(item);
  }
  useEffect(() => {
    streams.current.forEach((item) => {
      stopSpeech(item);
      if (speechEnabled && speechReady) startSpeech(item);
    });
    // Capture objects own their pipelines; rebuilding them here is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speechEnabled, speechReady, speechEngine]);

  function stop() {
    epoch.current++;
    speechQueue.clear();
    streams.current.forEach((item) => {
      stopSpeech(item);
      item.node?.disconnect();
      item.stream.getTracks().forEach((track) => track.stop());
    });
    streams.current = [];
    if (meter.current) clearInterval(meter.current);
    if (audio.current) void audio.current.close();
    audio.current = null;
    destination.current = null;
    analyserSource.current = null;
    if (video.current) video.current.srcObject = null;
    setScreen(false);
    setMic(false);
    setSystemAudio(false);
    setLevel(0);
  }
  useEffect(
    () => () => {
      epoch.current++;
      speechQueue.clear();
      streams.current.forEach((item) => {
        stopSpeech(item);
        item.node?.disconnect();
        item.stream.getTracks().forEach((track) => track.stop());
      });
      if (meter.current) clearInterval(meter.current);
      if (audio.current) void audio.current.close();
    },
    [speechQueue],
  );
  function refreshCaptureState() {
    const display = streams.current.some(
      (item) =>
        item.kind === "display" &&
        item.stream
          .getVideoTracks()
          .some((track) => track.readyState === "live"),
    );
    const microphone = streams.current.some(
      (item) =>
        item.kind === "mic" &&
        item.stream
          .getAudioTracks()
          .some((track) => track.readyState === "live"),
    );
    const desktopSound = streams.current.some(
      (item) =>
        item.kind === "display" &&
        item.stream
          .getAudioTracks()
          .some((track) => track.readyState === "live"),
    );
    setScreen(display);
    setMic(microphone);
    setSystemAudio(desktopSound);
    if (!display && video.current) video.current.srcObject = null;
  }
  function removeCapture(item: CaptureStream) {
    if (!streams.current.includes(item)) return;
    streams.current = streams.current.filter((current) => current !== item);
    stopSpeech(item);
    item.node?.disconnect();
    item.stream.getTracks().forEach((track) => {
      if (track.readyState === "live") track.stop();
    });
    refreshCaptureState();
  }
  function stopKind(kind: CaptureKind) {
    streams.current.filter((item) => item.kind === kind).forEach(removeCapture);
  }
  async function connectAudio(item: CaptureStream) {
    if (!item.stream.getAudioTracks().length) return;
    const context = audio.current || new AudioContext();
    audio.current = context;
    await context.resume();
    const target =
      destination.current || context.createMediaStreamDestination();
    destination.current = target;
    item.node = context.createMediaStreamSource(
      new MediaStream(item.stream.getAudioTracks()),
    );
    item.node.connect(target);
    if (!analyserSource.current) {
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyserSource.current = context.createMediaStreamSource(target.stream);
      analyserSource.current.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      meter.current = setInterval(() => {
        analyser.getByteTimeDomainData(samples);
        const rms = Math.sqrt(
          samples.reduce((sum, n) => sum + ((n - 128) / 128) ** 2, 0) /
            samples.length,
        );
        setLevel(Math.min(100, Math.round(rms * 300)));
      }, 100);
    }
    startSpeech(item);
  }
  async function capture(display: boolean): Promise<boolean> {
    setBusy(true);
    setError("");
    const generation = epoch.current;
    try {
      const stream = display
        ? await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: 5 },
            audio: true,
          })
        : await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
          });
      if (generation !== epoch.current) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      const item: CaptureStream = {
        stream,
        source: display ? "Собеседник" : "Микрофон",
        kind: display ? "display" : "mic",
        assembler: new VoiceUtteranceAssembler(),
        speechToken: 0,
      };
      streams.current.push(item);
      stream.getTracks().forEach((track) =>
        track.addEventListener("ended", () => removeCapture(item), {
          once: true,
        }),
      );
      if (display) {
        setScreen(true);
        setSystemAudio(stream.getAudioTracks().length > 0);
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play();
        }
      } else setMic(true);
      await connectAudio(item);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось включить захват");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function startSession() {
    setError("");
    setRoleReady("");
    if (contextMode === 'resume' && !resumeId) {
      setError("Сначала выберите резюме для роли ИИ в настройках.");
      return { screen: false, mic: false };
    }
    const roleResponse = await fetch("/api/ai/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({...assistantContext(), ...preparationOptions()}),
    });
    const role = await roleResponse.json();
    if (!roleResponse.ok) {
      setError(
        typeof role.detail === "string"
          ? role.detail
          : "Не удалось загрузить роль по резюме",
      );
      return { screen: false, mic: false };
    }
    sessionStorage.setItem('jobghost-session', role.session_id);
    window.dispatchEvent(new Event('jobghost-new-session'));
    setRoleReady(`Роль загружена: ${role.resume}`);
    if (!wantScreen && !wantMic) {
      setError(
        "Включите хотя бы один источник: микрофон или звук собеседника.",
      );
      return { screen: false, mic: false };
    }
    const hasScreen = !wantScreen ? false : screen || (await capture(true));
    const hasMic = !wantMic ? false : mic || (await capture(false));
    return { screen: hasScreen, mic: hasMic };
  }
  function currentSnapshot() {
    if (
      !video.current?.videoWidth ||
      !streams.current.some((item) =>
        item.stream
          .getVideoTracks()
          .some((track) => track.readyState === "live"),
      )
    )
      throw Error(
        "Сначала включите источник «Звук собеседника» и выберите экран.",
      );
    const canvas = document.createElement("canvas"),
      scale = Math.min(
        1,
        1920 / video.current.videoWidth,
        1080 / video.current.videoHeight,
      );
    canvas.width = Math.max(1, Math.round(video.current.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.current.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw Error("Не удалось создать снимок экрана");
    context.drawImage(video.current, 0, 0, canvas.width, canvas.height);
    const value = canvas.toDataURL("image/jpeg", 0.85);
    if (value.length > 4000000)
      throw Error(
        "Снимок слишком большой. Выберите отдельное окно меньшего размера.",
      );
    setSnapshot(value);
    return value;
  }
  function takeSnapshot() {
    try {
      const value = currentSnapshot();
      setError("");
      return value;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сделать снимок");
      return undefined;
    }
  }
  async function captureManualScreen() {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
    try {
      const frame = document.createElement("video");
      frame.muted = true;
      frame.srcObject = stream;
      await frame.play();
      if (!frame.videoWidth)
        throw Error(
          "Изображение экрана ещё не готово. Попробуйте выбрать источник снова.",
        );
      const canvas = document.createElement("canvas");
      const scale = Math.min(
        1,
        1920 / frame.videoWidth,
        1080 / frame.videoHeight,
      );
      canvas.width = Math.max(1, Math.round(frame.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(frame.videoHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw Error("Не удалось получить снимок");
      context.drawImage(frame, 0, 0, canvas.width, canvas.height);
      const value = canvas.toDataURL("image/jpeg", 0.88);
      if (value.length > 4000000)
        throw Error("Снимок слишком большой. Выберите отдельное окно.");
      return value;
    } finally {
      stream.getTracks().forEach((track) => track.stop());
    }
  }
  async function chooseRegionSnapshot() {
    return captureManualScreen();
  }
  useEffect(() =>
    window.jobghostDesktop?.onAction((action) => {
      if (action === "stop") stop();
    }),
  );
  function savePreference(kind: CaptureKind, value: boolean) {
    if (kind === "display") {
      setWantScreen(value);
      localStorage.setItem("jobghost-capture-screen", String(value));
    } else {
      setWantMic(value);
      localStorage.setItem("jobghost-capture-mic", String(value));
    }
  }
  async function toggleSource(kind: CaptureKind) {
    const active = kind === "display" ? screen : mic;
    if (active) {
      stopKind(kind);
      savePreference(kind, false);
      return;
    }
    const sessionActive = screen || mic,
      preferred = kind === "display" ? wantScreen : wantMic;
    savePreference(kind, !preferred || sessionActive);
    if (sessionActive) await capture(kind === "display");
  }
  const engineLabel = speechEngine === "openai" ? "OpenAI Live" : "Локально",
    sessionActive = screen || mic;
  const captureControls = (
    <div className="quick-capture" aria-label="Источники разговора">
      <button
        className={(sessionActive ? systemAudio : wantScreen) ? "active" : ""}
        aria-pressed={sessionActive ? systemAudio : wantScreen}
        disabled={busy}
        onClick={() => void toggleSource("display")}
      >
        🔊 Собеседник{" "}
        <b>
          {sessionActive
            ? systemAudio
              ? "ВКЛ"
              : "выкл"
            : wantScreen
              ? "при старте"
              : "не нужен"}
        </b>
      </button>
      <button
        className={(sessionActive ? mic : wantMic) ? "active" : ""}
        aria-pressed={sessionActive ? mic : wantMic}
        disabled={busy}
        onClick={() => void toggleSource("mic")}
      >
        🎙 Микрофон{" "}
        <b>
          {sessionActive
            ? mic
              ? "ВКЛ"
              : "выкл"
            : wantMic
              ? "при старте"
              : "не нужен"}
        </b>
      </button>
      <span>
        Речь: {speechEnabled ? engineLabel : "выключена"}
        {queued ? ` · обработка ${queued}` : ""}
      </span>
    </div>
  );
  return (
    <ChatAnswer
      latestQuestion={latestVoice?.text || ""}
      latestQuestionKey={latestVoice?.id}
      latestQuestionSource={
        latestVoice
          ? `${latestVoice.source} · ${latestVoice.language.toUpperCase()}${latestVoice.complete ? "" : " · слушаю…"}`
          : undefined
      }
      latestQuestionDetected={latestVoice?.question}
      snapshot={snapshot}
      getSnapshot={currentSnapshot}
      onChooseRegion={chooseRegionSnapshot}
      onCaptureFullScreen={captureManualScreen}
      onStartSession={startSession}
      sessionActive={sessionActive}
      onStop={stop}
      onSnapshot={takeSnapshot}
      captureControls={captureControls}
      captureStatus={`Экран: ${screen ? "ВКЛ" : "выкл"} · Микрофон: ${mic ? "ВКЛ" : "выкл"} · Собеседник: ${systemAudio ? "ВКЛ" : "выкл"}${error ? " · " + error : ""}`}
      connectionContent={<ChatPairing />}
      settingsContent={
        <>
          <h2>Роль ИИ</h2>
          <label>Контекст помощника <select aria-label="Контекст помощника" value={contextMode} disabled={sessionActive} onChange={event=>{setContextMode(event.target.value);localStorage.setItem('jobghost-context-mode',event.target.value);setRoleReady('');}}>
            <option value="resume">По резюме</option><option value="custom">Свой промпт</option>
          </select></label>
          {contextMode === 'custom' ? <label>Свой промпт <textarea aria-label="Свой промпт" rows={7} maxLength={12000} value={customPrompt} disabled={sessionActive} placeholder="Как помощник должен отвечать и какой контекст учитывать" onChange={event=>{setCustomPrompt(event.target.value);localStorage.setItem('jobghost-custom-prompt',event.target.value);setRoleReady('');}}/><small>Резюме не отправляется. Промпт хранится локально и передаётся выбранному ИИ. Для смены контекста остановите сессию.</small></label> : <label>
            Резюме для ответов{" "}
            <select
              aria-label="Резюме для роли ИИ"
              value={resumeId}
              disabled={sessionActive}
              onChange={(event) => {
                setResumeId(event.target.value);
                localStorage.setItem(
                  "jobghost-interview-resume",
                  event.target.value,
                );
                setRoleReady("");
              }}
            >
              <option value="">Выберите резюме</option>
              {resumes.data
                ?.filter((item) => item.is_active)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.hh_resume_id ? " · HH" : ""}
                  </option>
                ))}
            </select>
          </label>}
          <p>
            {contextMode === 'custom' ? 'OpenAI и OpenRouter получают ваш промпт в каждом запросе, ChatGPT — в начале сессии. Старые сообщения в браузерном чате не удаляются; для чистого контекста нужен новый чат.' : 'Роль строится из выбранного резюме. OpenAI и OpenRouter получают её в каждом запросе, ChatGPT — первым сообщением сессии. Контакты исключаются, выдумывать опыт запрещено.'}
          </p>
          {roleReady && <p role="status">{roleReady}</p>}
          <h2>Три независимых источника</h2>
          <p>
            Микрофон и звук собеседника распознаются раздельно. Изображение
            никогда не отправляется автоматически: только после «Выбрать
            область» или «Весь экран».
          </p>
          <div className="toolbar">
            <button
              disabled={busy || screen}
              onClick={() => {
                savePreference("display", true);
                void capture(true);
              }}
            >
              Включить звук собеседника
            </button>
            <button
              disabled={busy || mic}
              onClick={() => {
                savePreference("mic", true);
                void capture(false);
              }}
            >
              Включить микрофон
            </button>
            <button disabled={busy} className="secondary" onClick={stop}>
              Остановить весь захват
            </button>
          </div>
          <p role="status">
            Микрофон: {mic ? "ВКЛЮЧЁН" : "выключен"} · Собеседник:{" "}
            {systemAudio ? "ВКЛЮЧЁН" : "не захватывается"} · Экран для ручного
            снимка: {screen ? "выбран" : "не выбран"}
          </p>
          <label>
            Общий уровень звука <meter min={0} max={100} value={level} />
          </label>
          {error && <p role="alert">{error}</p>}
          <video
            ref={video}
            muted
            autoPlay
            playsInline
            style={{ display: "none" }}
          />
          <h3>Распознавание речи</h3>
          <p>
            {speechEngine === "local"
              ? speechLabel(speechStatus.data?.state)
              : speechStatus.data?.openai_ready
                ? "OpenAI Live готов"
                : "Для OpenAI Live сохраните ключ OpenAI в разделе «ИИ»"}{" "}
            · русский и English распознаются в одной сессии.{" "}
            {speechStatus.data?.error || speechStatus.error?.message || ""}
          </p>
          <button
            disabled={
              speechStatus.data?.state === "loading" ||
              speechStatus.data?.state === "ready"
            }
            onClick={async () => {
              await fetch("/api/speech/load", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
              });
              await speechStatus.refetch();
            }}
          >
            Загрузить локальную модель
          </button>
          <label>
            <input
              type="checkbox"
              checked={speechEnabled}
              onChange={(event) => {
                setSpeechEnabled(event.target.checked);
                localStorage.setItem(
                  "jobghost-speech-enabled",
                  String(event.target.checked),
                );
              }}
            />{" "}
            Распознавать речь
          </label>
          <label>
            Способ распознавания{" "}
            <select
              aria-label="Способ распознавания речи"
              value={speechEngine}
              onChange={(event) => {
                const value = event.target.value as SpeechEngine;
                setSpeechEngine(value);
                localStorage.setItem("jobghost-speech-engine", value);
              }}
            >
              <option value="local">
                Локально · NVIDIA GPU / CPU fallback, бесплатно
              </option>
              <option
                value="openai"
                disabled={!speechStatus.data?.openai_ready}
              >
                OpenAI Live · текст во время речи, платно
              </option>
            </select>
          </label>
          <p>
            {speechStatus.data?.model}. OpenAI Live печатает фразу по мере речи;
            локальный режим обрабатывает короткие фрагменты на GPU. Длинный
            вопрос не завершается до паузы 1,1 секунды. Ctrl+Enter отправляет
            видимый текст вручную.
          </p>
          <p role="status">
            Локальных фрагментов в обработке: {queued}. Пропущено: {dropped}.
          </p>
          {transcript.map((item) => (
            <p key={item.id}>
              <small>
                {item.source} · {item.language.toUpperCase()}
                {item.question ? " · вопрос" : " · речь"}
              </small>
              <br />
              {item.text}
            </p>
          ))}
          <button
            className="secondary"
            onClick={() => {
              streams.current.forEach((item) => {
                item.assembler.clear();
                item.draftId = undefined;
              });
              setLatestVoice(undefined);
              setTranscript([]);
            }}
          >
            Очистить текст
          </button>
        </>
      }
    />
  );
}
