import os, shutil, zipfile, tempfile, pathlib

here = pathlib.Path(__file__).resolve().parent.parent
stage = pathlib.Path(tempfile.mkdtemp()) / "panel"
stage.mkdir(parents=True)
skip = {'.venv', '.venv_test', 'data', '__pycache__', 'deploy/keys'}

for item in here.iterdir():
    if item.name.startswith('.venv') or item.name == 'data':
        continue
    if item.name.startswith('_'):
        continue
    dest = stage / item.name
    if item.is_dir():
        def _ignore(dir, names):
            return [n for n in names if n in ('__pycache__', 'keys')
                    or n.endswith('.pyc') or n in ('panel_bundle.zip', 'panel_bundle.b64', 'VULTR_CONSOLE_DEPLOY.sh')]
        shutil.copytree(item, dest, ignore=_ignore)
    else:
        shutil.copy2(item, dest)

# production env
shutil.copy2(here / '.env.vps', stage / '.env')

zip_path = here / 'deploy' / 'panel_bundle.zip'
zip_path.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, _, files in os.walk(stage):
        for f in files:
            p = pathlib.Path(root) / f
            zf.write(p, p.relative_to(stage))

print(zip_path)
print('SIZE', zip_path.stat().st_size)
