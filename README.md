# CYBER SUSHI

비 내리는 네온 도시의 스시집 운영 게임. Python/Streamlit이 앱 진입점이며, 실시간 조리와 애니메이션은 HTML/CSS/JavaScript 커스텀 컴포넌트에서 실행합니다. 프레임마다 Python을 재실행하지 않습니다.

## 1. 로컬 실행 — Firebase 없이 가능

Python 3.11 이상 권장. 이 프로젝트 폴더에서 실행하세요.

```sh
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```

터미널에 표시된 주소로 접속합니다. `frontend/index.html`을 단독으로 열지 마세요. `.streamlit/secrets.toml`이 없으면 LOCAL DEMO로 시작합니다. 데모 저장은 해당 브라우저의 로컬 저장소에만 있으며 계정별 클라우드 저장과 별개입니다. 브라우저 데이터 삭제 시 사라질 수 있습니다. 데모를 클라우드에 자동 병합하지 않습니다.

## 2. 조작

- 새 게임 → 튜토리얼 또는 건너뛰기 → 영업 시작.
- 주문을 보고 재료 트레이에서 필요한 수량 선택 → 조리 시작.
- 칼질: 움직이는 게이지가 목표에 들어오면 클릭/스페이스. 총 3회.
- 밥 쥐기: 누르는 동안 막대가 올라가고 놓으면 내려갑니다. 6초간 목표를 추적합니다.
- 플레이팅: 목표에 맞춰 클릭/스페이스 → 완성 접시 서빙.
- 레시피와 다른 조합도 조리할 수 있으나 오주문으로 처리됩니다. 폐기 시 재료는 반환되지 않습니다.
- 재료 구매 패널에서 수량을 정하고 주문합니다. 30초 배송 중 재료는 사용할 수 없습니다.
- 90초를 초과하거나 오주문이면 누적 불만족 증가. 누적 5명은 즉시 게임오버.
- 정산 후 다음 날 준비로 이동해 재료를 보충하고 영업을 시작합니다.
- 음소거, 조작법, 레시피 도감은 화면 버튼에서 이용합니다.

## 3. Firebase 설정 (선택)

1. Firebase Console에서 프로젝트를 만들고 웹 앱을 등록합니다. 웹 설정의 `apiKey`, `projectId`를 확보합니다.
2. Authentication → Sign-in method에서 Email/Password를 활성화합니다. 배포 주소가 필요한 경우 Authentication 설정의 승인된 도메인에 추가합니다.
3. Cloud Firestore 데이터베이스를 생성합니다.
4. Firestore Rules 탭에 `firestore.rules` 내용을 붙여넣고 게시합니다. 이 프로젝트는 브라우저에서 Firestore에 직접 접근하지 않으므로 클라이언트 읽기/쓰기를 전부 차단합니다.
5. 프로젝트 설정 → 서비스 계정에서 Python 서버용 서비스 계정 JSON 키를 발급합니다. 이 파일은 GitHub에 올리지 마세요.
6. `.streamlit/secrets.toml.example`을 `.streamlit/secrets.toml`로 복사하고 실제 설정으로 채웁니다. 서비스 계정의 각 필드를 `[firebase_service_account]`에 옮기며 `private_key`는 줄바꿈을 보존합니다.
7. 앱을 다시 실행합니다. 로그인 화면에서 이메일 가입/로그인, 비밀번호 재설정을 사용할 수 있습니다.

저장 위치는 `saves/{검증된 UID}`입니다. 매 요청마다 Python에서 Firebase ID 토큰을 검증하고, 클라이언트가 전달한 UID 대신 검증 결과 UID로 경로를 만듭니다. Admin SDK는 Rules를 우회하므로 서버의 검증이 중요합니다. 비밀번호는 Authentication 요청에만 사용하고 Firestore에 저장하지 않습니다. 서비스 계정은 Python에서만 사용합니다.

## 4. GitHub 업로드

저장소 루트에 `app.py`, `backend.py`, `requirements.txt`, `frontend/`, `.streamlit/` 등이 함께 있어야 합니다. ZIP을 풀었을 때 바깥 폴더가 한 겹 더 생기면 그 안의 프로젝트가 루트가 되도록 업로드하세요.

```sh
git init
git add .
git status
# secrets.toml 또는 실제 서비스 계정 키가 목록에 없는지 확인
git commit -m "Add Cyber Sushi game"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/YOUR_REPO.git
git push -u origin main
```

이미 비밀키를 공개 저장소에 올렸다면 파일만 삭제하지 말고 해당 키를 폐기하고 새 키를 발급하세요.

## 5. Streamlit Community Cloud 배포

1. Community Cloud에 GitHub로 로그인합니다.
2. Create app에서 해당 저장소, `main` 브랜치, 진입 파일 `app.py`를 선택합니다.
3. Advanced settings에서 Python 3.11 이상을 선택합니다.
4. 데모만 배포하려면 Secrets를 비워두세요. 클라우드 저장은 로컬 `secrets.toml`과 같은 내용을 배포 앱의 Secrets에 입력합니다.
5. Deploy 후 화면을 확인합니다. `requirements.txt`는 자동 설치됩니다. Node나 Playwright는 게임 실행에 필요하지 않습니다.
6. Firebase를 사용한다면 두 개의 테스트 계정으로 로그인/저장/복원을 별도로 점검합니다.

