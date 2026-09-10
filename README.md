# JobGhost

Локальный помощник для собеседований и поиска работы. Десктопное окно видит выбранный экран, локально распознаёт микрофон и системный звук и получает ответы через обычный аккаунт ChatGPT в Google Chrome. OpenAI API-ключ не используется.

## Скачать и установить

Скачайте `JobGhost-Setup-0.4.4.exe` на странице [Releases](https://github.com/coolmorimer/JobGhost/releases) и запустите его. Python, Node.js и отдельная модель речи не требуются: multilingual Whisper `small` уже включён в установщик.

### Первый запуск

1. Установите JobGhost и запустите ярлык.
2. В Google Chrome откройте `chrome://extensions`, включите «Режим разработчика» и нажмите «Загрузить распакованное».
3. Выберите `%LOCALAPPDATA%\Programs\JobGhost\resources\browser-extension`. Эту папку также можно открыть кнопкой в настройках JobGhost.
4. Один раз войдите в [ChatGPT](https://chatgpt.com/) в этом профиле Chrome.
5. Вернитесь в JobGhost. Расширение само создаст/найдёт служебный чат, подключится без кода и свернёт браузер.
6. В настройках выберите резюме и нажмите «Начать сессию». Сначала в ChatGPT загрузится роль по резюме без телефона и почты, затем приложение предложит экран и микрофон.

Браузер должен оставаться запущенным в фоне: обычный ChatGPT физически работает внутри него. Первую установку расширения и первый вход Chrome не разрешает выполнять полностью скрыто.

Значка JobGhost в трее нет. `Ctrl+Shift+Space` скрывает/возвращает окно, а полный выход находится в «Настройки → Основные → Выйти из JobGhost». В диспетчере задач процесс честно называется JobGhost/JobGhost Background и не маскируется под системные программы.

## Быстрый старт для разработки

```powershell
Copy-Item .env.example .env
./scripts/install.ps1
./scripts/dev.ps1
```

Откройте `http://127.0.0.1:5173`; OpenAPI — `http://127.0.0.1:8765/docs`; companion — `http://127.0.0.1:8765/interview/companion`. По умолчанию включён заметный безопасный `DRY_RUN=true`.

## Docker

```bash
docker compose up --build
```

Запускаются PostgreSQL 17, FastAPI и собранный React UI. Для локальной разработки без Docker используется SQLite.

## Разработка и проверки

```powershell
cd backend
.\.venv\Scripts\python -m alembic upgrade head
.\.venv\Scripts\python -m pytest
.\.venv\Scripts\python -m ruff check .
cd ..\frontend
npm test -- --run
npm run lint
npm run build
cd ..\browser-extension
node --test tests\*.test.mjs
cd ..\desktop
node --test *.test.cjs
```

Linux использует те же команды из `Makefile` и `backend/.venv/bin/python`.

## HH без API

Откройте HH в обычном браузере, войдите вручную и подключите браузер в разделе HH приложения. JobGhost читает доступные резюме и вакансии через управляемую локальную браузерную сессию. Перед реальным откликом выполняется preflight: точное резюме, уже отправленный отклик, CAPTCHA и дополнительные вопросы. При неопределённом результате или CAPTCHA автоматизация останавливается без слепого повтора.

## Возможности

- Профиль кандидата, несколько резюме, search profiles, blacklist и зарплатные правила.
- 20 demo-вакансий, дедупликация, локальная pre-filter система и AI scoring history.
- Ручные и автоматические HH-отклики с проверкой score/resume/duplicate/limit/cooldown; не более одного реального отклика за цикл.
- Dashboard, vacancy cards/detail, Kanban queue, profile editor и compact interview UI.
- Минимальный чат, защищённое полупрозрачное окно поверх других окон, клики насквозь с удержанием Shift для управления.
- Выбор экрана/окна и прямоугольной области, локальное RU/EN распознавание, автоопределение вопросов и ручная отправка последней голосовой фразы через `Ctrl+Enter`.
- Роль ChatGPT по выбранному резюме при каждом старте сессии; контакты удаляются, выдумывать опыт запрещено.
- HH API adapter, Playwright extension point, scheduler, messages, audit log и защищённая Electron-оболочка Windows.

Архитектура: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Карта для ИИ-агентов: [docs/PROJECT_MAP.md](docs/PROJECT_MAP.md). Правила агентам: [AGENTS.md](AGENTS.md).

## Безопасность и ограничения

JobGhost не обходит CAPTCHA или вход. Пользователь вручную авторизуется там, где это требуется. Секреты, browser state, локальная БД, резюме, аудио и снимки исключены из Git. Передача вопроса, профессионального контекста резюме или выбранного изображения в ChatGPT остаётся передачей данных стороннему сервису и подчиняется настройкам и лимитам аккаунта.

Защита окна проверена через Windows Graphics Capture, но перед важной демонстрацией её нужно проверить именно в используемой программе записи: разные программы захватывают окна по-разному.
