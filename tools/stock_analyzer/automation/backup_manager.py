import shutil
from pathlib import Path
from datetime import datetime


def create_backup(source_path, backup_dir=None):
    """
    Create a timestamped backup of `source_path`.

    Returns the Path to the backup file.
    """
    source = Path(source_path)
    if not source.exists():
        raise FileNotFoundError(f"Source file not found: {source}")

    backup_root = Path(backup_dir) if backup_dir else source.parent / "backups"
    backup_root.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    backup_name = f"{source.stem}_{timestamp}{source.suffix}"
    backup_path = backup_root / backup_name

    shutil.copy2(source, backup_path)
    return backup_path
