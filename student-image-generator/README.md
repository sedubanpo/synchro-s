# Student Schedule Image Generator

## 1) Install
```bash
npm init -y
npm i -D playwright
npx playwright install chromium
```

## 2) Generate PNG (1080x1920)
```bash
node render-playwright.mjs sample-data.json out
```

Output file naming rule:
- `schedule_<studentId>_<YYYYMMDD>.png`

## 3) Data format
```json
{
  "studentId": "kimhaul_001",
  "studentName": "김하율",
  "dateLabel": "2/21(토)_방학",
  "dayStatus": "방학",
  "items": [
    {
      "start": "10",
      "end": "13",
      "subject": "수학",
      "teacher": "안준성T",
      "room": "1강의실",
      "typeTag": "개별",
      "durationLabel": "3시간",
      "status": "scheduled",
      "statusLabel": "정규"
    }
  ]
}
```