## 6. 저장 동작 및 제약

중요 이벤트와 주기적 체크포인트를 저장합니다. 고객 제한 시간은 저장된 경과 시간으로 복원하고 오프라인 시간을 추가하지 않습니다. 배송은 실제 도착 시각을 사용하며 클라우드에서는 서버가 도착 예정 시각을 지정합니다. 저장 실패 시 초기화하지 않고 재시도할 수 있습니다. 버전 비교와 55초 탭 임대로 다른 탭의 덮어쓰기를 방지합니다. 이전 탭을 닫은 뒤 임대 만료까지 기다려야 할 수 있습니다.

갑작스러운 브라우저 종료 전 마지막 몇 초는 마지막 성공 저장 시점으로 복원될 수 있습니다. 데모 저장은 클라이언트 저장이므로 보안 저장이 아닙니다. 클라우드 서버는 사용자 격리와 버전/기본 값 검증을 수행하지만 모든 게임 행동을 서버에서 재연산하지는 않습니다. 개발자 도구로 조작하는 치팅까지 방지하는 경쟁 게임용 서버 권위 모델은 아닙니다.

## 7. 데이터와 정산

`frontend/catalog.json`이 가격, 초기 재고, 레시피, 해금일의 단일 데이터 원본입니다. 60일까지 지정 레시피를 제공하며 이후 조합을 중복 없이 추가합니다. 가능한 조합이 소진되어도 계속 영업할 수 있습니다.

영업이익 = 음식 매출 + 팁 - 실제 소비 재료 원가.
순현금흐름 = 음식 매출 + 팁 - 구매 지출.
무료 시작 재고도 소비하면 원가를 계산하지만 구매 지출은 기록하지 않습니다. 정산 이후 보충 구매는 다음 영업일 장부에 반영합니다.

## 8. 테스트

Python 단위 테스트에는 Firebase 연결이 필요하지 않습니다. JavaScript 규칙 테스트와 경제 시뮬레이션은 Node.js 18 이상이 필요합니다.

```sh
python -m unittest discover -s tests -p "test_*.py" -v
node --test tests/engine.test.cjs
node tests/economy.cjs
node --check frontend/app.js
```

선택 브라우저 테스트:

```sh
pip install playwright
python -m playwright install chromium
python tests/browser_smoke.py
```

### 이번 납품에서 실행 확인

- 게임 규칙 및 Python 저장 로직 테스트 재실행 성공. 결과: `test-results/engine.txt`, `backend.txt`.
- 프런트 JavaScript 문법 및 Python 컴파일 검사 성공.
- 경제 시뮬레이션 실행 성공: `test-results/economy.json`.
- 실제 브라우저 전체 플레이, Streamlit iframe 통합, 실제 Firebase 가입/로그인/저장/복원은 미검증입니다. 자동 브라우저 테스트는 작성했지만 이 작업 환경에서 Chromium 실행 파일이 없어 완료하지 못했습니다.
- 실제 계정 2개의 데이터 격리, 만료/취소 토큰, 비밀번호 재설정 이메일, 네트워크 단절 복구, 실제 탭 동시 접근은 배포 전 직접 검증해야 합니다. 단위 테스트 통과와 실서비스 검증은 구분합니다.

### 경제 시뮬레이션 결과

120일, 2,082명 전원 정확한 서빙, 부족분만 구매, 배송 30초 + 조리 20초 가정입니다. 사람이 실제로 이 성과를 낸다는 뜻은 아닙니다.

| 품질 가정 | 최소 현금 | 120일 종료 현금 | 누적 영업이익 |
|---|---:|---:|---:|
| 0 | 300C | 33,536C | 33,140C |
| 80 | 300C | 41,637C | 41,241C |
| 95 | 300C | 47,420C | 47,024C |

현재 가격으로 정상 서빙 시 재구매 자금은 충분했습니다. 임대료 같은 고정 비용이 없어 장기적으로 현금이 많이 쌓이며, 난도는 파산보다 조리 시간·재고 준비·누적 불만족에 있습니다. 폐기/오주문을 반복하는 플레이까지 안전하다는 보장은 아닙니다.

## 9. 파일 구성

- `app.py`: Streamlit 컴포넌트 진입점 및 요청/응답
- `backend.py`: 토큰 검증, UID별 저장, 트랜잭션/탭 임대
- `frontend/index.html`, `style.css`, `app.js`: 플레이 화면 및 클라이언트 동작
- `frontend/engine.js`: DOM과 분리된 게임 규칙
- `frontend/catalog.json`: 밸런스와 레시피 데이터
- `tests/`: 규칙, 저장, 브라우저 테스트 및 경제 시뮬레이션
- `firestore.rules`: 클라이언트 직접 DB 접근 차단
- `.streamlit/secrets.toml.example`: 비밀 설정 예시

문제 신고 시 화면의 오류 메시지와 재현 순서를 기록하되 비밀번호, 토큰, 비밀키는 공유하지 마세요.
