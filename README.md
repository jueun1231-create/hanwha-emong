# 한화에몽 MarketView — 자동 갱신 대시보드

단일 HTML 대시보드(`index.html`)를 **GitHub Pages**로 호스팅하고,
**GitHub Actions**가 매일 08:05 KST에 시장 데이터를 실측값으로 갱신 → 커밋 →
Pages가 자동 재배포한다. 링크를 공유하면 받는 사람도 **항상 최신본**을 본다.

## 자동 갱신 범위 (`scripts/update-market-data.mjs`)

Yahoo Finance chart API(무키·무료, Actions 러너는 서버측이라 CORS 무관)에서 실측:

| 대상 | 갱신 필드 |
|---|---|
| 지수 8 (코스피·코스닥·나스닥·S&P·다우·니케이·상해·유로스톡스) | `val` `chg` `pct` `spark` |
| 원자재 6 (WTI·브렌트·금·은·구리·천연가스) | 〃 |
| 환율 5 (원/달러·달러인덱스·유로·엔·위안) | 〃 |
| 미 국채 3 (30·10·5년) | 〃 (변화폭 bp) |
| P5 중장기 종목 10 (엔비디아·브로드컴·TSMC·오라클·팔란티어·SK하이닉스·삼성전자·한화에어로·두산에너빌리티·한미반도체) | 월별 종가 `closes` |
| 기준일자 문자열 3곳 | 실행일(KST) |

디자인·구조·인사이트 텍스트·캘린더·수급·리그테이블은 **건드리지 않는다**.
페치 실패한 항목은 기존 값을 유지하며, `<script>` 태그 균형이 깨지면 커밋을 취소한다.

## 최초 세팅 (1회)

1. 새 GitHub 저장소 생성 후 이 폴더 전체를 push
   ```bash
   git init && git add . && git commit -m "init"
   git branch -M main
   git remote add origin https://github.com/<계정>/<저장소>.git
   git push -u origin main
   ```
2. **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main` / `/ (root)` → Save
   → 몇 분 뒤 `https://<계정>.github.io/<저장소>/` 에서 열림
3. **Settings → Actions → General → Workflow permissions** → **Read and write permissions** 체크 (Actions가 커밋하려면 필요)
4. **Actions** 탭 → `daily-market-update` → **Run workflow** 로 첫 실행 테스트

이후 매일 08:05 KST 자동 실행. 수동 갱신은 언제든 Actions 탭에서 **Run workflow**.

## 로컬 테스트

```bash
node scripts/update-market-data.mjs   # index.html 을 그 자리에서 갱신
```

## 참고

- 인사이트·캘린더·전일수급·리그테이블 등 분석/서술 콘텐츠는 자동 갱신 대상이 아니며,
  주기적으로 수동 업데이트하거나 별도 Claude 스텝(`hanwha-emong-daily-prompt.md`)을 추가해 처리한다.
- cron 은 UTC 기준. 08:05 KST = `5 23 * * *`.
