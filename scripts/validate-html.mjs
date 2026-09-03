/**
 * index.html 무결성 검사 — Claude 서술 갱신 스텝 뒤에 실행.
 * 깨졌다고 판단되면 exit 1 → 워크플로가 해당 변경을 되돌린다.
 *
 * 인자: node scripts/validate-html.mjs <기준_바이트수>
 *   기준_바이트수를 주면 크기 급변(±35% 초과)도 실패로 본다.
 */
import { readFile } from 'node:fs/promises';

const FILE = new URL('../index.html', import.meta.url);
const baseBytes = Number(process.argv[2]) || 0;

const html = await readFile(FILE, 'utf8');
const bytes = Buffer.byteLength(html, 'utf8');   // wc -c 와 같은 단위
const errs = [];

/* 1. 크기 급변 */
if (baseBytes > 0) {
  const ratio = bytes / baseBytes;
  if (ratio < 0.65 || ratio > 1.35) {
    errs.push(`파일 크기 급변: ${baseBytes} → ${bytes} (${(ratio * 100).toFixed(0)}%)`);
  }
}

/* 2. <script> 태그 짝 (주석 언급분 2건 제외 — 원 스크립트와 동일 규칙) */
const so = (html.match(/<script/g) || []).length - 2;
const sc = (html.match(/<\/script>/g) || []).length;
if (so !== sc) errs.push(`<script> 불균형: ${so} / ${sc}`);

/* 3. 핵심 구조 문자열이 살아있는지 */
const must = [
  '한화 미래전략실', 'MarketView',
  'var IDX=', 'var COM=', 'var FX=', 'var RATE=', 'var STOCKS=',
  'var NAV=', 'var ISSUES=', 'var IPO=', 'var LT',
  'id="p2"', 'id="p4"', 'id="p6"',
  'class="insight"',
];
for (const s of must) if (!html.includes(s)) errs.push(`필수 문자열 사라짐: ${s}`);

/* 4. 중괄호 / 대괄호 대략 균형 (문자열 안까지 세므로 정확치 않아 10% 여유) */
const bal = (a, b) => {
  const o = (html.match(new RegExp('\\' + a, 'g')) || []).length;
  const c = (html.match(new RegExp('\\' + b, 'g')) || []).length;
  if (Math.abs(o - c) > Math.max(4, o * 0.02)) errs.push(`${a}${b} 불균형: ${o} / ${c}`);
};
bal('{', '}');
bal('[', ']');

/* 5. </html> 로 끝나는지 */
if (!/<\/html>\s*$/.test(html)) errs.push('</html> 로 끝나지 않음 (잘림 의심)');

if (errs.length) {
  console.error('무결성 검사 실패:\n - ' + errs.join('\n - '));
  process.exit(1);
}
console.log(`무결성 OK (${bytes} bytes)`);
