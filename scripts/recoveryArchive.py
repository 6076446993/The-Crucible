"""Bounded recovery extraction: regular files/directories only, no executable use."""
import os
import pathlib
import shutil
import sys
import tarfile
import zipfile

LIMIT = 4 * 1024 * 1024 * 1024

def destination(root, name, seen):
    name = name.rstrip('/')
    if name.startswith('./'):
        name = name[2:]
    if name in ('', '.'):
        return None
    parts = name.split('/')
    if '\\' in name or '\x00' in name or ':' in name or any(p in ('', '.', '..') for p in parts):
        raise ValueError('unsafe recovery member')
    identity = name.casefold()
    if identity in seen:
        raise ValueError('duplicate recovery member')
    seen.add(identity)
    return root.joinpath(*parts)

def copy_member(source, target, size):
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('xb') as output:
        os.chmod(target, 0o600)
        remaining = size
        while remaining:
            data = source.read(min(1024 * 1024, remaining))
            if not data:
                raise ValueError('truncated recovery member')
            output.write(data)
            remaining -= len(data)
        output.flush()
        os.fsync(output.fileno())

def extract(archive, target, kind):
    root = pathlib.Path(target)
    root.mkdir(parents=True, exist_ok=False)
    seen = set()
    total = 0
    if kind == 'tar':
        with tarfile.open(archive, 'r:gz') as source:
            for member in source:
                if not (member.isfile() or member.isdir()):
                    raise ValueError('non-regular recovery member')
                item = destination(root, member.name, seen)
                if item is None:
                    continue
                total += member.size
                if len(seen) > 100000 or total > LIMIT or member.size < 0:
                    raise ValueError('recovery archive limit')
                if member.isdir():
                    item.mkdir(parents=True, exist_ok=True)
                else:
                    with source.extractfile(member) as stream:
                        copy_member(stream, item, member.size)
    elif kind in ('state-zip', 'backup-zip'):
        with zipfile.ZipFile(archive) as source:
            names = ('.hosted-learning-cache/store.envelope.json', '.hosted-learning-cache/gate-evidence.json') if kind == 'state-zip' else ('recovery-custody.enc', 'recovery-report.json')
            for name in names:
                matches = [entry for entry in source.infolist() if entry.filename == name]
                if not matches and name.endswith('gate-evidence.json'):
                    continue
                if len(matches) != 1:
                    raise ValueError('retained state is absent or duplicated')
                entry = matches[0]
                limit = LIMIT if name == 'recovery-custody.enc' else 128 * 1024 * 1024
                if entry.file_size > limit or (entry.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError('invalid retained state entry')
                with source.open(entry) as stream:
                    copy_member(stream, root / name.rsplit('/', 1)[1], entry.file_size)
    else:
        raise ValueError('unsupported recovery archive')

if __name__ == '__main__':
    try:
        extract(*sys.argv[1:])
    except Exception:
        print('Recovery archive refused; original material retained.', file=sys.stderr)
        sys.exit(1)
