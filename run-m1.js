// Chạy M1 trên Node:  node run-m1.js [demo|test]
// (Dev helper — không thuộc 3 file giao nộp.) Nối data.js + game.js vào cùng 1 scope như trình duyệt.
const fs = require('fs'), vm = require('vm'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8');
vm.runInThisContext(src + '\n;globalThis.G={simulateBattle,generateEnemy,mulberry32,formatLog,checkObjective,demoBattle,DEMO_TEAM,GENES,RULES,OBJECTIVES,CONFIG};', { filename: 'bundle.js' });
const { simulateBattle, generateEnemy, mulberry32, formatLog, checkObjective, demoBattle, DEMO_TEAM, GENES, RULES, OBJECTIVES } = G;
const mode = process.argv[2] || 'test';

if (mode === 'demo') {
  demoBattle(Number(process.argv[3]) || 1, Number(process.argv[4]) || 3, process.argv[5] || null, process.argv[6] === 'v');
  process.exit(0);
}

const enemyFor = (seed, wave) => generateEnemy(wave, mulberry32(seed * 7919 + wave));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

// 1) Determinism
{
  let same = true;
  for (let s = 1; s <= 30; s++) {
    const w = 1 + (s % 15), st = { player: DEMO_TEAM, enemy: enemyFor(s, w), ruleId: s % 3 === 0 ? RULES[s % 10].id : null };
    const a = JSON.stringify(simulateBattle(st, s).events), b = JSON.stringify(simulateBattle(st, s).events);
    if (a !== b) { same = false; console.log('  khác ở seed', s); }
  }
  ok(same, 'Determinism: cùng seed + cùng đội hình => events y hệt (30 seed)');
}

// 2) Win rate theo ải (đội demo, chưa cân bằng)
console.log('\nWin rate đội demo theo ải (200 seed):');
for (let w = 1; w <= 15; w++) {
  let win = 0, draw = 0, sec = 0, n = 200;
  for (let s = 1; s <= n; s++) {
    const r = simulateBattle({ player: DEMO_TEAM, enemy: enemyFor(s, w) }, s);
    if (r.winner === 'P') win++; if (r.winner === 'draw') draw++; sec += r.seconds;
  }
  console.log('  ải ' + String(w).padStart(2) + ': thắng ' + (win / n * 100).toFixed(0).padStart(3) + '%  hòa/timeout ' + (draw / n * 100).toFixed(0).padStart(3) + '%  TB ' + (sec / n).toFixed(1) + 's');
}

// 3) Smoke test từng gene: gắn cho mọi quân phe ta, chạy 60 trận, đếm số lần kích hoạt
console.log('\nSmoke test 24 gene (gắn cho cả đội, ải 6, 60 seed):');
for (const g of GENES) {
  let trig = 0, err = null, wins = 0, dg = 0;
  try {
    for (let s = 1; s <= 60; s++) {
      const team = DEMO_TEAM.map(d => Object.assign({}, d, { genes: [g.id] }));
      const r = simulateBattle({ player: team, enemy: enemyFor(s, 6) }, s);
      trig += r.stats.geneTriggers[g.id] || 0; dg += r.stats.damageByGene.P; if (r.winner === 'P') wins++;
    }
  } catch (e) { err = e.stack.split('\n').slice(0, 3).join(' | '); }
  console.log('  ' + (err ? 'LỖI ' : 'ok   ') + g.id.padEnd(20) + g.rarity.padEnd(7) + ' kích hoạt TB ' + (trig / 60).toFixed(1).padStart(6) + '/trận  gene-dmg TB ' + (dg / 60).toFixed(0).padStart(4) + '  thắng ' + (wins / 60 * 100).toFixed(0) + '%' + (err ? '  ' + err : ''));
  if (err) fails++;
  else if (trig === 0) { console.log('   ! gene này không bao giờ kích hoạt'); fails++; }
}

// 4) Smoke test 10 luật
console.log('\nSmoke test 10 luật (ải 6, 60 seed):');
for (const r0 of RULES) {
  let err = null, draw = 0, sec = 0, ev = 0;
  try {
    for (let s = 1; s <= 60; s++) {
      const r = simulateBattle({ player: DEMO_TEAM, enemy: enemyFor(s, 6), ruleId: r0.id }, s);
      if (r.winner === 'draw') draw++; sec += r.seconds; ev += r.events.length;
    }
  } catch (e) { err = e.stack.split('\n').slice(0, 3).join(' | '); }
  console.log('  ' + (err ? 'LỖI ' : 'ok   ') + r0.id.padEnd(20) + 'hòa ' + (draw / 60 * 100).toFixed(0).padStart(3) + '%  TB ' + (sec / 60).toFixed(1) + 's' + (err ? '  ' + err : ''));
  if (err) fails++;
}

// 5) Objective: đếm tỉ lệ đạt (ải 3)
console.log('\nObjective đạt được (ải 3, 200 seed, đội demo):');
for (const o of OBJECTIVES) {
  let hit = 0;
  for (let s = 1; s <= 200; s++) if (checkObjective(o, simulateBattle({ player: DEMO_TEAM, enemy: enemyFor(s, 3) }, s))) hit++;
  console.log('  ' + o.id.padEnd(18) + (hit / 2).toFixed(0) + '%');
}

// 6) Log mẫu
const r = simulateBattle({ player: DEMO_TEAM, enemy: enemyFor(7, 4) }, 7);
console.log('\n=== LOG MẪU (seed 7, ải 4) — ' + r.log.length + ' dòng, in 40 dòng đầu + 8 cuối ===');
console.log(r.log.slice(0, 40).join('\n') + '\n  ...\n' + r.log.slice(-8).join('\n'));
console.log('\n' + (fails ? 'CÓ ' + fails + ' LỖI' : 'TẤT CẢ OK'));
process.exit(fails ? 1 : 0);
