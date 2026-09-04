/**
 * 하우스 뷰 — 네이버페이 증권 '리서치 > 시황정보' 공개 목록에서
 * 당일(또는 최근) 증권사 시황 리포트를 수집해 index.html 의 HOUSEVIEW 배열을 갱신한다.
 * 무키·무인증. EUC-KR 디코딩. 실패 시 기존 값 보존.
 * Node 20+ (내장 fetch + TextDecoder('euc-kr')).
 */
import { readFile, writeFile } from 'node:fs/promises';

const FILE = new URL('../index.html', import.meta.url);
const UA = { headers: { 'User-Agent': 'Mozilla/5.0 (hanwha-emong research)' } };
const SRC = 'https://finance.naver.com/research/market_info_list.naver';
const READ = 'https://finance.naver.com/research/market_info_read.naver';

const dec = (buf) => new TextDecoder('euc-kr').decode(buf);
const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

function todayKST() {
  const k = new Date(Date.now() + 9 * 3600 * 1000);
  return `${String(k.getUTCFullYear()).slice(2)}.${String(k.getUTCMonth() + 1).padStart(2, '0')}.${String(k.getUTCDate()).padStart(2, '0')}`;
}

async function listPage(page = 1) {
  const r = await fetch(`${SRC}?page=${page}`, UA);
  if (!r.ok) throw new Error(`list HTTP ${r.status}`);
  const html = dec(Buffer.from(await r.arrayBuffer()));
  const rows = [...html.matchAll(
    /<td style="padding-left:10px"><a href="(market_info_read\.naver\?nid=\d+)[^"]*">([\s\S]*?)<\/a>[\s\S]*?<td>([^<]+)<\/td>\s*<td class="file">\s*(?:<a href="([^"]+)")?[\s\S]*?<td class="date"[^>]*>\s*([\d.]+)\s*<\/td>/g,
  )];
  return rows.map((m) => ({
    href: `${READ}?${m[1].split('?')[1]}`,
    title: strip(m[2]),
    house: strip(m[3]),
    pdf: m[4] || '',
    date: m[5].trim(),
  })).filter((x) => x.title && x.house);
}

async function list() {
  const pages = await Promise.all(Array.from({ length: 10 }, (_, i) => listPage(i + 1)));
  return pages.flat();
}

// 읽기 페이지 본문 앞부분(요약 대용) — 실패해도 무시
async function preview(href) {
  try {
    const r = await fetch(href, UA);
    if (!r.ok) return '';
    const html = dec(Buffer.from(await r.arrayBuffer()));
    const m = html.match(/<div class="view_cnt">([\s\S]*?)<\/div>/) || html.match(/<td class="view_cnt">([\s\S]*?)<\/td>/);
    if (!m) return '';
    return strip(m[1]).slice(0, 140);
  } catch { return ''; }
}

async function run() {
  let html = await readFile(FILE, 'utf8');
  if (!/\/\* HV:start \*\/[\s\S]*?\/\* HV:end \*\//.test(html)) {
    console.warn('HV 마커 없음 — 건너뜀'); return;
  }
  let items;
  try { items = await list(); } catch (e) { console.warn('목록 수집 실패:', e.message); return; }
  const today = todayKST();
  // 여러 페이지에서 각 증권사의 가장 최신 공개 리포트를 선택한다.
  const pick = items;

  // 5대 증권사 우선 → 상단. 증권사별 최신 1건, 최대 12개
  const BIG5 = ['미래에셋증권', '한국투자증권', '삼성증권', 'KB증권', '신한투자증권'];
  const byHouse = new Map();
  for (const it of pick) if (!byHouse.has(it.house)) byHouse.set(it.house, it);
  const uniq = [];
  const REQUIRED = ['미래에셋증권', '한국투자증권', '삼성증권', '한화투자증권'];
  for (const h of BIG5) if (byHouse.has(h)) { const it = byHouse.get(h); it.big = true; uniq.push(it); byHouse.delete(h); }
  // 당일 공개 리포트가 없더라도 주요 하우스 카드는 앞쪽에 유지한다.
  for (const house of REQUIRED) {
    if (uniq.some((it) => it.house === house)) continue;
    uniq.push({ house, title: `${house} 최신 시황 리포트`, date: today, href: '', pdf: 'https://finance.naver.com/research/market_info_list.naver', sum: '네이버페이 증권 리서치에서 최신 리포트를 확인하세요.', big: house !== '한화투자증권' });
  }
  for (const it of byHouse.values()) { if (uniq.length >= 12) break; it.big = false; uniq.push(it); }

  for (const it of uniq) it.sum = await preview(it.href);

  const literal = uniq.map((it) =>
    `{house:'${esc(it.house)}',title:'${esc(it.title)}',date:'${esc(it.date)}',url:'${esc(it.pdf || it.href)}',sum:'${esc(it.sum || '')}',big:${it.big ? 'true' : 'false'}}`,
  ).join(',\n   ');

  html = html.replace(
    /\/\* HV:start \*\/[\s\S]*?\/\* HV:end \*\//,
    `/* HV:start */\n  var HOUSEVIEW=[\n   ${literal}\n  ];\n  /* HV:end */`,
  );
  // 하우스 뷰 기준일자 문구
  html = html.replace(/(id="hv-asof">)[^<]*/, `$1${today} · 네이버페이 증권 리서치`);

  await writeFile(FILE, html);
  console.log(`하우스 뷰 갱신: ${uniq.length}개 (${uniq.map((x) => x.house).join(', ')})`);
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
