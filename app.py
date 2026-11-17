from pathlib import Path
import json
import streamlit as st
import streamlit.components.v1 as components
from backend import FirebaseStore, SaveConflict

ROOT = Path(__file__).parent
st.set_page_config(page_title='CYBER SUSHI', page_icon='🍣', layout='wide', initial_sidebar_state='collapsed')
st.markdown('''<style>
.stApp{background:#090d19} .block-container{padding:0.35rem 0.5rem;max-width:1600px}
header[data-testid="stHeader"]{display:none} footer{display:none}
</style>''', unsafe_allow_html=True)
try:
    cfg = dict(st.secrets)
except FileNotFoundError:
    cfg = {}
public = dict(cfg.get('firebase', {}))
service = cfg.get('firebase_service_account')
cloud = bool(public.get('apiKey') and service)
component = components.declare_component('cyber_sushi', path=str(ROOT / 'frontend'))

@st.cache_resource
def store():
    catalog = json.loads((ROOT / 'frontend/catalog.json').read_text(encoding='utf-8'))
    return FirebaseStore(st.secrets['firebase_service_account'], catalog['economy']['deliverySeconds'] * 1000)

response = st.session_state.get('response')
event = component(config={'cloud': cloud, 'apiKey': public.get('apiKey', ''), 'projectId': public.get('projectId', '')},
                  response=response, key='cyber-sushi-main', default=None)
if isinstance(event, dict) and event.get('id') != st.session_state.get('processed'):
    request_id = event.get('id')
    try:
        if not cloud:
            raise ValueError('Firebase가 설정되지 않았습니다. 로컬 데모를 이용하세요.')
        if event.get('action') not in ('load', 'save', 'release'):
            raise ValueError('지원하지 않는 요청입니다.')
        result = store().dispatch(event)
        result.update(id=request_id, ok=True)
    except SaveConflict as exc:
        result = {'id': request_id, 'ok': False, 'error': str(exc), 'conflict': True}
    except ValueError as exc:
        result = {'id': request_id, 'ok': False, 'error': str(exc)}
    except Exception:
        # Do not expose secrets, ID tokens, passwords or exception internals.
        result = {'id': request_id, 'ok': False, 'error': '클라우드 연결 또는 인증 확인에 실패했습니다. 네트워크와 Firebase 설정을 확인한 뒤 재시도하세요.'}
    st.session_state.processed = request_id
    st.session_state.response = result
    st.rerun()
