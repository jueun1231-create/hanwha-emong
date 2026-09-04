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
// P5 SECTORS 의 종목 심볼은 index.html 에서 파싱한다(주간 종목 교체를 자동 반영).
function deriveStocks(html) {
  const seen = new Set(), out = [];
  const re = /symbol:'([^']+)',cur:'(USD|KRW)'/g;
  let m;
  while ((m = re.exec(html))) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push([m[1], m[1], m[2]]);
  }
  return out;
}

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

/* 네이버 금융 공개 표에서 전 거래일 시장 전체 투자자별 순매수(억원)를 읽는다.
 * KRX 최종값을 인용하는 공개 표이며, 페이지가 일시적으로 실패하면 기존 값을 보존한다. */
async function investorFlow(sosok, targetIso) {
  const url = `https://finance.naver.com/sise/investorDealTrendDay.naver?bizdate=${targetIso.replaceAll('-', '')}&sosok=${sosok}&page=1`;
  const r = await fetch(url, UA);
  if (!r.ok) throw new Error(`investor ${sosok} HTTP ${r.status}`);
  const body = await r.text();
  const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
    [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((x) =>
      x[1].replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/gi, ' ').trim()));
  const candidates = rows.map((cells) => {
    const d = cells[0]?.match(/(\d{2})\.(\d{2})\.(\d{2})/);
    if (!d || cells.length < 8) return null;
    const iso = `20${d[1]}-${d[2]}-${d[3]}`;
    const nums = cells.slice(1).map((x) => Number(x.replace(/,/g, '').replace(/[+−]/g, (s) => s === '−' ? '-' : '')));
    if (nums.some((x) => Number.isNaN(x))) return null;
    // 네이버 표 순서: 개인, 외국인, 기관계, ... 기타법인
    return { iso, personal: nums[0], foreign: nums[1], institution: nums[2], other: nums[9] ?? 0 };
  }).filter(Boolean).filter((x) => x.iso <= targetIso).sort((a, b) => b.iso.localeCompare(a.iso));
  if (!candidates.length) throw new Error(`investor ${sosok} no dated rows`);
  // 최신 거래일과 직전 거래일을 함께 반환한다. P4 '최근 흐름'은
  // 누적값이 아니라 각 거래일의 외국인 순매수/순매도 일자별 값이다.
  return { ...candidates[0], previous: candidates[1] ?? null };
}

