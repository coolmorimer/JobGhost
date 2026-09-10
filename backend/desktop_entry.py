"""Frozen local service entry point; data stays outside the installation folder."""
import os
from pathlib import Path

import uvicorn

if __name__ == '__main__':
    import multiprocessing

    multiprocessing.freeze_support()
    data = Path(os.environ.get('JOBGHOST_USER_DATA', Path.home() / 'AppData/Local/JobGhost/data'))
    data.mkdir(parents=True, exist_ok=True)
    os.chdir(data)
    os.environ.setdefault('DATA_DIR', str(data))
    os.environ.setdefault('DATABASE_URL', 'sqlite+aiosqlite:///' + (data / 'jobghost.db').as_posix())
    uvicorn.run('app.main:app', host='127.0.0.1', port=int(os.environ.get('JOBGHOST_PORT', '8765')), log_level='info')
