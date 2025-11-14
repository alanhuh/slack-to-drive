# Bulk Upload 사용 가이드

과거 Slack 메시지에서 이미지를 소급해서 Google Drive에 업로드하는 기능입니다.

## 기능 설명

- Slack의 특정 채널/유저가 업로드한 과거 이미지를 일괄 업로드
- 이미 업로드된 파일은 자동으로 건너뛰기 (중복 방지)
- Google Drive에 자동 업로드 + Notion 로그 기록
- API Rate Limit 고려한 배치 처리 (10개씩, 2초 간격)

## 사전 준비

### 1. OAuth 2.0 인증 완료

Bulk Upload를 실행하기 전에 먼저 OAuth 인증이 완료되어 있어야 합니다.

```bash
# 서버 실행
npm start

# 브라우저에서 OAuth 인증
# http://localhost:3000/oauth/authorize 접속
```

Google 로그인 후 Drive 권한 승인하면 토큰이 자동으로 DB에 저장됩니다.

### 2. Slack 토큰 설정

`.env` 파일에 다음 토큰들이 설정되어 있어야 합니다:

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_SIGNING_SECRET=your_slack_signing_secret_here
```

## 사용법

### 기본 명령어

```bash
node scripts/bulk-upload-from-slack.js [옵션]
```

### 옵션

- `--channel <CHANNEL_ID>` - 특정 채널의 이미지만 업로드
- `--user <USER_ID>` - 특정 유저의 이미지만 업로드

### 사용 예시

#### 1. 특정 채널의 특정 유저 이미지 업로드

```bash
node scripts/bulk-upload-from-slack.js --channel C09MSMEACP3 --user U032G2ZJ96J
```

#### 2. 특정 채널의 모든 이미지 업로드

```bash
node scripts/bulk-upload-from-slack.js --channel C09MSMEACP3
```

#### 3. 특정 유저의 모든 이미지 업로드 (모든 채널)

```bash
node scripts/bulk-upload-from-slack.js --user U032G2ZJ96J
```

## 실행 결과

스크립트를 실행하면 다음과 같은 과정이 진행됩니다:

```
🚀 Slack Bulk Upload Script
============================

Options:
  Channel: C09MSMEACP3
  User: U032G2ZJ96J
  Batch size: 10
  Delay: 2000ms

📡 Testing Slack connection...
✅ Slack connection OK

📁 Testing Google Drive connection...
✅ Drive connection OK

📝 Testing Notion connection...
✅ Notion connection OK

📥 Fetching files from Slack...
✅ Found 9 image files

📊 Upload Statistics:
  Total files: 9
  Already uploaded: 0
  To upload: 9

🔄 Starting batch upload...

[1/9] Processing: image.png
[1/9] ✅ Success: https://drive.google.com/file/d/...

[2/9] Processing: image.png
[2/9] ✅ Success: https://drive.google.com/file/d/...

...

============================
📊 Upload Complete!
============================

✅ Success: 9
❌ Failed: 0
📈 Success rate: 100.00%
```

## Channel ID / User ID 찾는 방법

### Channel ID 찾기

1. Slack 웹/앱에서 채널 열기
2. 채널 이름 클릭 → "채널 세부정보" 보기
3. 하단에 "채널 ID" 확인 (예: `C09MSMEACP3`)

또는 URL에서 확인:
```
https://app.slack.com/client/T123ABC/C09MSMEACP3
                                    ^^^^^^^^^^^^
                                    Channel ID
```

### User ID 찾기

1. Slack 웹/앱에서 사용자 프로필 열기
2. "추가 옵션" (점 3개) → "멤버 ID 복사"
3. User ID 확인 (예: `U032G2ZJ96J`)

또는 개발자 모드에서:
```bash
# Slack API로 사용자 목록 조회
curl -H "Authorization: Bearer xoxb-your-token" \
  https://slack.com/api/users.list
```

## 주의사항

### 1. 중복 업로드 방지

- 이미 업로드된 파일은 SQLite 데이터베이스에서 확인
- `uploads` 테이블의 `slack_file_id`로 중복 체크
- 중복 파일은 자동으로 건너뜀

### 2. API Rate Limit

- Slack API: 초당 1회 제한
- 배치 처리: 10개 파일마다 2초 대기
- 대량 파일 업로드 시 시간이 오래 걸릴 수 있음

### 3. 파일 크기 제한

`.env` 파일의 `MAX_FILE_SIZE_MB` 설정 확인:

```env
MAX_FILE_SIZE_MB=50
```

### 4. Notion 로그

`ENABLE_NOTION_LOGGING=true`로 설정되어 있으면:
- 모든 업로드가 Notion 데이터베이스에 자동 기록
- 상태: Pending → Processing → Completed/Failed
- 처리 시간, 에러 메시지 등 상세 정보 저장

## 트러블슈팅

### "No OAuth tokens found" 에러

**원인:** Google Drive OAuth 인증이 안 되어 있음

**해결:**
```bash
# 서버 실행
npm start

