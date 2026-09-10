# Архитектура

Codex отвечает за интеллектуальные решения и вызывает компактные MCP tools. FastAPI/SQLAlchemy выполняют детерминированную фильтрацию, хранение, safety-проверки, provider actions и realtime. Scheduler собирает вакансии без LLM и оставляет их в `NEEDS_AI_SCORE`. Raw provider JSON хранится отдельно и никогда не передаётся Codex целиком.

Секреты HH находятся в системном keychain через `keyring`; токены, cookies, резюме и транскрипты исключены из Git. BrowserProvider не обходит CAPTCHA: при необходимости он открывает видимый браузер для ручной авторизации.

