# Slack to Google Drive 이미지 자동 업로더

Slack에서 업로드된 이미지를 자동으로 Google Drive에 저장하는 프로덕션 레벨 Node.js 서버입니다.

## 주요 기능

- ✅ Slack에서 Google Drive로 이미지 자동 업로드
- ✅ Service Account 인증 (OAuth 불필요)
- ✅ 날짜별 폴더 자동 생성 (YYYY-MM-DD)
- ✅ 파일명 중복 처리 (타임스탬프 추가)
- ✅ 파일 검증 (크기, 타입, 사용자)
- ✅ 동시 처리 제어 큐 시스템
- ✅ 재시도 로직 (exponential backoff)
- ✅ SQLite 업로드 히스토리 저장
- ✅ Winston 로깅 시스템
- ✅ Slack 서명 검증 (보안)
- ✅ 성공/실패 Slack 알림
- ✅ 헬스 체크 엔드포인트
- ✅ Graceful shutdown
- ✅ Notion 업로드 로그 기록 (선택 사항)

## 사전 준비

### 1. Node.js
- Node.js 18+ (LTS 권장)
- npm 또는 yarn

### 2. Slack 앱 설정

1. [https://api.slack.com/apps](https://api.slack.com/apps) 접속
2. **"Create New App"** 클릭 → **"From scratch"** 선택
3. 앱 이름 입력 및 워크스페이스 선택

#### OAuth & Permissions
**OAuth & Permissions** 메뉴로 이동하여 다음 **Bot Token Scopes** 추가:
- `files:read` - 파일 정보 읽기
- `users:read` - 사용자 정보 읽기
- `chat:write` - 메시지 전송

#### Event Subscriptions
1. **Event Subscriptions** 메뉴로 이동
2. Events 활성화
3. **Request URL** 설정: `https://your-domain.com/slack/events`
   - 로컬 개발의 경우 ngrok 사용 (아래 참조)
4. **bot events** 구독:
   - `file_shared` - 파일 공유 시 트리거

#### 앱 설치
1. **Install App** 메뉴로 이동
2. **"Install to Workspace"** 클릭
3. **Bot User OAuth Token** 복사 (`xoxb-`로 시작)

#### 앱 인증 정보
**Basic Information** 메뉴에서 복사:
- **Signing Secret**

### 3. Google Cloud 설정

1. [Google Cloud Console](https://console.cloud.google.com/) 접속
2. 새 프로젝트 생성 또는 기존 프로젝트 선택
3. **Google Drive API** 활성화:
   - **APIs & Services** → **Library** 이동
   - "Google Drive API" 검색
   - **Enable** 클릭

#### Service Account 생성
1. **IAM & Admin** → **Service Accounts** 이동
2. **Create Service Account** 클릭
3. 이름 및 설명 입력
4. **Create and Continue** 클릭
5. 선택 단계는 건너뛰고 **Done** 클릭

#### JSON 키 생성
1. 생성한 Service Account 클릭
2. **Keys** 탭으로 이동
3. **Add Key** → **Create new key** 클릭
4. **JSON** 선택
5. 키 파일 다운로드 → `config/google-credentials.json`으로 저장

#### Drive 폴더 공유
1. Google Drive에서 대상 폴더 생성 또는 열기
2. URL에서 **Folder ID** 복사:
   ```
   https://drive.google.com/drive/folders/FOLDER_ID_HERE
   ```
3. 폴더에서 **공유** 클릭
4. Service Account 이메일 추가 (JSON 키의 `client_email`)
5. **편집자** 권한 부여

### 4. Notion 설정 (선택 사항)

업로드 내역을 Notion 데이터베이스에 로그로 남기고 싶다면 다음 단계를 진행하세요.

#### Notion Integration 생성

1. [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations) 접속
2. **"+ New integration"** 클릭
3. 이름 입력 (예: "Slack Upload Logger")
4. 워크스페이스 선택
5. **Submit** 클릭
6. **Internal Integration Token** 복사 (secret_로 시작)

#### Notion 페이지 준비

1. Notion에서 로그를 저장할 **페이지** 생성 또는 선택
2. 페이지 우측 상단의 **⋯** 메뉴 클릭
3. **Connections** 또는 **Add connections** 선택
4. 생성한 Integration 추가
5. 페이지 URL에서 **Page ID** 복사:
   ```
   https://www.notion.so/your-workspace/PAGE_ID_HERE?v=...
   ```

#### Notion 데이터베이스 생성

환경 변수 설정 후 다음 스크립트를 실행하여 자동으로 데이터베이스를 생성합니다:

```bash
# .env에 Notion API 키 설정
NOTION_API_KEY=secret_your_api_key_here

# 데이터베이스 생성 스크립트 실행
node scripts/setup-notion-db.js <parent-page-id>
```

스크립트가 성공적으로 실행되면 데이터베이스 ID가 출력됩니다. 이를 `.env` 파일에 추가하세요.

## 설치 방법

### 1. 프로젝트 이동

```bash
cd slack_img_automation
```

### 2. Dependencies 설치

```bash
npm install
```

### 3. 환경 변수 파일 생성

예제 환경 변수 파일 복사:

```bash
cp .env.example .env
```

`.env` 파일을 열어서 인증 정보 입력:

```env
# 서버 설정
NODE_ENV=development
PORT=3000
LOG_LEVEL=info

# Slack 설정
SLACK_SIGNING_SECRET=your_slack_signing_secret_here
SLACK_BOT_TOKEN=xoxb-your-bot-token-here

# 대상 사용자 (선택 - 모든 사용자를 허용하려면 비워두기)
TARGET_USER_ID=

# Google Drive 설정
GOOGLE_DRIVE_FOLDER_ID=your_drive_folder_id_here

# 파일 업로드 설정
MAX_FILE_SIZE_MB=50
ALLOWED_IMAGE_TYPES=image/jpeg,image/png,image/gif,image/webp,image/bmp
CREATE_DATE_FOLDERS=true

# 재시도 설정
MAX_RETRY_ATTEMPTS=3
RETRY_DELAY_MS=2000

# 큐 설정
QUEUE_CONCURRENCY=3

# 알림 설정
SEND_COMPLETION_MESSAGE=true
SEND_ERROR_MESSAGE=true

# Notion 로깅 (선택 사항 - 사용하지 않으면 비워두기)
ENABLE_NOTION_LOGGING=false
NOTION_API_KEY=
NOTION_UPLOAD_LOG_DB_ID=
```

### 4. Google Credentials 추가

Google Service Account JSON 키를 다음 위치에 저장:
```
config/google-credentials.json
```

**중요**: 이 파일은 민감한 인증 정보를 포함합니다. Git에 절대 커밋하지 마세요!

## 사용 방법

### 개발 모드 (자동 재시작)

```bash
npm run dev
```

### 프로덕션 모드

```bash
npm start
```

### 로컬 개발용 ngrok 사용

Slack은 웹훅을 위해 HTTPS가 필요합니다. ngrok을 사용하여 보안 터널 생성:

1. ngrok 설치: [https://ngrok.com/download](https://ngrok.com/download)

2. 서버 시작:
   ```bash
   npm run dev
   ```

3. 다른 터미널에서 ngrok 시작:
   ```bash
   ngrok http 3000
   ```

4. HTTPS URL 복사 (예: `https://abc123.ngrok.io`)

5. Slack Event Subscriptions의 Request URL 업데이트:
   ```
   https://abc123.ngrok.io/slack/events
   ```

## 작동 원리

### 워크플로우

```
1. 사용자가 Slack에 이미지 업로드
   ↓
2. Slack이 /slack/events로 file_shared 이벤트 전송
   ↓
3. 서버가 Slack 서명 검증 (보안)
   ↓
4. 서버가 즉시 200 OK 응답 (3초 이내)
   ↓
5. 백그라운드 처리 시작
   ↓
6. Slack API에서 파일 정보 조회
   ↓
7. 파일 검증 (타입, 크기, 사용자)
   ↓
8. 데이터베이스 레코드 생성 (상태: pending)
   ↓
9. 처리 큐에 추가
   ↓
10. Slack에서 이미지 다운로드 (스트림)
    ↓
11. Google Drive에 업로드 (스트림)
    ↓
12. 데이터베이스 업데이트 (상태: completed)
    ↓
13. Notion에 업로드 내역 기록 (선택 사항)
    ↓
14. Slack에 성공 메시지 전송
```

### 폴더 구조

`CREATE_DATE_FOLDERS=true`인 경우, 파일이 날짜별로 정리됩니다:

```
Google Drive 폴더/
├── 2024-11-07/
│   ├── image1.png
│   ├── screenshot_20241107143022.png
│   └── photo.jpg
├── 2024-11-08/
│   ├── diagram.png
│   └── chart.jpg
```

### 파일명 중복 처리

동일한 이름의 파일이 존재하면 타임스탬프가 추가됩니다:

```
원본: image.png
중복: image_20241107143022.png
```

## API 엔드포인트

### POST /slack/events

Slack Events API 웹훅 수신.

**헤더:**
- `X-Slack-Signature` - 요청 서명
- `X-Slack-Request-Timestamp` - 요청 타임스탬프

**응답:**
- `200 OK` - 이벤트 수락
- `401 Unauthorized` - 잘못된 서명
- `400 Bad Request` - 잘못된 페이로드

### GET /health

통계가 포함된 헬스 체크 엔드포인트.

**응답:**
```json
{
  "status": "ok",
  "timestamp": "2024-11-07T14:30:22Z",
  "uptime": 12345,
  "database": "connected",
  "queue": {
    "pending": 2,
    "processing": 1,
    "idle": false,
    "concurrency": 3
  },
  "stats": {
    "totalUploads": 150,
    "pending": 2,
    "processing": 1,
    "completed": 145,
    "failed": 2,
    "successRate": "96.67"
  }
}
```

## 데이터베이스

SQLite 데이터베이스가 `data/uploads.db`에 자동 생성됩니다.

### 스키마

```sql
CREATE TABLE uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slack_file_id TEXT NOT NULL UNIQUE,
  slack_user_id TEXT NOT NULL,
  slack_user_name TEXT,
  channel_id TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  drive_file_id TEXT,
  drive_file_name TEXT,
  drive_file_url TEXT,
  drive_folder_path TEXT,
  status TEXT NOT NULL,              -- pending/processing/completed/failed
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  uploaded_at DATETIME
);
```

## 로깅

로그는 `logs/` 디렉토리에 저장됩니다:

- `combined.log` - 모든 로그
- `error.log` - 에러 로그만
- `exceptions.log` - 포착되지 않은 예외
- `rejections.log` - 처리되지 않은 Promise 거부

로그 레벨: `error`, `warn`, `info`, `debug`

`.env`에서 로그 레벨 설정:
```env
LOG_LEVEL=info
```

## 설정 옵션

### 파일 업로드

```env
# 최대 파일 크기 (메가바이트, 1-1000)
MAX_FILE_SIZE_MB=50

# 허용된 이미지 MIME 타입 (쉼표로 구분)
ALLOWED_IMAGE_TYPES=image/jpeg,image/png,image/gif,image/webp,image/bmp

# 날짜별 폴더 생성 (true/false)
CREATE_DATE_FOLDERS=true
```

### 큐

```env
# 동시 업로드 개수 (1-10)
QUEUE_CONCURRENCY=3
```

### 재시도

```env
# 실패한 업로드에 대한 최대 재시도 횟수 (1-10)
MAX_RETRY_ATTEMPTS=3

# 재시도 간 기본 지연 시간 (밀리초)
# Exponential backoff 사용: 2^attempt * RETRY_DELAY_MS
RETRY_DELAY_MS=2000
```

### 알림

```env
# Slack에 성공 메시지 전송 (true/false)
SEND_COMPLETION_MESSAGE=true

# Slack에 에러 메시지 전송 (true/false)
SEND_ERROR_MESSAGE=true
```

### Notion 로깅

```env
# Notion 로깅 활성화 (true/false)
ENABLE_NOTION_LOGGING=false

# Notion Integration API 키 (secret_로 시작)
NOTION_API_KEY=secret_your_api_key_here

# Notion 데이터베이스 ID (setup-notion-db.js로 생성)
NOTION_UPLOAD_LOG_DB_ID=your_database_id_here
```

**Notion 데이터베이스 구조:**

자동 생성되는 데이터베이스에는 다음 속성이 포함됩니다:
- **Upload ID** (제목) - Slack 파일 ID
- **Timestamp** - 업로드 시각
- **File Name** - 파일명
- **File Size (MB)** - 파일 크기
- **MIME Type** - 파일 타입
- **Slack User ID** - 업로드한 사용자 ID
- **Slack User Name** - 업로드한 사용자 이름
- **Channel ID** - 업로드된 채널
- **Drive File ID** - Google Drive 파일 ID
- **Drive URL** - Drive 링크
- **Status** - 상태 (Pending/Processing/Completed/Failed)
- **Error Message** - 에러 메시지 (실패 시)
- **Retry Count** - 재시도 횟수
- **Processing Time (ms)** - 처리 시간

### 사용자 필터링

특정 사용자의 업로드만 허용하려면:

```env
TARGET_USER_ID=U123456789
```

모든 사용자를 허용하려면 비워두세요.

## 문제 해결

### Slack 이벤트가 수신되지 않음

**증상**: `/slack/events`로 이벤트가 도착하지 않음

**해결 방법**:
1. Slack Event Subscriptions의 Request URL 확인
2. 서버가 실행 중이고 접근 가능한지 확인
3. ngrok 터널이 활성화되어 있는지 확인 (로컬 개발 시)
4. 서버 로그에서 에러 확인
5. Slack 앱이 워크스페이스에 설치되어 있는지 확인

### 잘못된 Slack 서명

**증상**: 로그에 `401 Unauthorized` 에러

**해결 방법**:
1. `.env`의 `SLACK_SIGNING_SECRET` 확인
2. 서버 시간이 정확한지 확인 (재생 공격 방지)
3. Raw body가 올바르게 캡처되고 있는지 확인

### Google Drive 업로드 실패

**증상**: Slack에서 파일 다운로드는 되지만 업로드 실패

**해결 방법**:
1. `config/google-credentials.json` 파일 존재 확인
2. Cloud Console에서 Google Drive API 활성화 확인
3. Service Account에 폴더에 대한 편집자 권한 있는지 확인
4. `GOOGLE_DRIVE_FOLDER_ID`가 올바른지 확인
5. Service Account 이메일이 JSON 키와 일치하는지 확인

### 파일 검증 실패

**증상**: 파일이 무시되거나 실패로 표시됨

**해결 방법**:
1. 파일 MIME 타입이 `ALLOWED_IMAGE_TYPES`에 포함되어 있는지 확인
2. 파일 크기가 `MAX_FILE_SIZE_MB` 이하인지 확인
3. `TARGET_USER_ID`가 설정된 경우 사용자가 일치하는지 확인
4. 로그에서 검증 에러 확인

### 큐 멈춤

**증상**: 파일이 "processing" 상태로 남아있음

**해결 방법**:
1. `GET /health` 엔드포인트로 큐 통계 확인
2. 멈춘 작업에 대한 에러 로그 확인
3. 서버 재시작으로 큐 초기화
4. 과부하인 경우 `QUEUE_CONCURRENCY` 줄이기

## 프로덕션 배포

### 환경 변수

프로덕션에서 `NODE_ENV=production` 설정:

```env
NODE_ENV=production
LOG_LEVEL=warn
```

### 프로세스 매니저

PM2를 사용하여 서버 유지:

```bash
npm install -g pm2

pm2 start server.js --name slack-to-drive
pm2 save
pm2 startup
```

### 리버스 프록시

nginx를 사용한 요청 프록시:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### SSL 인증서

Let's Encrypt를 사용한 HTTPS:

```bash
sudo certbot --nginx -d your-domain.com
```

## 보안 모범 사례

1. **비밀 정보 절대 커밋 금지**
   - `.env`를 `.gitignore`에 추가
   - `google-credentials.json` 절대 커밋 금지

2. **환경 변수 사용**
   - 모든 비밀 정보를 `.env`에 저장
   - 개발/프로덕션에 다른 값 사용

3. **서명 검증 활성화**
   - 항상 Slack 서명 검증
   - 5분 이상 된 요청 거부

4. **파일 접근 제한**
   - 필요시 `TARGET_USER_ID` 설정
   - 모든 파일 타입과 크기 검증

5. **HTTPS 사용**
   - Slack 웹훅에 필수
   - ngrok(개발) 또는 SSL 인증서(프로덕션) 사용

6. **로그 모니터링**
   - 정기적으로 에러 로그 확인
   - 실패에 대한 알림 설정

## 개발

### 프로젝트 구조

```
slack_img_automation/
├── config/
│   ├── index.js                 # 설정 관리
│   └── google-credentials.json  # Google Service Account 키 (gitignored)
├── services/
│   ├── slackService.js          # Slack API 연동
│   ├── driveService.js          # Google Drive API 연동
│   ├── queueService.js          # 비동기 큐 관리
│   └── notionLogger.js          # Notion 업로드 로그
├── utils/
│   ├── logger.js                # Winston 로거
│   ├── database.js              # SQLite 데이터베이스
│   └── validator.js             # 입력 검증
├── middleware/
│   └── slackVerification.js     # Slack 서명 검증
├── scripts/
│   └── setup-notion-db.js       # Notion 데이터베이스 생성
├── logs/                         # 로그 파일 (자동 생성)
├── data/                         # 데이터베이스 파일 (자동 생성)
├── server.js                     # Express 메인 서버
├── package.json
├── .env                          # 환경 변수 (gitignored)
├── .env.example                  # 환경 변수 템플릿
└── README.md
```

### 테스트

Slack 연결 테스트:
```javascript
const slackService = require('./services/slackService');
await slackService.testConnection();
```

Google Drive 연결 테스트:
```javascript
const driveService = require('./services/driveService');
await driveService.testConnection();
```

## 라이선스

MIT

## 지원

문제 및 질문:
1. 문제 해결 섹션 확인
2. `logs/`에서 서버 로그 확인
3. Slack Event Subscriptions 상태 확인
4. Google Drive 권한 확인

## 크레딧

사용 기술:
- [Express.js](https://expressjs.com/) - 웹 프레임워크
- [@slack/web-api](https://www.npmjs.com/package/@slack/web-api) - Slack API 클라이언트
- [googleapis](https://www.npmjs.com/package/googleapis) - Google Drive API
- [@notionhq/client](https://www.npmjs.com/package/@notionhq/client) - Notion API 클라이언트
- [Winston](https://www.npmjs.com/package/winston) - 로깅
- [better-sqlite3](https://www.npmjs.com/package/better-sqlite3) - SQLite 데이터베이스
- [async](https://www.npmjs.com/package/async) - 큐 관리
