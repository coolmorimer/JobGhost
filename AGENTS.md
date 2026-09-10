# JobGhost: инструкция для ИИ-агентов

Перед изменениями прочитайте `docs/PROJECT_MAP.md`, затем только относящиеся к задаче документы из `docs/`.

## Обязательные правила

- Основная пользовательская платформа — Windows 11; интерфейс и сообщения пользователю должны быть на русском.
- Не добавляйте OpenAI API-ключ: ответы идут через обычный вошедший аккаунт ChatGPT и расширение браузера.
- Не сохраняйте и не коммитьте cookies, токены, профиль браузера, локальную БД, записи речи, снимки экрана и содержимое резюме пользователя.
- Не обходите CAPTCHA, 2FA и ручной вход. При их появлении остановите автоматизацию и покажите понятное действие пользователю.
- Реальный отклик HH разрешён только после точной проверки вакансии/резюме. Не делайте слепых повторов после неопределённого результата.
- Окно можно исключать из поддерживаемого Windows-захвата через Content Protection, но нельзя обещать невидимость во всех программах записи.
- Не маскируйте процесс под системное или чужое приложение. Допустимы только честные имена JobGhost/JobGhost Background.
- Сохраняйте локальный bind `127.0.0.1`; не открывайте backend в сеть без отдельной модели аутентификации.
- Редактируйте точечно и не удаляйте пользовательские изменения вне задачи.

## Проверки перед завершением

```powershell
cd backend
.\.venv\Scripts\python.exe -m ruff check app tests
.\.venv\Scripts\python.exe -m pytest -q

cd ..\frontend
npm test -- --run
npm run lint
npm run build

cd ..\browser-extension
node --test tests\*.test.mjs

cd ..\desktop
node --test *.test.cjs
```

Для изменений нативного окна дополнительно запускайте `desktop/test-native.cjs`. Для речи — `scripts/test-speech.ps1` и `desktop/test-audio-pipeline.cjs`. Для экрана — `desktop/test-screen-capture.cjs` с тестовым окном JobGhost, не с пользовательскими окнами.

## Критические точки входа

- Desktop lifecycle и IPC: `desktop/main.cjs`, `desktop/preload.cjs`.
- Overlay/privacy: `desktop/overlay-controller.cjs`, `desktop/window-controller.cjs`.
- Основной чат: `frontend/src/components/InterviewCapture.tsx`, `frontend/src/components/ChatAnswer.tsx`.
- ChatGPT bridge: `backend/app/api/chat_browser.py`, `backend/app/connectors/chat_bridge.py`, `browser-extension/worker.js`.
- Локальная речь: `backend/app/services/speech.py`, `backend/app/api/speech.py`.
- HH: `backend/app/connectors/hh_browser.py`, `backend/app/api/hh_browser.py`, `backend/app/workers/autopilot.py`.
- Сборка: `scripts/build-installer.ps1`, `installer/JobGhost.iss`.

После изменения контракта синхронно обновляйте backend, frontend, preload TypeScript declaration, тесты и документацию.
