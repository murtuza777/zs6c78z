"""Build identity used in HTTP cache validators.

Responses depend on the data snapshot *and* on the code that shapes them. Keying ETags on the
snapshot alone let browsers keep a pre-deploy response (e.g. one missing a newly added field)
after a deploy, because the server kept answering 304. The code fingerprint changes whenever any
backend source file changes.
"""

import hashlib
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent


def code_fingerprint(root: Path = APP_DIR) -> str:
    """Short hash of every ``.py`` file under ``root`` (path + content, line endings normalised)."""
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*.py")):
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(path.read_bytes().replace(b"\r\n", b"\n"))
    return digest.hexdigest()[:10]


CODE_FINGERPRINT = code_fingerprint()
