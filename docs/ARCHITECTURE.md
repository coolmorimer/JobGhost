# Архитектура

Codex отвечает за интеллектуальные решения и вызывает компактные MCP tools. FastAPI/SQLAlchemy выполняют детерминированную фильтрацию, хранение, safety-проверки, provider actions и realtime. Scheduler собирает вакансии без LLM и оставляет их в `NEEDS_AI_SCORE`. Raw provider JSON хранится отдельно и никогда не передаётся Codex целиком.

Секреты HH и API-ключи OpenAI/OpenRouter находятся в системном keychain через `keyring`; токены, cookies, резюме и транскрипты исключены из Git. `AIProviderService` держит постоянный HTTP-пул, отправляет OpenAI Responses и OpenRouter Chat Completions потоково и выбирает бесплатные OpenRouter-модели по каталогу задержек. BrowserProvider остаётся резервным режимом без API и не обходит CAPTCHA: при необходимости он открывает видимый браузер для ручной авторизации.
