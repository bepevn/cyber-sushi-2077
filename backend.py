"""Server-side identity verification, optimistic revisions and tab leases.
No password handling. Public Auth REST is called only from the browser.
"""
from __future__ import annotations
import copy
import time
import re
import json
from pathlib import Path

ECONOMY = json.loads((Path(__file__).parent / 'frontend/catalog.json').read_text(encoding='utf-8'))['economy']
LEASE_SECONDS = 55

class SaveConflict(Exception):
    pass

def owned_path(uid: str) -> str:
    if not isinstance(uid, str) or not uid or '/' in uid:
        raise ValueError('올바르지 않은 사용자 식별자입니다.')
    return f'saves/{uid}'

def validate_state(state: dict) -> None:
    if not isinstance(state, dict) or state.get('schema') != 1:
        raise ValueError('지원하지 않는 세이브 버전입니다.')
    if state.get('phase') not in ('prep', 'service', 'summary', 'gameover'):
        raise ValueError('올바르지 않은 게임 단계입니다.')
    if not isinstance(state.get('cash'), int) or state['cash'] < 0:
        raise ValueError('잔액이 올바르지 않습니다.')
    if not isinstance(state.get('inventory'), dict) or any(type(v) is not int or v < 0 for v in state['inventory'].values()):
        raise ValueError('재고가 올바르지 않습니다.')
    if len(state.get('deliveries', [])) > 200:
        raise ValueError('동시 배송은 200건까지 가능합니다.')
    if state.get('complaints', 0) >= ECONOMY['maxComplaints'] and state['phase'] != 'gameover':
        raise ValueError('게임오버 상태를 변경할 수 없습니다.')

def transition(old, uid, tab, action, request_id, state=None, revision=0, now=None, delivery_ms=30000):
    """Pure transaction reducer. UID is supplied by verified token, never payload UID."""
    now = time.time() * 1000 if now is None else now
    owned_path(uid)
    if not isinstance(tab, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{8,100}', tab):
        raise ValueError('탭 식별자가 올바르지 않습니다.')
    doc = copy.deepcopy(old or {'owner': uid, 'revision': 0, 'state': None})
    if doc['owner'] != uid:
        raise PermissionError('다른 사용자의 저장에는 접근할 수 없습니다.')
    if doc.get('lastRequest') == request_id:
        return doc, {'state': doc.get('state'), 'revision': doc['revision'], 'now': now}
    if doc.get('tab') not in (None, tab) and doc.get('leaseUntil', 0) > now:
        raise SaveConflict('다른 탭에서 실행 중입니다. 그 탭을 닫고 55초 뒤 다시 시도하세요.')
    if action == 'save':
        if revision != doc['revision']:
            raise SaveConflict('새로운 클라우드 저장이 있습니다. 덮어쓰지 않았습니다. 메뉴에서 클라우드 다시 불러오기를 선택하세요.')
        validate_state(state)
        state = copy.deepcopy(state)
        old_deliveries = {d['id']: d for d in (doc.get('state') or {}).get('deliveries', [])}
        for d in state['deliveries']:
            if d['id'] in old_deliveries:
                d['due'] = old_deliveries[d['id']]['due']
            else:
                d['due'] = now + delivery_ms
            d['serverStamped'] = True
        # Deliveries settle once inside the same atomic save/load transaction.
        doc['state'] = state
        doc['revision'] += 1
    if doc.get('state'):
        s = doc['state']; waiting = []
        for d in s['deliveries']:
            if d['due'] <= now:
                for key, qty in d['mix'].items():
                    s['inventory'][key] += qty
            else:
                waiting.append(d)
        s['deliveries'] = waiting
        s['revision'] = doc['revision']
    doc.update(tab=None if action == 'release' else tab,
               leaseUntil=0 if action == 'release' else now + LEASE_SECONDS * 1000,
               lastRequest=request_id, updatedAt=now)
    return doc, {'state': doc.get('state'), 'revision': doc['revision'], 'now': now}

class FirebaseStore:
    def __init__(self, config, delivery_ms=30000):
        import firebase_admin
        from firebase_admin import credentials, firestore
        if not firebase_admin._apps:
            firebase_admin.initialize_app(credentials.Certificate(dict(config)))
        self.db = firestore.client()
        self.delivery_ms = delivery_ms

    def dispatch(self, payload):
        from firebase_admin import auth, firestore
        # Verification precedes every read, save and release. No trusted client UID.
        token = auth.verify_id_token(payload.get('token', ''), check_revoked=True)
        uid = token['uid']
        ref = self.db.document(owned_path(uid))
        txn = self.db.transaction()

        @firestore.transactional
        def operation(transaction):
            snap = ref.get(transaction=transaction)
            old = snap.to_dict() if snap.exists else None
            doc, response = transition(old, uid, payload['tab'], payload['action'],
                                       payload.get('opId', payload['id']), payload.get('state'),
                                       payload.get('revision', 0), delivery_ms=self.delivery_ms)
            transaction.set(ref, doc)
            return response
        return operation(txn)
