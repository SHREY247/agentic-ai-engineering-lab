"""Read-only integrity/trace audit for a real CampusBites CrewAI run."""
import json
import sys
from pathlib import Path
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
root=Path(__file__).resolve().parent.parent
runs=root/'runs'
if len(sys.argv)>1 and sys.argv[1]!='latest':
    run_dir=runs/sys.argv[1]
else:
    choices=sorted((p for p in runs.iterdir() if p.is_dir()), key=lambda p: p.stat().st_mtime, reverse=True) if runs.exists() else []
    if not choices:
        raise SystemExit('No real run evidence exists yet. Preview and reference mode are not model runs.')
    run_dir=choices[0]
if not run_dir.resolve().is_relative_to(runs.resolve()):
    raise SystemExit('Invalid run id')
if not run_dir.exists():
    raise SystemExit('Run not found')
summary=json.loads((run_dir/'summary.json').read_text(encoding='utf-8')) if (run_dir/'summary.json').exists() else {}
events=json.loads((run_dir/'events.json').read_text(encoding='utf-8')) if (run_dir/'events.json').exists() else []
print('Run ID:',run_dir.name)
print('Outcome:',summary.get('status','incomplete'))
print('Provider map:',summary.get('providers',{}))
print('Model names:',summary.get('models',{}))
print('Worker phases:',[(e['actor'],e['title']) for e in events if e['title']=='CrewAI specialist started'])
manager_decisions=json.loads((run_dir/'manager-decisions.json').read_text(encoding='utf-8')) if (run_dir/'manager-decisions.json').exists() else []
print('REAL MANAGER DECISIONS:',len(manager_decisions))
for d in manager_decisions: print('  ',d.get('step'),d.get('assign'),':',d.get('reason'))
print('Manager assignments evidenced:',all(any(e.get('actor')=='Manager' and e.get('type')=='handoff' for e in events) for _ in [0]))
print('Feature request:', summary.get('feature_request', '(unknown)'))
print('Spec saved:', (run_dir/'spec.md').exists())
for name in ('qa','backend','frontend'):
    tool_events=[e for e in events if e.get('actor','').lower()==name and e['title']=='Real source file written']
    patch=run_dir/(name+'.patch')
    print(f'{name} actual tool writes: {len(tool_events)}, patch saved: {patch.exists()}')
    for e in tool_events:
        print('  file:',e.get('evidence',{}).get('file'),'SHA-256:',e.get('evidence',{}).get('after_sha256','')[:16])
first_tests=[e for e in events if e['title'].startswith('Acceptance tests written')]
print('Tests written before code (and failing):', bool(first_tests), first_tests[0]['detail'] if first_tests else '')
for name in ('qa-tests.txt','release-gate.txt'):
    p=run_dir/name
    print(f'{name}:', 'present' if p.exists() else 'missing')
    if p.exists():
        lines=[x for x in p.read_text(encoding='utf-8').splitlines() if x.startswith('# pass ') or x.startswith('# fail ')]
        print(' ', ', '.join(lines))
gate=[e for e in events if e['title']=='Independent release gate']
if gate: print('Release gate:', gate[-1]['detail'])
final=summary.get('status')=='passed' and all((run_dir/f'{x}.patch').exists() for x in ('qa','backend','frontend')) and (run_dir/'spec.md').exists() and (run_dir/'release-gate.txt').exists() and any(d.get('assign')=='COMPLETE' for d in manager_decisions)
print('Audit evidence complete:',final)
if not final:sys.exit(1)