# 브라우저에서 OAuth 인증
http://localhost:3000/oauth/authorize
```

### "invalid_auth" 에러 (Slack)

**원인:** Slack Bot Token이 유효하지 않음

**해결:**
1. `.env` 파일의 `SLACK_BOT_TOKEN` 확인
2. Slack App 설정에서 토큰 재발급
3. `.env` 파일 업데이트 후 재실행

### 파일을 못 찾는 경우

**원인:** Channel ID 또는 User ID가 잘못됨

**해결:**
1. Slack에서 정확한 ID 확인
2. `--channel` 또는 `--user` 옵션 다시 확인
3. 옵션 없이 실행하면 에러 메시지 출력

### "File not found" 에러 (Drive)

**원인:** Drive 폴더 ID가 잘못되었거나 권한 없음

**해결:**
1. `.env` 파일의 `GOOGLE_DRIVE_FOLDER_ID` 확인
2. OAuth로 인증한 Google 계정에 폴더 접근 권한 확인
3. 폴더 ID는 Drive URL에서 확인:
   ```
   https://drive.google.com/drive/folders/14q2GmRNWiQ-Rz5sk9OA7qPlr-kAGns5b
                                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
   ```

## 성능 최적화

### 대량 파일 업로드 시

배치 크기와 지연 시간을 조정할 수 있습니다:

`scripts/bulk-upload-from-slack.js` 파일 수정:

```javascript
const BATCH_SIZE = 20; // 기본: 10개
const DELAY_MS = 1000; // 기본: 2000ms (2초)
```

**주의:** 너무 빠르게 설정하면 API Rate Limit에 걸릴 수 있습니다.

## Notion 데이터베이스 확인

업로드 내역은 Notion 데이터베이스에서 확인할 수 있습니다:

```
https://notion.so/2aa5f49d595a81589d68e176cfacba14
```

### 기록되는 정보

- Upload ID (Slack File ID)
- Timestamp (업로드 시간)
- File Name (파일명)
- File Size (MB)
- MIME Type
- Slack User ID / Name
- Channel ID
- Drive File ID / URL
- Status (Pending/Processing/Completed/Failed)
- Error Message (실패 시)
- Retry Count (재시도 횟수)
- Processing Time (ms) (처리 시간)

## 데이터베이스 관리

### 업로드 히스토리 확인

```bash
# SQLite DB 직접 조회 (DB 도구 필요)
sqlite3 data/uploads.db "SELECT * FROM uploads WHERE status='completed';"
```

### 데이터베이스 정리

업로드 테스트 후 기록을 모두 삭제하고 싶다면:

#### 1. Notion 데이터베이스 정리

```bash
node scripts/clear-notion-db.js
```

모든 Notion 페이지를 archive(삭제)합니다.

#### 2. SQLite 데이터베이스 정리

```bash
node scripts/clear-sqlite-db.js
```

모든 업로드 기록을 삭제합니다.

#### 3. 한번에 정리

```bash
# 두 스크립트를 순차적으로 실행
node scripts/clear-notion-db.js && node scripts/clear-sqlite-db.js
```

### 특정 파일 재업로드

이미 업로드된 파일을 다시 업로드하려면:

```bash
# SQLite에서 해당 레코드 삭제
sqlite3 data/uploads.db "DELETE FROM uploads WHERE slack_file_id='F09SMHY3D18';"

# 스크립트 재실행
node scripts/bulk-upload-from-slack.js --channel C09MSMEACP3 --user U032G2ZJ96J
```

## FAQ

### Q: 업로드 중 중단하면 어떻게 되나요?

A: 이미 완료된 파일은 DB에 기록되어 있으므로, 다시 실행하면 건너뛰고 나머지만 업로드합니다.

### Q: 특정 기간의 파일만 업로드할 수 있나요?

A: 현재는 지원하지 않습니다. 모든 이미지 파일을 검색합니다.

### Q: 이미지 외 다른 파일도 업로드되나요?

A: 아니요. 스크립트는 `types: 'images'` 옵션으로 이미지만 검색합니다.

### Q: Slack 무료 플랜에서도 작동하나요?

A: 네, Slack API는 무료 플랜에서도 사용 가능합니다. 다만 무료 플랜은 90일 이전 메시지에 접근할 수 없습니다.

---

**문의사항이 있으면 GitHub Issues에 남겨주세요:**
https://github.com/alanhuh/slack-to-drive/issues


/*

ad님 이미지 BULK
node scripts/bulk-upload-from-slack.js --channel C098RHN405 --user U9U4L7A74


심신을 수련하자 채널
https://nerdystar.slack.com/archives/C098RHN405T

AD님 ID
U9U4L7A74

*/
