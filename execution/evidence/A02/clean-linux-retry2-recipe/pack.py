import hashlib, io, json, pathlib, tarfile, sys
source=pathlib.Path(sys.argv[1]).resolve()
output=pathlib.Path(sys.argv[2]).resolve()
if output.exists(): raise SystemExit('Refusing to overwrite an earlier source archive')
inventory_path=source/'clean-source-inventory.json'
if not inventory_path.resolve(strict=True).is_relative_to(source): raise SystemExit('Unconfined source inventory')
inventory=json.loads(inventory_path.read_text())
names=set(inventory['sourceInputs']) | {'clean-container-run.sh','clean-steps.py','clean-source-inventory.json'}
for name in names:
    member=pathlib.PurePosixPath(name)
    if member.is_absolute() or '..' in member.parts: raise SystemExit('Unconfined archive path')
    candidate=source/name
    if not candidate.resolve(strict=True).is_relative_to(source): raise SystemExit('Unconfined source target: '+name)
    if not candidate.is_file(): raise SystemExit('Non-file source input: '+name)
    if candidate.is_symlink() and (name not in inventory['sourceSymlinks'] or not candidate.resolve(strict=True).is_relative_to(source/'apps/src')):
        raise SystemExit('Unapproved source link: '+name)
for name, expected in inventory['sourceInputs'].items():
    if hashlib.sha256((source/name).read_bytes()).hexdigest()!=expected: raise SystemExit('Changed source input: '+name)
for name, expected in inventory['sourceSymlinks'].items():
    if not (source/name).is_symlink() or str((source/name).readlink())!=expected: raise SystemExit('Changed source symlink: '+name)
directories=set()
for name in names:
    p=pathlib.PurePosixPath(name)
    if p.is_absolute() or '..' in p.parts: raise SystemExit('Unconfined archive path')
    directories.update(str(parent) for parent in p.parents if str(parent)!='.')
def info(name, mode):
    item=tarfile.TarInfo(name);item.uid=item.gid=0;item.uname=item.gname='root';item.mode=mode;item.mtime=0
    return item
with tarfile.open(output,'w',format=tarfile.PAX_FORMAT) as archive:
    for name in sorted(directories, key=lambda p:(p.count('/'),p)):
        item=info(name,0o755);item.type=tarfile.DIRTYPE;archive.addfile(item)
    for name in sorted(names):
        p=source/name
        if p.is_symlink():
            item=info(name,0o777);item.type=tarfile.SYMTYPE;item.linkname=str(p.readlink());archive.addfile(item)
        else:
            data=p.read_bytes();item=info(name,0o755 if p.stat().st_mode & 0o111 else 0o644);item.size=len(data)
            archive.addfile(item,io.BytesIO(data))
print(json.dumps({'archive':str(output),'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'sourceFileCount':len(inventory['sourceInputs']),'archiveFileCount':len(names),'directoryCount':len(directories),'metadataPolicy':{'uid':0,'gid':0,'directories':'0755','files':'0644 or0755 if source executable','symlinks':'preserved targets','mtime':0}},indent=2))
