# Подключение JobGhost MCP к Codex

JobGhost использует локальный STDIO MCP: отдельный OpenAI API key и локальная LLM не нужны.

## Windows

После `./scripts/install.ps1` добавьте сервер командой, проверенной на установленном Codex CLI:

```powershell
codex mcp add jobghost -- "E:\JobGhost\backend\.venv\Scripts\python.exe" -m app.mcp.server
codex mcp list
```

Так как модулю нужен рабочий каталог backend, надёжный вариант — project config `.codex/config.toml`:

```toml
[mcp_servers.jobghost]
command = "E:\\JobGhost\\backend\\.venv\\Scripts\\python.exe"
args = ["-m", "app.mcp.server"]
cwd = "E:\\JobGhost\\backend"
startup_timeout_sec = 20
tool_timeout_sec = 120
required = true
```

Перезапустите Codex/расширение. В Codex CLI проверьте `/mcp`. Конфигурация соответствует текущей [официальной документации Codex MCP](https://learn.chatgpt.com/docs/extend/mcp): локальные клиенты поддерживают STDIO, используют `config.toml`, а таблица сервера задаётся как `[mcp_servers.<name>]` с `command`, `args` и `cwd`.

## Рабочие команды

- «Найди новые Python backend вакансии» → profile, search profile, `search_vacancies`, `get_vacancies_for_scoring`, затем scoring.
- «Обработай очередь новых вакансий» → один batch, затем `save_vacancy_scores`.
- «Подготовь отклики на вакансии с match выше 85%» → `get_best_vacancies`, resumes, персональные письма и drafts.
- «Отправляй» → только теперь `apply_to_vacancy`; при `DRY_RUN=true` отправка симулируется.

