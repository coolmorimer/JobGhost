# Карта проекта JobGhost для разработчиков и ИИ-агентов

## 1. Назначение и границы

JobGhost — локальное Windows-приложение для помощи на техническом интервью и работы с HH. Оно:

- показывает минимальный чат или полупрозрачный overlay поверх окон;
- захватывает только выбранный пользователем экран/окно и аудио;
- распознаёт русский и английский локально через Faster Whisper large-v3-turbo на NVIDIA CUDA (с CPU fallback) либо через явно включённый OpenAI Live Transcription;
- отправляет текст и выбранный снимок в OpenAI API, OpenRouter или обычную вкладку ChatGPT через расширение;
- показывает ответы OpenAI/OpenRouter потоково, по мере генерации;
- при старте сессии загружает выбранному ИИ роль по резюме без контактных данных;
- импортирует данные HH из вошедшего браузера и умеет безопасно подготовить/отправить отклик.

Не входят в допустимый дизайн: обход входа/CAPTCHA/2FA, скрытая кража экрана или микрофона, публикация пользовательских данных, маскировка процесса под системный.

## 2. Схема выполнения

```text
Electron (desktop/main.cjs)
  ├─ открывает React UI с http://127.0.0.1:8765
  ├─ управляет окном, overlay, Content Protection и hotkeys
  ├─ находит только помеченное служебное окно Chrome и скрывает его WinAPI
  ├─ выдаёт выбранный desktopCapturer source
  └─ запускает упакованный FastAPI server при необходимости

React (frontend/src)
  ├─ InterviewCapture: экран, микрофон, MediaRecorder, роль по резюме
  ├─ ChatAnswer: автодетект/ручная отправка, история, снимок, compact UI
  ├─ RegionPicker: выбор прямоугольной области
  └─ HH/Profile/Applications UI

FastAPI (backend/app)
  ├─ /api/speech/* -> локальный Faster Whisper
  ├─ /api/ai/* -> выбор провайдера, защищённые ключи и SSE-поток ответа
  ├─ /api/chat-browser/* -> ChatBridge WebSocket
  ├─ /api/hh-browser/* -> браузерный HH connector
  ├─ /api/autopilot/* -> контролируемый цикл HH
  └─ SQLite/PostgreSQL -> модели кандидата, резюме, вакансии, аудит

Browser extension (browser-extension)
  ├─ находит/создаёт служебную вкладку ChatGPT
  ├─ переносит её в отдельное окно `JobGhost Service` за границы экрана
  ├─ подключается к локальному WebSocket
  ├─ вводит вопрос и делает доверенную отправку
  └─ возвращает подтверждённый ответ в ChatBridge
```

## 3. Каталоги

| Путь | Ответственность |
|---|---|
| `backend/app/api` | HTTP/WebSocket контракты и локальная origin-защита |
| `backend/app/connectors` | ChatGPT, HH и mock-интеграции |
| `backend/app/services/ai_provider.py` | OpenAI Responses, OpenRouter Chat Completions, выбор быстрых моделей и SSE |
| `backend/app/services` | доменная логика, письмо, детектор вопроса, речь |
| `backend/app/workers` | scheduler и HH-автопилот |
| `backend/app/db` | SQLAlchemy-модели и сессия |
| `frontend/src/components` | чат, захват, настройки, HH-компоненты |
| `desktop` | Electron main/preload и нативные контроллеры Windows |
| `browser-extension` | Manifest V3 расширение Google Chrome |
| `installer` | Inno Setup script |
| `scripts` | установка, запуск, сборка и runtime-проверки |
| `docs` | архитектура, безопасность, управление, результаты проверок |

## 4. Главные потоки

### Старт интервью

1. Пользователь выбирает резюме в настройках.
2. `InterviewCapture.startSession()` вызывает `POST /api/ai/session/start`.
3. Backend читает активное резюме, удаляет контакты и строит недоверенный role prompt.
4. Для API-провайдеров каждый `/api/ai/ask` передаёт `resume_id`, backend заново строит роль из активного резюме; рестарт не теряет контекст. Для браузерного режима `ChatBridge.ask()` отправляет роль в начале сессии.
5. Только после подтверждённого ответа включаются выбор экрана и микрофон.

### Голосовой вопрос

1. Electron разрешает media/display capture только собственному локальному origin.
2. Микрофон и loopback системного звука остаются независимыми дорожками с подписями «Микрофон» и «Собеседник».
3. Локально каждый источник создаёт WebM-фрагменты по 2,5 секунды и собирает одну реплику до паузы. Упакованная `large-v3-turbo` работает на RTX через CUDA float16, а без CUDA переключается на CPU int8 (медленнее). В dev-режиме без упакованной модели CPU может загрузить более лёгкую `small`.
4. OpenAI Live получает PCM16 24 кГц примерно каждые 85 мс. Локальный VAD каждого источника завершает реплику после 1,1 секунды тишины, а transcript delta сразу печатается в поле вопроса.
5. `detect_question()` распознаёт русские/английские вопросительные и интервью-команды. Только законченный вопрос может уйти автоматически; видимый текст отправляется вручную через `Ctrl+Enter`.
6. Изображение не прикрепляется к голосу или автоответу. Пользователь отдельно выбирает область либо весь экран; вложение действует только на следующий ручной запрос.

