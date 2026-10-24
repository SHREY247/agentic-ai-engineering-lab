"""Credential-free diagnostics for the facilitator: never print API key values."""
import importlib.util
import os
import sys
from pathlib import Path
import shutil
import subprocess

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

root = Path(__file__).resolve().parent.parent
try:
    from dotenv import load_dotenv
    load_dotenv(root / '.env')
except ImportError:
    pass
print('CampusBites facilitator preflight')
for key in ('GROQ_API_KEY', 'GEMINI_API_KEY'):
    print(f'{key}:', 'configured' if os.environ.get(key) else 'MISSING')
for mod in ('crewai', 'litellm', 'google.genai'):
    try: found = importlib.util.find_spec(mod) is not None
    except (ImportError, ModuleNotFoundError): found = False
    print(f'{mod}:', 'installed' if found else 'MISSING')
print('Node:', subprocess.getoutput('node --version') if shutil.which('node') else 'MISSING')
print('Feature slot files:', all((root / p).exists() for p in ('site/feature.js', 'api/feature.mjs', 'tests/feature.acceptance.test.mjs')))
starter = all((root / t).read_text(encoding='utf-8') == (root / 'facilitator/starter' / n).read_text(encoding='utf-8')
              for t, n in (('site/feature.js', 'feature.js'), ('api/feature.mjs', 'feature.mjs'),
                           ('tests/feature.acceptance.test.mjs', 'feature.acceptance.test.mjs')))
print('Workspace reset to starter:', starter, '' if starter else '(click Reset in /office before a run)')
print('Gemini model:', os.environ.get('GEMINI_MODEL', 'gemini/gemini-3.5-flash-lite'))
print('Groq model:', os.environ.get('GROQ_MODEL', 'groq/openai/gpt-oss-120b'))
print('Gemini call cap:', os.environ.get('CAMPUSBITES_GEMINI_CALL_CAP', '16'), '| pace:', os.environ.get('CAMPUSBITES_GEMINI_RPM', '10'), 'calls/min')
print('Groq call cap:', os.environ.get('CAMPUSBITES_GROQ_CALL_CAP', '10'), '| pace:', os.environ.get('CAMPUSBITES_GROQ_RPM', '6'), 'calls/min')
print('Corrections allowed:', os.environ.get('CAMPUSBITES_MAX_CORRECTIONS', '1'))
print('No model request was made by this diagnostic.')
print('Check active quotas in Google AI Studio and Groq Console before a live run.')

# Optional live network readiness probe; never print credential values.
if '--probe' in __import__('sys').argv:
    import json, urllib.request, urllib.error
    print('\nLive provider connectivity probe (makes one small API call per provider):')
    providers = [
        ('Groq', os.environ.get('GROQ_API_KEY'), 'https://api.groq.com/openai/v1/chat/completions',
         {'model':os.environ.get('GROQ_MODEL','groq/openai/gpt-oss-120b').removeprefix('groq/'),
          'messages':[{'role':'user','content':'Reply with OK.'}],'max_tokens':24}),
        ('Gemini',os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY'),
         'https://generativelanguage.googleapis.com/v1beta/models/' + os.environ.get('GEMINI_MODEL','gemini/gemini-3.5-flash-lite').removeprefix('gemini/') + ':generateContent',
         {'contents':[{'parts':[{'text':'Reply with OK.'}]}],'generationConfig':{'maxOutputTokens':24}}),
    ]
    for name,key,url,payload in providers:
        if not key:
            print(name+': NOT CHECKED (missing key)')
            continue
        req = urllib.request.Request(url,data=json.dumps(payload).encode('utf-8'),headers={
            'Content-Type':'application/json',
            **({'Authorization':'Bearer '+key} if name=='Groq' else {'x-goog-api-key':key})},method='POST')
        try:
            with urllib.request.urlopen(req,timeout=18) as response:
                body=json.loads(response.read())
                ok=('choices' in body if name=='Groq' else 'candidates' in body)
                print(name+':','CONNECTED' if ok else 'UNEXPECTED RESPONSE')
        except urllib.error.HTTPError as e:
            # Extract only a sanitized API error code; never echo request headers or keys.
            print(name+': HTTP',e.code,'(check quota, region, model name and account permissions)')
        except Exception as e:
            print(name+':',type(e).__name__,'(check network and API reachability)')
    print('This probe verifies model endpoints; a full five-agent CrewAI run must still be rehearsed.')
