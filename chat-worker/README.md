# MarketView AI Worker

GitHub Pages는 정적 호스팅이므로 OpenAI API 키를 안전하게 보관할 수 없습니다. 이 Cloudflare Worker가 브라우저와 OpenAI Responses API 사이의 비공개 프록시 역할을 합니다.

## 배포

1. [Cloudflare 계정](https://dash.cloudflare.com/)에 로그인한 뒤, 저장소 루트에서 `npx wrangler login`을 실행합니다.
2. `npx wrangler secret put OPENAI_API_KEY`를 실행하고 OpenAI API 키를 입력합니다. 키는 절대 `index.html`, GitHub Secrets가 아닌 코드, 또는 커밋에 넣지 마세요.
3. `npx wrangler deploy --config chat-worker/wrangler.toml`를 실행합니다.
4. 출력되는 Worker URL 뒤에 `/chat`을 붙이지 말고, URL 자체를 `index.html`의 `MARKETVIEW_CHAT_API` 값에 입력합니다.

Worker는 `gpt-5.4-mini`와 Responses API를 사용하며 질문 2,000자·붙여넣은 문맥 8,000자로 제한합니다. 운영 전 Cloudflare WAF 또는 Rate Limiting 규칙으로 `POST` 요청의 IP당 요청 수를 제한하세요.