function flowText(n) {
  const v = Math.round(n);
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toLocaleString('ko-KR')}억`;
}
function patchFlowBars(html, id, f) {
  const re = new RegExp(`dbars\\('${id}',\\[[^\\n]*?\\]\\);`);
  const rows = [
    { k: '개인', v: Math.round(f.personal) },
    { k: '외국인', v: Math.round(f.foreign) },
    { k: '기관', v: Math.round(f.institution) },
    { k: '기타법인', v: Math.round(f.other) },
  ];
  const literal = rows.map((x) => `{k:'${x.k}',v:${x.v}}`).join(',');
  return html.replace(re, `dbars('${id}',[${literal}]);`);
}
function patchFlowTrend(html, latest, previous) {
  if (!previous) return html;
  const fmt = (iso) => {
    const [, m, d] = iso.split('-').map(Number);
    return `${m}월 ${d}일`;
  };
  const v1 = Math.round(previous.foreign);
  const v2 = Math.round(latest.foreign);
  const mx = Math.max(Math.abs(v1), Math.abs(v2), 1);
  const bar = (label, value) => {
    const buy = value >= 0;
    const p = Math.abs(value) / mx * 48;
    return `<div class="tb-row"><span class="tb-k">${label}</span><div class="dbar-track"><span class="dbar-zero"></span><span class="dbar-fill ${buy ? 'b' : 's'}" style="width:${p.toFixed(1)}%;${buy ? 'left:50%' : 'right:50%'}"></span></div><span class="dbar-v ${buy ? 'up' : 'down'}">${flowText(value)}</span></div>`;
  };
  const block = `(function(){
    var mx=${mx};
    document.getElementById('trend5').innerHTML=
      '<div class="fbox"><div class="dbar-axis"><span>순매도</span><span>순매수</span></div>'
      +${JSON.stringify(bar(fmt(previous.iso), v1))}
      +${JSON.stringify(bar(fmt(latest.iso), v2))}
      +'<div class="fnote">KOSPI 외국인 순매수·순매도, 각 거래일 수치(단위 억원). 네이버 금융 공개표 기준.</div></div>';
  })();`;
  const re = /(dbars\('db-kosdaq',[\s\S]*?\n\s+)(\(function\(\)\{[\s\S]*?\n\s+\}\)\(\);)/;
  return html.replace(re, `$1${block}`);
}
function patchFlowInsight(html, date, k, q) {
  const [y, m, d] = date.split('-').map(Number);
  const k3 = k.foreign + k.institution + k.personal;
  const k3txt = (k3 >= 10000 || k3 <= -10000) ? `약 ${(k3 / 10000).toFixed(2)}조` : flowText(k3);
  const insight = `<div class="insight"><div class="insight-tag">미래전략실 인사이트</div>`
    + `<ul class="ins">`
    + `<li>${m}월 ${d}일 KOSPI — 외국인 ${flowText(k.foreign)}·기관 ${flowText(k.institution)}·개인 ${flowText(k.personal)}, 합계 ${k3txt}, 기타법인 ${flowText(k.other)}</li>`
    + `<li>KOSDAQ — 외국인 ${flowText(q.foreign)}·기관 ${flowText(q.institution)}·개인 ${flowText(q.personal)}·기타법인 ${flowText(q.other)}</li>`
    + `<li>지수 등락과 주체별 수급 방향의 일치 여부를 다음 거래일에 확인 필요</li>`
    + `<li><span class="kc">체크포인트</span><br>기타법인·자사주 매입을 제외한 외국인·기관의 대형주 수급 전환 여부, 코스닥 개인 매수의 지속성</li>`
    + `</ul></div>`;
  const re = /(<section class="panel" id="p4"[\s\S]*?<div class="insight">)[\s\S]*?(<\/div>\s*<div class="slabel">)/;
  return html.replace(re, `$1${insight.slice(insight.indexOf('>') + 1, insight.lastIndexOf('</div>'))}$2`)
    .replace(/(<section class="panel" id="p4"[\s\S]*?<h1>전일 수급 동향<\/h1><p>)\d{4}\.\d{2}\.\d{2}/, `$1${date.replaceAll('-', '.')}`)
    .replace(/(<section class="panel" id="p4"[\s\S]*?<div class="slabel">)\d+월 \d+일 주체별/, `$1${m}월 ${d}일 주체별`)
    .replace(/(<section class="panel" id="p4"[\s\S]*?<div class="disc"><b>데이터<\/b> )[^<]*/, `$1${m}/${d} KOSPI·KOSDAQ 주체별 금액은 네이버 금융 공개 표 기준.`);
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

  console.log('· 전일 수급 (네이버 금융 공개표)');
  try {
    const nowKst = new Date(Date.now() + 9 * 3600 * 1000);
    const target = new Date(nowKst);
    target.setUTCDate(target.getUTCDate() - 1);
    const targetIso = `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(target.getUTCDate()).padStart(2, '0')}`;
    const [kospiFlow, kosdaqFlow] = await Promise.all([investorFlow('01', targetIso), investorFlow('02', targetIso)]);
    const flowDate = kospiFlow.iso;
    html = patchFlowBars(html, 'db-kospi', kospiFlow);
    html = patchFlowBars(html, 'db-kosdaq', kosdaqFlow);
    html = patchFlowTrend(html, kospiFlow, kospiFlow.previous);
    html = patchFlowInsight(html, flowDate, kospiFlow, kosdaqFlow);
    console.log(`  수급 반영: ${flowDate}`);
  } catch (e) {
    console.warn('  수급 갱신 실패 — 기존 값 유지', e.message);
    fail++;
  }

  console.log('· P5 월별 종가');
  const STOCKS = deriveStocks(html);
  for (const [sy, sym, cur] of STOCKS) {
    try {
      const bars = await chart(sym, '1y');
      const arr = bars.slice(-13).map((b) => cur === 'USD' ? +b.v.toFixed(2) : Math.round(b.v));
      const last = arr[arr.length - 1];
      const nowStr = cur === 'USD' ? '$' + Math.round(last) : Math.round(last).toLocaleString('en-US');
      let next = patchCloses(html, sy, arr.join(','));
      // 같은 줄의 now:"..." 도 최신 종가로
      if (next != null) {
        const reNow = new RegExp(`(symbol:'${esc(sym)}'[^\\n]*?now:)"[^"]*"`);
        if (reNow.test(next)) next = next.replace(reNow, `$1"${nowStr}"`);
      }
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
