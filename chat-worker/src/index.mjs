const SYSTEM_PROMPT = `You are MarketView AI, an assistant for Hanwha Future Strategy Office's financial intelligence dashboard.
Answer in Korean unless the user asks otherwise. Use only the user-provided question and copied dashboard context; do not invent figures, dates, sources, or real-time market facts. Clearly distinguish facts in the supplied text from interpretation. Explain financial terms plainly and concisely. This is informational analysis, not personalised investment advice.`;

const MAX_QUESTION_CHARS = 2_000;
const MAX_CONTEXT_CHARS = 8_000;

function corsHeaders(origin, allowedOrigins) {
  return {
    'Access-Control-Allow-Origin': origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function outputText(response) {
  return (response.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === 'output_text')
    .map((item) => item.text)
    .join('')
    .trim();
}

export default {
  async fetch(request, env) {
    const allowedOrigins = (env.ALLOWED_ORIGIN || '')
      .split(',').map((origin) => origin.trim()).filter(Boolean);
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin, allowedOrigins);

    if (request.method === 'OPTIONS') return new Response(null, { headers });
    if (request.method !== 'POST') return Response.json({ error: 'POST 요청만 허용됩니다.' }, { status: 405, headers });
    if (!allowedOrigins.includes(origin)) return Response.json({ error: '허용되지 않은 요청 출처입니다.' }, { status: 403, headers });
    if (!env.OPENAI_API_KEY) return Response.json({ error: '서버의 OpenAI API 키가 설정되지 않았습니다.' }, { status: 503, headers });

    let payload;
    try { payload = await request.json(); } catch { return Response.json({ error: '올바른 JSON 요청이 아닙니다.' }, { status: 400, headers }); }
    const question = String(payload.question || '').trim().slice(0, MAX_QUESTION_CHARS);
    const context = String(payload.context || '').trim().slice(0, MAX_CONTEXT_CHARS);
    if (!question) return Response.json({ error: '질문을 입력해 주세요.' }, { status: 400, headers });

    const copiedText = context ? `\n\n[사용자가 복사한 대시보드 내용]\n${context}` : '';
    const apiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        instructions: SYSTEM_PROMPT,
        input: `${question}${copiedText}`,
        reasoning: { effort: 'low' },
        max_output_tokens: 700,
        store: false,
      }),
    });
    const data = await apiResponse.json();
    if (!apiResponse.ok) {
      const message = data?.error?.message || 'OpenAI 응답을 가져오지 못했습니다.';
      return Response.json({ error: message }, { status: apiResponse.status, headers });
    }
    const answer = outputText(data);
    if (!answer) return Response.json({ error: '응답 텍스트를 생성하지 못했습니다.' }, { status: 502, headers });
    return Response.json({ answer }, { headers });
  },
};
