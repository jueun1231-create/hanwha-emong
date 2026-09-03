/**
 * 한화에몽 MarketView — 일일 시장데이터 갱신 (GitHub Actions에서 매일 실행)
 * Yahoo Finance chart API(무키·무료, 서버측이라 CORS 무관)에서 실측값을 받아
 * index.html 안의 데이터 배열을 in-place 로 갱신한다.
 * 디자인·구조·인사이트 텍스트는 건드리지 않는다. 실패한 티커는 기존 값 유지.
 *
 * Node 20+ (내장 fetch 사용, 의존성 없음).
 */
import { readFile, writeFile } from 'node:fs/promises';

const FILE = new URL('../index.html', import.meta.url);
const UA = { headers: { 'User-Agent': 'Mozilla/5.0 (hanwha-emong daily updater)' } };

/* ---- 티커 설정: [파일상 tk값, Yahoo 심볼, val소수, spark소수] ---- */
const IDX = [
  ['KOSPI', '^KS11', 2, 0], ['KOSDAQ', '^KQ11', 2, 0],
  ['IXIC', '^IXIC', 2, 0], ['GSPC', '^GSPC', 2, 0],
  ['DJI', '^DJI', 2, 0], ['N225', '^N225', 2, 0],
  ['SSEC', '000001.SS', 2, 0], ['SX5E', '^STOXX50E', 2, 0],
];
const COM = [
  ['CL=F', 'CL=F', 2, 1], ['BZ=F', 'BZ=F', 2, 1], ['GC=F', 'GC=F', 1, 0],
  ['SI=F', 'SI=F', 2, 1], ['HG=F', 'HG=F', 3, 2], ['NG=F', 'NG=F', 3, 2],
];
const FX = [
  ['USD/KRW', 'KRW=X', 1, 0], ['DXY', 'DX-Y.NYB', 2, 2], ['EUR/USD', 'EURUSD=X', 4, 3],
  ['USD/JPY', 'JPY=X', 2, 1], ['USD/CNY', 'CNY=X', 3, 3],
];
const RATE = [ // 금리: val 3소수, chg 는 bp, spark 2소수
  ['DGS30', '^TYX'], ['DGS10', '^TNX'], ['DGS5', '^FVX'],
];
const STOCKS = [ // P5 월별 종가만 갱신 (symbol값, cur)
  ['NVDA', 'NVDA', 'USD'], ['AVGO', 'AVGO', 'USD'], ['TSM', 'TSM', 'USD'],
  ['ORCL', 'ORCL', 'USD'], ['PLTR', 'PLTR', 'USD'],
  ['000660.KS', '000660.KS', 'KRW'], ['005930.KS', '005930.KS', 'KRW'],
  ['012450.KS', '012450.KS', 'KRW'], ['034020.KS', '034020.KS', 'KRW'],
  ['042700.KS', '042700.KS', 'KRW'],
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const grp = (n, d) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const plain = (n, d) => Number(n).toFixed(d);

// 실행일(KST) 기준 직전 영업일 (YYYY-MM-DD). 공휴일은 무시(근사).
function prevBusinessDayKST() {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
const PREV_BDAY = prevBusinessDayKST();

// 타임스탬프와 종가를 짝지어 null 제거 + 날짜 오름차순. [{d:'YYYY-MM-DD', v:number}, ...]
async function chart(sym, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${range === '1y' ? '1mo' : '1d'}`;
  const r = await fetch(url, UA);
  if (!r.ok) throw new Error(`${sym} HTTP ${r.status}`);
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  const ts = res?.timestamp || [];
  const cl = res?.indicators?.quote?.[0]?.close || [];
  const bars = ts
    .map((t, i) => ({ d: new Date(t * 1000).toISOString().slice(0, 10), v: cl[i] }))
    .filter((b) => b.v != null && Number.isFinite(b.v))
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  if (bars.length < 3) throw new Error(`${sym} no data`);
  return bars;
}

/** tk:'X' 를 포함하는 한 줄짜리 mcard 객체 리터럴(중첩 {} 없음) 안의 필드만 치환 */
function patchTk(html, tk, mut) {
  const re = new RegExp(`(\\{[^\\n{}]*tk:'${esc(tk)}'[^\\n{}]*\\})`);
  if (!re.test(html)) return null;
  return html.replace(re, (m) => mut(m));
}
/** STOCKS 항목: symbol:'X' 에서 같은 줄의 closes:[...] 만 치환 (targets:{} 중첩 허용) */
function patchCloses(html, sym, arrStr) {
  const re = new RegExp(`(symbol:'${esc(sym)}'[^\\n]*?closes:\\[)[^\\]]*(\\])`);
  if (!re.test(html)) return null;
  return html.replace(re, `$1${arrStr}$2`);
}

async function run() {
  let html = await readFile(FILE, 'utf8');
  let ok = 0, fail = 0, skip = 0;

  const doQuote = async (list, range, kind) => {
    for (const [tk, sym, vd, sd] of list) {
      try {
        const bars = await chart(sym, range);
        const lastBar = bars[bars.length - 1];
        const last = lastBar.v, prev = bars[bars.length - 2].v;
        const isRate = /^\^(TYX|TNX|FVX)$/.test(sym);
        const chgNum = last - prev;
        const pct = isRate ? Math.sign(chgNum) : +(chgNum / prev * 100).toFixed(2);

        // 가드 1: Yahoo 최신 봉이 직전 영업일보다 오래됨 = 데이터 지연 → 기존 값 유지
        if (lastBar.d < PREV_BDAY) {
          console.warn(`  skip 지연 ${tk} (Yahoo 최신 ${lastBar.d} < ${PREV_BDAY})`); skip++; continue;
        }
        // 가드 2: 지수 일간 변동 7% 이상 = 이상봉 의심 → 기존 값 유지
        if (kind === 'idx' && Math.abs(pct) >= 7) {
          console.warn(`  skip 이상치 ${tk} (${pct}%)`); skip++; continue;
        }

        const valStr = isRate ? plain(last, 3)
          : (vd >= 3 ? plain(last, vd) : grp(last, vd));
        const chgStr = isRate ? Math.abs(chgNum * 100).toFixed(1)
          : (vd >= 3 ? plain(Math.abs(chgNum), vd) : grp(Math.abs(chgNum), vd));
        const spk = bars.map((b) => isRate ? plain(b.v, 2) : (sd === 0 ? Math.round(b.v) : plain(b.v, sd))).join(',');
        const next = patchTk(html, tk, (m) => m
          .replace(/val:'[^']*'/, `val:'${valStr}'`)
          .replace(/chg:'[^']*'/, `chg:'${chgStr}'`)
          .replace(/pct:-?[\d.]+/, `pct:${pct}`)
          .replace(/spark:\[[^\]]*\]/, `spark:[${spk}]`));
        if (next == null) { console.warn('  항목 못 찾음', tk); fail++; }
        else { html = next; ok++; }
      } catch (e) { console.warn('  fail', sym, e.message); fail++; }
    }
  };

  console.log('· 지수'); await doQuote(IDX, '1mo', 'idx');
  console.log('· 원자재'); await doQuote(COM, '1mo', 'com');
  console.log('· 환율'); await doQuote(FX, '1mo', 'fx');
  console.log('· 금리'); await doQuote(RATE, '1mo', 'rate');

  console.log('· P5 월별 종가');
  for (const [sy, sym, cur] of STOCKS) {
    try {
      const bars = await chart(sym, '1y');
      const arr = bars.slice(-13).map((b) => cur === 'USD' ? +b.v.toFixed(2) : Math.round(b.v));
      const next = patchCloses(html, sy, arr.join(','));
      if (next == null) { console.warn('  항목 못 찾음', sy); fail++; }
      else { html = next; ok++; }
    } catch (e) { console.warn('  fail', sym, e.message); fail++; }
  }

  // 기준일자(KST) 갱신
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const asofDot = `${kst.getUTCFullYear()}.${String(kst.getUTCMonth() + 1).padStart(2, '0')}.${String(kst.getUTCDate()).padStart(2, '0')}`;
  const asofDash = asofDot.replace(/\./g, '-');
  html = html
    .replace(/(\d{4}\.\d{2}\.\d{2}) 기준<\/span>/, `${asofDot} 기준</span>`)
    .replace(/기준 \d{4}\.\d{2}\.\d{2} ·/, `기준 ${asofDot} ·`)
    .replace(/기준 \d{4}\.\d{2}\.\d{2}\. <span class="tag-mock">/, `기준 ${asofDot}. <span class="tag-mock">`)
    .replace(/Yahoo Finance, \d{4}-\d{2}-\d{2} 기준/, `Yahoo Finance, ${asofDash} 기준`);

  // 구조 sanity: <script> 짝(주석 언급 2건 제외) 확인
  const so = (html.match(/<script/g) || []).length - 2, sc = (html.match(/<\/script>/g) || []).length;
  if (so !== sc) throw new Error(`script 태그 불균형 ${so}/${sc} — 커밋 취소`);

  await writeFile(FILE, html);
  console.log(`\n갱신 완료: ${asofDot} · 성공 ${ok} / 실패 ${fail} / 건너뜀(지연·이상치) ${skip}`);
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