### Запрос к ИИ

1. `ChatAnswer` добавляет безопасную инструкцию и необязательный JPEG.
2. `AIProviderService` выбирает OpenAI, OpenRouter или браузерный мост.
3. OpenAI Responses и OpenRouter Chat Completions возвращают SSE-дельты; UI допечатывает их сразу. OpenRouter auto использует актуальные бесплатные модели, отсортированные по задержке.
4. В браузерном режиме `ChatBridge` ждёт уникальный ответ без автоматического повтора, после чего UI быстро раскрывает его по словам.
5. Ответ хранится только в памяти страницы.

### HH-отклик

1. Browser connector работает с текущим вошедшим HH-профилем.
2. Preflight только читает вакансию и ссылку. Нельзя переходить на `/applicant/vacancy_response`: GET может отправить быстрый отклик. Перед submit допускается только модальная форма, открытая с блокировкой записывающих запросов; внутри проверяются точное резюме, письмо и дополнительные вопросы.
3. Manual send требует явного подтверждения. Autopilot отправляет не более одного отклика за цикл.
4. До dispatch сохраняется `SENDING`, при ошибке — `NEEDS_REVIEW`; оба состояния блокируют повтор. Неопределённый результат останавливает процесс. Реальный canary 0.5.2 не подтвердил доставку выбранного резюме/письма: общий выпуск HH заблокирован.

## 5. Состояние и данные

- Dev SQLite и runtime-файлы находятся под `.jobghost/` и игнорируются Git.
- Packaged user data находится в Electron `userData/data`.
- Browser login хранится браузером; JobGhost не экспортирует cookies.
- Выбранное резюме интервью хранится только как локальный ID в `localStorage`.
- Модель речи хранится в `JOBGHOST_USER_DATA/models` или `.jobghost/models`.
- API-ключи хранятся в Windows Credential Manager и не попадают в JSON-настройки или HTTP-ответы.
- Изображение и текст отправляются выбранному стороннему ИИ только после действия/настройки пользователя.

## 6. Desktop IPC

`desktop/preload.cjs` — единственный мост renderer → main. Все mutating handlers в `desktop/main.cjs` проверяют `trustedSender`: собственный `webContents`, main frame и origin `127.0.0.1`.

Основные каналы:

- `jobghost:set-compact`, `jobghost:set-compact-height` — overlay и адаптивная высота;
- `jobghost:overlay` — opacity, click-through, content protection;
- `jobghost:hide` — скрыть окно без трея, процесс продолжает работу;
- `jobghost:quit` — полный выход из настроек;
- `jobghost:action` — ask/snapshot/stop от глобальных горячих клавиш.

`desktop/chrome-window.cjs` изолирует нативную работу с Chrome. Контроллер не скрывает чужие окна: цель определяется по точному заголовку или уникальным координатам, а дескриптор окна запоминается.

## 7. Запуск и тесты

```powershell
./scripts/install.ps1
./scripts/start-background.ps1
./scripts/start-desktop.ps1
```

Полная матрица тестов находится в `AGENTS.md`. Локальные runtime smoke-файлы пишутся только в `.jobghost/`.

Сборка установщика:

```powershell
./scripts/build-installer.ps1 -Version 0.5.2
```

Результат: `releases/JobGhost-Setup-0.5.2.exe`.

## 8. Безопасное изменение контрактов

- API: обновить Pydantic/endpoint, frontend call, tests, эту карту.
- IPC: обновить main handler, preload allowlist, `frontend/src/desktop.d.ts`, native test.
- Extension message: обновить worker/page/bridge и тесты всех затронутых уровней.
- Speech: проверить RU и EN fixtures, пустой звук, границы длительности и нагрузку очереди.
- HH selectors: сначала read-only preflight на текущей странице; реальный submit только для явно выбранной цели.
- Overlay: проверить обычный/compact размеры, click-through, Shift, Content Protection и реальную программу записи отдельно.

## 9. Известные платформенные ограничения

- Google Chrome должен быть установлен. JobGhost сам запускает его и скрывает служебное окно из Alt+Tab; это не headless-браузер, а обычный вошедший профиль.
- Установку расширения и первый вход нельзя честно автоматизировать полностью скрыто.
- Content Protection поддерживается не всеми способами захвата, поэтому нужна проверка в конкретном Zoom/Teams/OBS.
- Глобальная `Ctrl+Enter` может быть занята; fallback — `Ctrl+Alt+Enter`, фактическое сочетание видно в настройках.
- Модель `large-v3-turbo` и CUDA-библиотеки входят в установщик; первый запуск загружает их в память GPU или CPU и может занять несколько секунд.
