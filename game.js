// GENE ARENA v0.1 — game.js
// M1: lõi mô phỏng trận (deterministic) + trigger engine + sinh địch. Chưa có UI.
// Quy ước đơn giản hóa (đặc tả mơ hồ -> chọn phương án đơn giản nhất):
//  - slow: giảm 40% tốc độ cho CẢ di chuyển lẫn nhịp đánh. Gene "speed" chỉ ảnh hưởng di chuyển.
//  - Taunt (Giáp Sắt): chỉ dùng để phá hòa khi nhiều địch cùng khoảng cách (trước khi xét HP/id).
//  - Y Sĩ: nếu không có đồng minh nào thiếu máu trong tầm thì đánh thường như quân khác. Y Sĩ hồi 10 x 1.8^(sao-1).
//  - on_attack chỉ kích hoạt khi đòn đánh gây sát thương (Y Sĩ hồi máu không kích hoạt on_attack).
//  - on_hit_taken chỉ kích hoạt bởi đòn đánh thường (không bởi sát thương gene/burn/luật) -> tránh vòng lặp.
//  - Sát thương/hồi máu làm tròn số nguyên (tối thiểu sát thương 1).
//  - noHeal: chặn mọi hồi máu NHẬN VÀO của quân đó.
//  - Luật Chật Hẹp: quân đặt ngoài hàng cho phép bị đẩy sang ô trống gần nhất (cùng nửa bàn).
//  - Hai phe hết quân cùng lúc = hòa (tính là thua). Thứ tự hành động: tick chẵn Ta trước, tick lẻ Địch trước.

// ======================= RNG / TIỆN ÍCH =======================
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pickWeighted(rng, items, weightFn) {
  let total = 0;
  for (const it of items) total += weightFn(it);
  let r = rng() * total;
  for (const it of items) { r -= weightFn(it); if (r < 0) return it; }
  return items[items.length - 1];
}
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const sec2tick = s => Math.max(1, Math.round(s * CONFIG.TICKS_PER_SEC));

// ======================= KHỞI TẠO TRẬN =======================
// state = { player:[unitDef], enemy:[unitDef], ruleId?:string }
// unitDef = { type, star=1, genes:[geneId], x, y, mult=1, shards:[{hp,atk}] }
function createBattle(state, seed) {
  const rule = Object.assign({}, DEFAULT_RULE_MODS, state.ruleId ? RULES_BY_ID[state.ruleId].mods : {});
  const B = {
    seed, rng: mulberry32(seed), tick: 0, rule, ruleId: state.ruleId || null,
    units: [], grid: [], events: [], depth: 0, revived: { P: false, E: false }, winner: null,
    stats: {
      dmgDone: { P: 0, E: 0 }, damageByGene: { P: 0, E: 0 }, geneDamage: {}, geneTriggers: {},
      healTotal: { P: 0, E: 0 }, deaths: { P: 0, E: 0 }, firstDeathTick: null, firstDeathSide: null,
      lastDeath: { P: null, E: null }, frontline: []
    }
  };
  for (let y = 0; y < CONFIG.ROWS; y++) B.grid.push(new Array(CONFIG.COLS).fill(-1));
  state.player.forEach(d => B.units.push(makeUnit(B, d, 'P', B.units.length)));
  state.enemy.forEach(d => B.units.push(makeUnit(B, d, 'E', B.units.length)));
  placeUnits(B);
  B.stats.frontline = B.units.filter(u => u.side === 'P' && u.defX === 3).map(u => u.id);
  return B;
}

function rowAllowed(B, y) { return !B.rule.rows || B.rule.rows.includes(y); }

// Đặt quân lên lưới. Quân hợp lệ đặt trước; quân ở hàng bị cấm (luật Chật Hẹp) được dời sang ô trống gần nhất.
function placeUnits(B) {
  const bad = [];
  for (const u of B.units) {
    const [c0, c1] = u.side === 'P' ? CONFIG.PLAYER_COLS : CONFIG.ENEMY_COLS;
    if (u.x < c0 || u.x > c1 || u.y < 0 || u.y >= CONFIG.ROWS) throw new Error('Ô đặt quân sai phe/biên: ' + u.name + ' (' + u.x + ',' + u.y + ')');
    if (!rowAllowed(B, u.y)) { bad.push(u); continue; }
    if (B.grid[u.y][u.x] !== -1) throw new Error('Hai quân trùng ô (' + u.x + ',' + u.y + ')');
    B.grid[u.y][u.x] = u.id;
  }
  for (const u of bad) {
    const [c0, c1] = u.side === 'P' ? CONFIG.PLAYER_COLS : CONFIG.ENEMY_COLS;
    let best = null, bd = 1e9;
    for (let y = 0; y < CONFIG.ROWS; y++) for (let x = c0; x <= c1; x++) {
      if (!rowAllowed(B, y) || B.grid[y][x] !== -1) continue;
      const d = Math.max(Math.abs(x - u.x), Math.abs(y - u.y)) * 100 + Math.abs(x - u.x) + Math.abs(y - u.y);
      if (d < bd) { bd = d; best = { x, y }; }
    }
    if (!best) throw new Error('Không còn ô trống cho quân bị dời');
    u.x = best.x; u.y = best.y; B.grid[u.y][u.x] = u.id;
  }
}

function makeUnit(B, d, side, id) {
  const T = UNITS[d.type];
  if (!T) throw new Error('Loại quân lạ: ' + d.type);
  const star = d.star || 1, sm = Math.pow(CONFIG.STAR_MULT, star - 1), mult = d.mult || 1;
  let hp = T.hp * sm * mult, atk = T.atk * sm * mult;
  for (const s of (d.shards || [])) { hp += s.hp; atk += s.atk; }
  const base = {
    maxHP: Math.round(hp), ATK: Math.round(atk),
    cooldown: B.rule.cooldownInvert ? B.rule.cooldownInvert - T.cd : T.cd,   // luật Đảo Tốc
    speed: 1, range: T.range, dmgDealt: 1, dmgTaken: 1,
    crit: B.rule.critChance != null ? B.rule.critChance : CONFIG.CRIT_CHANCE
  };
  const mod = {};
  for (const k in base) mod[k] = { add: 0, mult: 1 };       // stat cuối = (base + add) * mult
  const u = {
    id, side, type: d.type, name: T.name, star, x: d.x, y: d.y, defX: d.x,
    base, mod, maxHP: base.maxHP, hp: base.maxHP, shield: 0, alive: true,
    nextAct: 0, stunUntil: 0, slowUntil: 0, burn: null, flags: {}, stacks: {},
    genes: (d.genes || []).slice(0, CONFIG.MAX_GENES_PER_UNIT), bindings: []
  };
  // Mỗi gene -> binding(s). Hại (drawback) cũng là binding cùng schema.
  for (const gid of u.genes) {
    const g = GENE_BY_ID[gid];
    if (!g) throw new Error('Gene lạ: ' + gid);
    u.bindings.push(makeBinding(g, g.trigger, g.effect, false));
    if (g.drawback) u.bindings.push(makeBinding(g, g.drawback.trigger || { type: 'battle_start' }, g.drawback.effect, true));
  }
  return u;
}
function makeBinding(g, trig, eff, isDrawback) {
  return { geneId: g.id, trig, eff, drawback: isDrawback, fired: false, next: trig.type === 'every_n_sec' ? sec2tick(trig.n) : 0 };
}

// ======================= STAT / SỰ KIỆN =======================
function emit(B, ev) { ev.t = B.tick; B.events.push(ev); return ev; }

function getStat(B, u, s) {
  const m = u.mod[s];
  let v = (u.base[s] + m.add) * m.mult;
  if (s === 'range') v = Math.max(1, Math.round(v + B.rule.rangeAdd));   // luật Sương Mù
  return v;
}
function recalcMaxHP(B, u) {
  const nm = Math.max(1, Math.round(getStat(B, u, 'maxHP')));
  if (nm === u.maxHP) return;
  u.hp = Math.max(1, Math.round(u.hp * nm / u.maxHP));   // giữ nguyên tỉ lệ máu
  u.maxHP = nm;
  emit(B, { k: 'stat', id: u.id, maxHP: u.maxHP, hp: u.hp });
}
const slowF = (B, u) => (u.slowUntil > B.tick ? CONFIG.SLOW_MULT : 1);
function cdTicks(B, u) { return Math.max(1, Math.round(Math.max(0.2, getStat(B, u, 'cooldown')) * CONFIG.TICKS_PER_SEC / slowF(B, u))); }
function moveTicks(B, u) { return Math.max(1, Math.round(CONFIG.MOVE_SEC * CONFIG.TICKS_PER_SEC / (getStat(B, u, 'speed') * B.rule.moveMult * slowF(B, u)))); }

const aliveEnemiesOf = (B, u) => B.units.filter(v => v.alive && v.side !== u.side);
const aliveAlliesOf = (B, u) => B.units.filter(v => v.alive && v.side === u.side);

// Mục tiêu: gần nhất (Chebyshev) -> Taunt trước -> HP thấp -> id nhỏ.
function pickTarget(B, u) {
  let best = null, bk = null;
  for (const v of B.units) {
    if (!v.alive || v.side === u.side) continue;
    const k = [cheb(u, v), UNITS[v.type].taunt ? 0 : 1, v.hp, v.id];
    if (!bk || k[0] < bk[0] || (k[0] === bk[0] && (k[1] < bk[1] || (k[1] === bk[1] && (k[2] < bk[2] || (k[2] === bk[2] && k[3] < bk[3])))))) { best = v; bk = k; }
  }
  return best;
}

// ======================= TRIGGER ENGINE =======================
// triggerEngine: fire(B, unit, triggerType, ctx) duyệt mọi binding của quân khớp trigger.type,
// kiểm tra chance, rồi chạy applyEffect. Không có code riêng cho từng gene.
// Trả về true nếu có binding "replaces" đã kích hoạt (dùng cho Hồi Máu Ngược: hủy lượng hồi).
function fire(B, u, type, ctx) {
  if (B.depth >= CONFIG.MAX_TRIGGER_DEPTH) return false;
  if (!u.alive && type !== 'on_death') return false;
  let replaced = false;
  B.depth++;
  try {
    for (const b of u.bindings) {
      if (b.trig.type !== type) continue;
      if (b.trig.chance !== undefined && B.rng() >= b.trig.chance) continue;
      runBinding(B, u, b, ctx);
      if (b.trig.replaces) replaced = true;
    }
  } finally { B.depth--; }
  return replaced;
}
function runBinding(B, u, b, ctx) {
  if (!(b.drawback && b.trig.type === 'battle_start')) {   // không log hại đầu trận cho đỡ rối
    emit(B, { k: 'gene', id: u.id, gene: b.geneId, drawback: b.drawback });
    B.stats.geneTriggers[b.geneId] = (B.stats.geneTriggers[b.geneId] || 0) + 1;
  }
  applyEffect(B, u, b.eff, ctx || {}, b);
}
// every_n_sec: kiểm tra mỗi tick
function runTimers(B) {
  for (const u of B.units) {
    if (!u.alive) continue;
    for (const b of u.bindings) {
      if (b.trig.type !== 'every_n_sec' || !u.alive) continue;
      if (B.tick >= b.next) { b.next += sec2tick(b.trig.n); runBinding(B, u, b, {}); }
    }
  }
}
// hp_below_pct: kích hoạt 1 lần/trận, gọi sau mỗi lần mất máu
function checkHpTriggers(B, u) {
  if (!u.alive) return;
  for (const b of u.bindings) {
    if (b.trig.type === 'hp_below_pct' && !b.fired && u.hp / u.maxHP * 100 < b.trig.p) { b.fired = true; runBinding(B, u, b, {}); }
  }
}

function resolveTargets(B, u, spec, ctx) {
  let r;
  switch (spec || 'self') {
    case 'self': r = [u]; break;
    case 'attacker': r = [ctx.source]; break;
    case 'current_target': r = [ctx.target]; break;
    case 'nearest_enemy': r = [pickTarget(B, u)]; break;
    case 'random_enemy': { const e = aliveEnemiesOf(B, u); r = e.length ? [e[Math.floor(B.rng() * e.length)]] : []; break; }
    case 'all_enemies': r = aliveEnemiesOf(B, u); break;
    case 'all_allies': r = aliveAlliesOf(B, u); break;
    case 'lowest_hp_ally': {
      let best = null;
      for (const v of aliveAlliesOf(B, u)) if (!best || v.hp / v.maxHP < best.hp / best.maxHP) best = v;
      r = [best]; break;
    }
    case 'adjacent_enemies': {   // địch kề cạnh "tâm" (xác nạn nhân nếu có, không thì mục tiêu, không thì bản thân)
      const c = ctx.victim || ctx.target || u;
      r = aliveEnemiesOf(B, u).filter(v => v !== c && cheb(v, c) <= 1); break;
    }
    default: throw new Error('target lạ: ' + spec);
  }
  return r.filter(v => v && v.alive);
}
function calcValue(B, v, u, ctx) {
  if (typeof v === 'number') return v;
  let r = v.flat || 0;
  if (v.atkPct) r += v.atkPct * getStat(B, u, 'ATK');
  if (v.maxHpPct) r += v.maxHpPct * u.maxHP;
  if (v.victimMaxHpPct && ctx.victim) r += v.victimMaxHpPct * ctx.victim.maxHP;
  if (v.ctxAmountMult && ctx.amount) r += v.ctxAmountMult * ctx.amount;
  return r;
}

// applyEffect: thực thi 1 effect (cùng schema cho gene và hại). Mọi sát thương/hồi máu đều đi qua dealDamage/healUnit.
function applyEffect(B, u, eff, ctx, binding) {
  const targets = resolveTargets(B, u, eff.target, ctx);
  const gid = binding ? binding.geneId : null;
  switch (eff.type) {
    case 'stat_mod':
      for (const t of targets) {
        const m = t.mod[eff.stat];
        if (eff.op === 'add') m.add += eff.value; else m.mult *= eff.value;
        if (eff.stat === 'maxHP') recalcMaxHP(B, t);
      }
      break;
    case 'stack_stat':
      for (const t of targets) {
        const key = gid + ':' + eff.stat, cur = t.stacks[key] || 0;
        const add = eff.max !== undefined ? Math.min(eff.value, eff.max - cur) : eff.value;
        if (add <= 0) continue;
        t.stacks[key] = cur + add; t.mod[eff.stat].add += add;
        if (eff.stat === 'maxHP') recalcMaxHP(B, t);
      }
      break;
    case 'deal_damage':
      for (const t of targets) {
        const amt = calcValue(B, eff.value, u, ctx);
        dealDamage(B, u, t, amt, { kind: eff.raw ? 'selfloss' : 'gene', geneId: gid, raw: !!eff.raw });
      }
      break;
    case 'heal':
      for (const t of targets) healUnit(B, u, t, calcValue(B, eff.value, u, ctx), { kind: 'gene', geneId: gid });
      break;
    case 'shield':
      for (const t of targets) {
        t.shield += Math.round(calcValue(B, eff.value, u, ctx));
        emit(B, { k: 'shield', dst: t.id, sh: t.shield, gene: gid });
      }
      break;
    case 'apply_status':
      for (const t of targets) applyStatus(B, u, t, eff.status, eff.duration, gid);
      break;
    case 'set_flag':
      for (const t of targets) t.flags[eff.flag] = true;
      break;
    default: throw new Error('effect lạ: ' + eff.type);
  }
}
function applyStatus(B, src, t, st, dur, gid) {
  const until = B.tick + sec2tick(dur);
  if (st === 'burn') t.burn = { until: Math.max(t.burn ? t.burn.until : 0, until), src: src.id, geneId: gid };
  else if (st === 'slow') t.slowUntil = Math.max(t.slowUntil, until);
  else if (st === 'stun') t.stunUntil = Math.max(t.stunUntil, until);
  else throw new Error('status lạ: ' + st);
  emit(B, { k: 'status', dst: t.id, st, sec: dur, gene: gid });
}

// ======================= SÁT THƯƠNG / HỒI MÁU / CHẾT =======================
// o = { kind: attack|splash|gene|burn|rule|selfloss, geneId, raw, canCrit }
// raw = bỏ qua giáp & hệ số (dùng cho tự mất máu).
function dealDamage(B, src, dst, amount, o) {
  if (!dst.alive) return 0;
  let dmg = amount, crit = false;
  if (o.canCrit && src && B.rng() < getStat(B, src, 'crit')) { crit = true; dmg *= CONFIG.CRIT_MULT; }
  if (!o.raw) {
    if (src) dmg *= getStat(B, src, 'dmgDealt');
    dmg *= getStat(B, dst, 'dmgTaken');
    dmg *= B.rule.dmgMult;
  }
  dmg = Math.max(1, Math.round(dmg));
  if (crit && B.rule.critHeals) {   // luật Máu Đổi Chiều
    healUnit(B, src, dst, dmg, { kind: 'crit', geneId: null });
    return 0;
  }
  let absorbed = 0;
  if (!o.raw && dst.shield > 0) { absorbed = Math.min(dst.shield, dmg); dst.shield -= absorbed; dmg -= absorbed; }
  const before = dst.hp;
  dst.hp -= dmg;
  const real = Math.min(before, dmg);
  const S = B.stats;
  if (src) {
    S.dmgDone[src.side] += real;
    if (src.side !== dst.side && (o.kind === 'gene' || o.kind === 'burn')) {   // sát thương do gene lên địch
      S.damageByGene[src.side] += real;
      if (o.geneId) S.geneDamage[o.geneId] = (S.geneDamage[o.geneId] || 0) + real;
    }
  }
  emit(B, { k: 'dmg', src: src ? src.id : -1, dst: dst.id, amt: dmg, abs: absorbed, crit, kind: o.kind, gene: o.geneId || null, hp: Math.max(0, dst.hp), sh: dst.shield });
  if (dst.hp <= 0) { killUnit(B, dst, src, o); return dmg; }
  if (o.kind === 'attack') fire(B, dst, 'on_hit_taken', { source: src });
  checkHpTriggers(B, dst);
  return dmg;
}

function healUnit(B, src, dst, amount, o) {
  if (!dst.alive || dst.flags.noHeal) return 0;
  amount = Math.round(amount);
  if (amount <= 0) return 0;
  if (fire(B, dst, 'on_heal_received', { amount, source: src })) return 0;   // gene "replaces" (Hồi Máu Ngược) hủy hồi máu
  const real = Math.min(amount, dst.maxHP - dst.hp);
  if (real <= 0) return 0;
  dst.hp += real;
  B.stats.healTotal[dst.side] += real;
  emit(B, { k: 'heal', src: src ? src.id : -1, dst: dst.id, amt: real, hp: dst.hp, kind: o.kind, gene: o.geneId || null });
  return real;
}

function killUnit(B, u, killer, o) {
  if (B.rule.reviveFirst && !B.revived[u.side]) {   // luật Hồi Sinh Cưỡng Ép
    B.revived[u.side] = true;
    u.hp = Math.max(1, Math.round(u.maxHP * B.rule.reviveFirst));
    emit(B, { k: 'revive', id: u.id, hp: u.hp });
    return;
  }
  u.alive = false; u.hp = 0;
  B.grid[u.y][u.x] = -1;
  const S = B.stats;
  S.deaths[u.side]++;
  if (S.firstDeathTick === null) { S.firstDeathTick = B.tick; S.firstDeathSide = u.side; }
  S.lastDeath[u.side] = { tick: B.tick, kind: o.kind };
  emit(B, { k: 'death', id: u.id, kind: o.kind });
  fire(B, u, 'on_death', { source: killer });
  for (const a of B.units) if (a.alive && a.side === u.side && a !== u) fire(B, a, 'on_ally_death', { victim: u });
  if (killer && killer.alive && killer.side !== u.side) fire(B, killer, 'on_kill', { victim: u });
  if (B.rule.deathExplodePct) {   // luật Nổ Xác: nổ lên mọi quân kề cạnh (cả hai phe)
    for (const v of B.units) if (v.alive && v !== u && cheb(v, u) <= 1)
      dealDamage(B, null, v, u.maxHP * B.rule.deathExplodePct, { kind: 'rule' });
  }
}

// ======================= HÀNH ĐỘNG =======================
function findHealTarget(B, u, range) {
  let best = null;
  for (const v of B.units) {
    if (!v.alive || v.side !== u.side || v.hp >= v.maxHP || v.flags.noHeal || cheb(u, v) > range) continue;
    if (!best || v.hp / v.maxHP < best.hp / best.maxHP) best = v;
  }
  return best;
}

function stepToward(B, u, tg) {
  let best = null, bs = [cheb(u, tg), (u.x - tg.x) ** 2 + (u.y - tg.y) ** 2];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = u.x + dx, ny = u.y + dy;
    if (nx < 0 || nx >= CONFIG.COLS || ny < 0 || ny >= CONFIG.ROWS || !rowAllowed(B, ny) || B.grid[ny][nx] !== -1) continue;
    const s = [Math.max(Math.abs(nx - tg.x), Math.abs(ny - tg.y)), (nx - tg.x) ** 2 + (ny - tg.y) ** 2];
    if (s[0] < bs[0] || (s[0] === bs[0] && s[1] < bs[1])) { best = { nx, ny }; bs = s; }
  }
  if (!best) return false;
  B.grid[u.y][u.x] = -1; u.x = best.nx; u.y = best.ny; B.grid[u.y][u.x] = u.id;
  emit(B, { k: 'move', id: u.id, x: u.x, y: u.y });
  return true;
}

function act(B, u) {
  const t = B.tick;
  if (!u.alive || t < u.nextAct || t < u.stunUntil) return;
  const T = UNITS[u.type];
  const tg = pickTarget(B, u);
  if (!tg) return;
  const range = getStat(B, u, 'range');
  if (T.heal) {   // Y Sĩ: ưu tiên hồi máu
    const ally = findHealTarget(B, u, range);
    if (ally) {
      healUnit(B, u, ally, T.heal * Math.pow(CONFIG.STAR_MULT, u.star - 1), { kind: 'attack', geneId: null });
      u.nextAct = t + cdTicks(B, u);
      return;
    }
  }
  if (cheb(u, tg) <= range) {   // đánh thường
    emit(B, { k: 'atk', src: u.id, dst: tg.id });
    dealDamage(B, u, tg, getStat(B, u, 'ATK'), { kind: 'attack', canCrit: true });
    if (!u.alive) return;
    if (T.splash) {   // Pháp Sư: lan 50% sang ô kế bên mục tiêu (chỉ địch, không crit)
      for (const v of aliveEnemiesOf(B, u))
        if (v !== tg && cheb(v, tg) <= 1) dealDamage(B, u, v, getStat(B, u, 'ATK') * T.splash, { kind: 'splash' });
    }
    if (u.alive && tg.alive) fire(B, u, 'on_attack', { target: tg });
    u.nextAct = t + cdTicks(B, u);
  } else if (stepToward(B, u, tg)) {
    u.nextAct = t + moveTicks(B, u);
  }
}

// Sát Thủ: đầu trận nhảy tới ô trống cạnh kẻ địch xa nhất (hàng sau)
function doJumps(B) {
  for (const u of B.units) {
    if (!u.alive || !UNITS[u.type].jump) continue;
    const dir = u.side === 'P' ? 1 : -1;   // "sau" = hướng về phía cuối bàn của địch
    let tg = null;
    for (const v of aliveEnemiesOf(B, u)) {
      if (!tg) { tg = v; continue; }
      const a = cheb(u, v), b = cheb(u, tg);
      if (a > b || (a === b && (v.x - tg.x) * dir > 0) || (a === b && v.x === tg.x && v.id < tg.id)) tg = v;
    }
    if (!tg) continue;
    let best = null, bk = null;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = tg.x + dx, ny = tg.y + dy;
      if (nx < 0 || nx >= CONFIG.COLS || ny < 0 || ny >= CONFIG.ROWS || !rowAllowed(B, ny) || B.grid[ny][nx] !== -1) continue;
      const k = [-nx * dir, Math.abs(ny - u.y), ny];   // sâu nhất -> gần hàng mình -> hàng nhỏ
      if (!bk || k[0] < bk[0] || (k[0] === bk[0] && (k[1] < bk[1] || (k[1] === bk[1] && k[2] < bk[2])))) { best = { nx, ny }; bk = k; }
    }
    if (!best) continue;
    B.grid[u.y][u.x] = -1; u.x = best.nx; u.y = best.ny; B.grid[u.y][u.x] = u.id;
    emit(B, { k: 'move', id: u.id, x: u.x, y: u.y, jump: true });
  }
}

// Hiệu ứng theo giây: burn, hồi máu luật, chảy máu luật
function secondEffects(B) {
  for (const u of B.units) {
    if (!u.alive) continue;
    if (u.burn && u.burn.until > B.tick) dealDamage(B, B.units[u.burn.src], u, CONFIG.BURN_DPS, { kind: 'burn', geneId: u.burn.geneId });
    if (u.alive && B.rule.regenPctPerSec) healUnit(B, null, u, u.maxHP * B.rule.regenPctPerSec, { kind: 'rule' });
    if (u.alive && B.rule.bleedEveryN && B.tick % (B.rule.bleedEveryN * CONFIG.TICKS_PER_SEC) === 0)
      dealDamage(B, null, u, u.hp * B.rule.bleedPctCurrent, { kind: 'rule', raw: true });
  }
}

function checkEnd(B) {
  let p = 0, e = 0;
  for (const u of B.units) if (u.alive) { if (u.side === 'P') p++; else e++; }
  if (p && e) return false;
  B.winner = (!p && !e) ? 'draw' : (p ? 'P' : 'E');
  return true;
}

// ======================= simulateBattle =======================
// Thuần logic, deterministic theo seed (mulberry32). Không đụng DOM/canvas.
// Trả về { winner:'P'|'E'|'draw', ticks, seconds, seed, ruleId, initial, events, stats, survivors, log }
// events: danh sách sự kiện có tick (k = start|gene|atk|dmg|heal|shield|status|move|death|revive|stat|end) để render phát lại.
function simulateBattle(state, seed) {
  const B = createBattle(state, seed);
  const MAXT = CONFIG.MAX_BATTLE_SEC * CONFIG.TICKS_PER_SEC;
  emit(B, { k: 'start', seed, ruleId: B.ruleId, nP: state.player.length, nE: state.enemy.length });
  for (const u of B.units) fire(B, u, 'battle_start', {});
  B.initial = B.units.map(u => ({ id: u.id, side: u.side, type: u.type, name: u.name, star: u.star, x: u.x, y: u.y, hp: u.hp, maxHP: u.maxHP, shield: u.shield, genes: u.genes.slice() }));
  doJumps(B);
  const orderP = B.units.filter(u => u.side === 'P'), orderE = B.units.filter(u => u.side === 'E');
  const orderA = orderP.concat(orderE), orderB = orderE.concat(orderP);
  let t = 0;
  for (; t < MAXT; t++) {
    B.tick = t;
    if (t > 0 && t % CONFIG.TICKS_PER_SEC === 0) secondEffects(B);
    runTimers(B);
    if (checkEnd(B)) break;
    for (const u of (t % 2 === 0 ? orderA : orderB)) act(B, u);
    if (checkEnd(B)) break;
  }
  B.tick = t;
  if (!B.winner) B.winner = 'draw';   // hết 60s = hòa = thua
  emit(B, { k: 'end', winner: B.winner, timeout: t >= MAXT });
  const survivors = B.units.filter(u => u.alive).map(u => u.id);
  const res = { winner: B.winner, ticks: t, seconds: t / CONFIG.TICKS_PER_SEC, seed, ruleId: B.ruleId, initial: B.initial, events: B.events, stats: B.stats, survivors };
  res.log = formatLog(res, false);
  return res;
}

// ======================= LOG =======================
// formatLogEntries: trả về [{t, ts, s}] để UI phát log theo tick; formatLog nối thành chuỗi.
function formatLogEntries(res, verbose) {
  const L = {};
  for (const u of res.initial) L[u.id] = (u.side === 'P' ? 'Ta' : 'Địch') + '#' + u.id + ' ' + u.name + (u.star > 1 ? '★' + u.star : '');
  const nm = id => (id >= 0 ? L[id] : 'Luật thế giới');
  const gn = id => (id && GENE_BY_ID[id] ? GENE_BY_ID[id].name : '?');
  const out = [];
  for (const e of res.events) {
    const ts = '[' + (e.t / CONFIG.TICKS_PER_SEC).toFixed(2).padStart(5) + 's t' + String(e.t).padStart(4) + '] ';
    let s = null;
    switch (e.k) {
      case 'start': s = 'BẮT ĐẦU: ' + e.nP + ' quân ta vs ' + e.nE + ' địch | seed ' + e.seed + ' | luật: ' + (e.ruleId ? RULES_BY_ID[e.ruleId].name : 'không'); break;
      case 'gene': s = '✦ ' + nm(e.id) + ' kích hoạt [' + gn(e.gene) + ']' + (e.drawback ? ' (hại)' : ''); break;
      case 'dmg': {
        const crit = (e.crit ? ' CRIT' : '') + (e.abs ? ' (giáp chặn ' + e.abs + ')' : '');
        if (e.kind === 'attack') s = nm(e.src) + ' đánh ' + nm(e.dst) + ': -' + e.amt + crit + ' → HP ' + e.hp;
        else if (e.kind === 'splash') s = nm(e.src) + ' lan sang ' + nm(e.dst) + ': -' + e.amt + ' → HP ' + e.hp;
        else if (e.kind === 'burn') s = '🔥 ' + nm(e.dst) + ' bị thiêu: -' + e.amt + ' → HP ' + e.hp;
        else if (e.kind === 'rule') s = '⚠ Luật: ' + nm(e.dst) + ' -' + e.amt + ' → HP ' + e.hp;
        else if (e.kind === 'selfloss') s = '☠ ' + nm(e.dst) + ' mất ' + e.amt + ' máu [' + gn(e.gene) + '] → HP ' + e.hp;
        else s = '  [' + gn(e.gene) + '] ' + nm(e.src) + ' gây ' + e.amt + ' lên ' + nm(e.dst) + ' → HP ' + e.hp;
        break;
      }
      case 'heal': s = '  + ' + nm(e.dst) + ' hồi ' + e.amt + (e.gene ? ' [' + gn(e.gene) + ']' : e.kind === 'attack' ? ' (bởi ' + nm(e.src) + ')' : e.kind === 'rule' ? ' (luật)' : e.kind === 'crit' ? ' (crit bị đảo)' : '') + ' → HP ' + e.hp; break;
      case 'shield': s = '  ◈ ' + nm(e.dst) + ' giáp → ' + e.sh + ' [' + gn(e.gene) + ']'; break;
      case 'status': s = '  ~ ' + nm(e.dst) + ' dính ' + e.st + ' ' + e.sec + 's [' + gn(e.gene) + ']'; break;
      case 'death': s = '✖ ' + nm(e.id) + ' chết (' + e.kind + ')'; break;
      case 'revive': s = '♻ ' + nm(e.id) + ' hồi sinh với HP ' + e.hp; break;
      case 'stat': if (verbose) s = '  stat ' + nm(e.id) + ': maxHP ' + e.maxHP; break;
      case 'move': if (verbose || e.jump) s = (e.jump ? '⤴ ' : '  ') + nm(e.id) + (e.jump ? ' nhảy tới ' : ' di chuyển ') + '(' + e.x + ',' + e.y + ')'; break;
      case 'atk': break;
      case 'end': s = 'KẾT THÚC: ' + (e.winner === 'P' ? 'TA THẮNG' : e.winner === 'E' ? 'ĐỊCH THẮNG' : 'HÒA (tính là thua)') + (e.timeout ? ' [hết 60s]' : ''); break;
    }
    if (s !== null) out.push({ t: e.t, ts, s });
  }
  return out;
}
function formatLog(res, verbose) { return formatLogEntries(res, verbose).map(x => x.ts + x.s); }

// ======================= NHIỆM VỤ PHỤ =======================
// checkObjective: đánh giá điều kiện theo obj.check.type trên result.stats (khai báo trong data.js).
function checkObjective(obj, res) {
  const c = obj.check, S = res.stats, win = res.winner === 'P';
  switch (c.type) {
    case 'win_within_sec': return win && res.seconds <= c.value;
    case 'no_ally_dead': return win && S.deaths.P === 0;
    case 'frontline_survive': return win && S.frontline.length > 0 && S.frontline.every(id => res.survivors.includes(id));
    case 'last_kill_by_gene': return win && !!S.lastDeath.E && (S.lastDeath.E.kind === 'gene' || S.lastDeath.E.kind === 'burn');
    case 'gene_damage_min': return win && S.damageByGene.P >= c.value;
    case 'heal_total_max': return win && S.healTotal.P < c.value;
    default: throw new Error('objective lạ: ' + c.type);
  }
}

// ======================= SINH ĐỊCH =======================
// generateEnemy(wave, rng): số quân, loại, sao, gene, đội hình theo section 10. Trả về mảng unitDef.
function rollGene(rng, rarity, excludeIds) {
  const pool = GENES_BY_RARITY[rarity].filter(g => !excludeIds.includes(g.id));
  return pool[Math.floor(rng() * pool.length)].id;
}
function generateEnemy(wave, rng) {
  const boss = ECONOMY.BOSS_WAVES.includes(wave);
  const count = Math.min(ENEMY.BASE_COUNT + Math.ceil(wave / 2), ENEMY.MAX_COUNT) + (boss ? 1 : 0);
  const types = ['tank'];                                          // luôn có >= 1 Tank
  if (count >= 4) types.push(ENEMY.RANGED_TYPES[Math.floor(rng() * ENEMY.RANGED_TYPES.length)]);   // >= 1 đánh xa
  const keys = Object.keys(ENEMY.TYPE_WEIGHTS);
  while (types.length < count) types.push(pickWeighted(rng, keys, k => ENEMY.TYPE_WEIGHTS[k]));
  const mult = 1 + ENEMY.SCALE_PER_WAVE * (wave - 1);
  const defs = types.map(type => {
    let star = 1;
    if (wave >= 11) star = rng() < ENEMY.STAR3_CHANCE ? 3 : 2;
    else if (wave >= 6) star = rng() < ENEMY.STAR2_CHANCE ? 2 : 1;
    const genes = [];
    if (boss) genes.push(rollGene(rng, 'rare', genes));            // boss: mọi quân 1 Rare
    else if (wave >= 8) {
      const n = 1 + Math.floor(rng() * 2);                         // 1-2 gene, cho phép Rare
      for (let i = 0; i < n; i++) genes.push(rollGene(rng, rng() < ENEMY.RARE_CHANCE_W8 ? 'rare' : 'common', genes));
    } else if (wave >= 4) genes.push(rollGene(rng, 'common', genes));   // ải 4-7: 1 Common
    return { type, star, genes, mult, x: 0, y: 0 };
  });
  // Đội hình: tank hàng trước, đánh xa hàng sau (cột ưa thích theo loại, tràn sang cột gần nhất nếu đầy)
  const used = {};
  const order = defsSortedByRole(defs);
  for (const d of order) {
    const pref = ENEMY.ROLE_COL[d.type];
    const cols = [pref, pref - 1, pref + 1, pref - 2, pref + 2, pref - 3, pref + 3].filter(c => c >= CONFIG.ENEMY_COLS[0] && c <= CONFIG.ENEMY_COLS[1]);
    let done = false;
    for (const c of cols) {
      for (const r of ENEMY.ROW_ORDER) {
        if (!used[c + ',' + r]) { used[c + ',' + r] = true; d.x = c; d.y = r; done = true; break; }
      }
      if (done) break;
    }
  }
  return defs;
}
function defsSortedByRole(defs) {
  return defs.slice().sort((a, b) => ENEMY.ROLE_COL[a.type] - ENEMY.ROLE_COL[b.type]);
}

// ======================= RUN (M3) =======================
// Trạng thái 1 run + shop / kinh tế / xếp quân / gộp sao. Thuần logic (không DOM) để test bằng Node và dùng cho auto-playtest (M6).
// run = { seed, rngN, wave, gold, lives, streak, wins, over:null|'win'|'lose', nextUid,
//         field:{"x,y":unit}, bench:[unit|null x4], shop:[type|null x5], history:[] }
// unit = { uid, type, star, genes:[], shards:[] }
// Quy ước đơn giản hóa: shop tự làm mới MIỄN PHÍ mỗi ải; thu nhập nhận sau mỗi trận (cả thắng lẫn thua);
// chuỗi thắng >=5 => +4, 3-4 => +2; thua ải 15 khi còn mạng => đánh lại ải 15; ghế đầy chỉ mua được nếu gộp ngay;
// gộp sao: nếu tổng gene > 2 thì xếp vào run.mergeQueue để người chơi chọn tối đa 2 gene giữ lại (gene không chọn về kho nếu còn chỗ, hết chỗ thì mất);
// bán quân: gene trên quân về kho (hết chỗ thì mất). Gene thưởng sau trận: chọn 1/3 (thua: 1/2), đổi 2 vàng 1 lần/ải.
const fKey = (x, y) => x + ',' + y;
function runRand(run) { run.rngN++; return mulberry32((run.seed ^ Math.imul(run.rngN, 2654435761)) >>> 0)(); }   // RNG của run, lưu được bằng (seed, rngN)
function fieldLimit(wave) { let n = 6; for (const f of ECONOMY.FIELD_SIZE) if (wave >= f.fromWave) n = f.size; return n; }
function isBossWave(w) { return ECONOMY.BOSS_WAVES.includes(w); }
function newRun(seed) {
  seed = (seed === undefined ? Math.floor(Math.random() * 1e9) : seed) >>> 0;
  const run = { seed, rngN: 0, wave: 1, gold: ECONOMY.START_GOLD, lives: ECONOMY.START_LIVES, streak: 0, wins: 0, over: null,
    nextUid: 1, field: {}, bench: new Array(ECONOMY.BENCH_SIZE).fill(null), shop: [], history: [],
    stash: [], geneChoice: null, mergeQueue: [], market: null };
  rollShop(run);
  return run;
}
function makeRunUnit(run, type) { return { uid: run.nextUid++, type, star: 1, genes: [], shards: [] }; }
function rollShop(run) {
  const keys = Object.keys(UNITS);
  run.shop = [];
  for (let i = 0; i < ECONOMY.SHOP_SLOTS; i++) run.shop.push(keys[Math.floor(runRand(run) * keys.length)]);
}
function rerollShop(run) {
  if (run.gold < ECONOMY.REROLL_COST) return { ok: false, msg: 'Không đủ vàng' };
  run.gold -= ECONOMY.REROLL_COST; rollShop(run);
  return { ok: true };
}
const fieldCount = run => Object.keys(run.field).length;
// Danh sách quân theo thứ tự cố định: sân (theo khóa), rồi ghế dự bị
function listUnits(run) {
  const out = [];
  for (const k of Object.keys(run.field).sort()) { const [x, y] = k.split(',').map(Number); out.push({ unit: run.field[k], zone: 'field', x, y }); }
  run.bench.forEach((u, i) => { if (u) out.push({ unit: u, zone: 'bench', i }); });
  return out;
}
function getAt(run, pos) { return pos.zone === 'field' ? run.field[fKey(pos.x, pos.y)] : run.bench[pos.i]; }
function setAt(run, pos, unit) {
  if (pos.zone === 'field') { if (unit) run.field[fKey(pos.x, pos.y)] = unit; else delete run.field[fKey(pos.x, pos.y)]; }
  else run.bench[pos.i] = unit || null;
}
// moveUnit: đặt/đổi chỗ (sân<->sân, sân<->ghế, ghế<->ghế). pos = {zone:'field',x,y} | {zone:'bench',i}
function moveUnit(run, src, dst) {
  const a = getAt(run, src);
  if (!a) return { ok: false, msg: 'Ô trống' };
  if (dst.zone === 'field' && (dst.x < 0 || dst.x > CONFIG.PLAYER_COLS[1] || dst.y < 0 || dst.y >= CONFIG.ROWS)) return { ok: false, msg: 'Ô không hợp lệ' };
  if (dst.zone === 'bench' && (dst.i < 0 || dst.i >= ECONOMY.BENCH_SIZE)) return { ok: false, msg: 'Ghế không hợp lệ' };
  const b = getAt(run, dst);
  if (src.zone === dst.zone && src.x === dst.x && src.y === dst.y && src.i === dst.i) return { ok: true };
  if (src.zone === 'bench' && dst.zone === 'field' && !b && fieldCount(run) >= fieldLimit(run.wave)) return { ok: false, msg: 'Sân đã đầy (' + fieldLimit(run.wave) + ' quân)' };
  setAt(run, dst, a); setAt(run, src, b || null);
  return { ok: true };
}
// Gộp sao: 3 quân cùng loại + cùng sao => 1 quân sao+1 (tối đa 3 sao). Lặp tới khi hết gộp được.
function mergeOnce(run) {
  for (const type of Object.keys(UNITS)) for (let star = 1; star < 3; star++) {
    const list = listUnits(run).filter(e => e.unit.type === type && e.unit.star === star);
    if (list.length < 3) continue;
    const three = list.slice(0, 3), pool = [], shards = [];
    three.forEach(e => { pool.push(...e.unit.genes); shards.push(...e.unit.shards); });
    const nu = { uid: run.nextUid++, type, star: star + 1, genes: pool.slice(0, CONFIG.MAX_GENES_PER_UNIT), shards: shards.slice(0, CONFIG.MEMORY_MAX) };
    if (pool.length > CONFIG.MAX_GENES_PER_UNIT) run.mergeQueue.push({ uid: nu.uid, pool });   // chờ người chơi chọn
    three.forEach(e => setAt(run, e, null));
    setAt(run, three[0], nu);   // đặt tại vị trí quân đầu tiên (ưu tiên quân ở sân)
    return { type, star: star + 1 };
  }
  return null;
}
function mergeAll(run) { const out = []; let m; while ((m = mergeOnce(run))) out.push(m); return out; }
function buyUnit(run, slot) {
  const type = run.shop[slot];
  if (!type) return { ok: false, msg: 'Slot trống' };
  if (run.gold < ECONOMY.BUY_COST) return { ok: false, msg: 'Không đủ vàng' };
  let bi = run.bench.indexOf(null);
  if (bi < 0) {   // ghế đầy: chỉ mua được nếu gộp ngay (đã có 2 quân cùng loại sao 1)
    if (listUnits(run).filter(e => e.unit.type === type && e.unit.star === 1).length < 2) return { ok: false, msg: 'Ghế dự bị đã đầy' };
    bi = run.bench.length;   // ô tạm, sẽ bị gộp ngay
  }
  run.gold -= ECONOMY.BUY_COST; run.shop[slot] = null;
  run.bench[bi] = makeRunUnit(run, type);
  const merged = mergeAll(run);
  while (run.bench.length > ECONOMY.BENCH_SIZE) run.bench.pop();
  return { ok: true, merged };
}
// opts.to = vị trí quân nhận "Truyền ký ức": mảnh +25% HP/ATK gốc (theo sao) của quân bị bán, mỗi quân tối đa 3 mảnh.
function sellUnit(run, pos, opts) {
  const u = getAt(run, pos);
  if (!u) return { ok: false, msg: 'Ô trống' };
  let shard = null;
  if (opts && opts.to) {
    const t = getAt(run, opts.to);
    if (!t || t === u) return { ok: false, msg: 'Quân nhận không hợp lệ' };
    if (t.shards.length >= CONFIG.MEMORY_MAX) return { ok: false, msg: 'Quân nhận đã đủ ' + CONFIG.MEMORY_MAX + ' mảnh ký ức' };
    const T = UNITS[u.type], sm = Math.pow(CONFIG.STAR_MULT, u.star - 1);
    shard = { hp: Math.round(T.hp * sm * CONFIG.MEMORY_PCT), atk: Math.round(T.atk * sm * CONFIG.MEMORY_PCT) };
    t.shards.push(shard);
  }
  const price = ECONOMY.SELL_UNIT[u.star];
  run.gold += price; setAt(run, pos, null);
  let lost = 0;
  for (const g of u.genes) { if (run.stash.length < ECONOMY.GENE_STASH_MAX) run.stash.push(g); else lost++; }   // gene trên quân về kho
  return { ok: true, price, lost, shard };
}
const enemyForWave = run => generateEnemy(run.wave, mulberry32(run.seed * 7919 + run.wave));
const battleSeed = run => (run.seed * 31 + run.wave) >>> 0;
function buildBattleState(run) {
  const player = listUnits(run).filter(e => e.zone === 'field').map(e => ({ type: e.unit.type, star: e.unit.star, genes: e.unit.genes.slice(), shards: e.unit.shards.slice(), x: e.x, y: e.y }));
  return { player, enemy: enemyForWave(run), ruleId: ruleForWave(run, run.wave) };
}
// Áp kết quả trận vào run: thu nhập, chuỗi thắng, mất mạng, sang ải kế / kết thúc run.
function applyBattleResult(run, res) {
  const win = res.winner === 'P', wave = run.wave, boss = isBossWave(wave);
  run.history.push({ wave, win, seconds: res.seconds });
  const obj = objectiveForWave(run, wave), objDone = checkObjective(obj, res);
  if (win) { run.wins++; run.streak++; } else run.streak = 0;
  const income = ECONOMY.INCOME_BASE + Math.floor(wave / 2);
  const bonus = run.streak >= 5 ? ECONOMY.STREAK_BONUS[5] : run.streak >= 3 ? ECONOMY.STREAK_BONUS[3] : 0;
  run.gold += income + bonus;
  const loss = win ? 0 : (boss ? ECONOMY.BOSS_LIFE_LOSS : 1);
  run.lives -= loss;
  if (run.lives <= 0) run.over = 'lose';
  else if (win && wave >= ECONOMY.TOTAL_WAVES) run.over = 'win';
  else {
    if (wave < ECONOMY.TOTAL_WAVES) run.wave++;   // thua ải 15 còn mạng: đánh lại ải 15
    rollShop(run);
    let n = win ? ECONOMY.GENE_CHOICES_WIN : ECONOMY.GENE_CHOICES_LOSE;
    if (objDone && obj.reward.extraGeneChoice) n += obj.reward.extraGeneChoice;
    run.geneChoice = { options: rollGeneChoices(run, wave, n), rerolled: false, wave, count: n };
    if (ECONOMY.BLACK_MARKET_AFTER.includes(wave)) run.market = { gene: rollGeneChoices(run, wave, 1, 'cursed')[0], wave };
  }
  let reward = null;
  if (objDone && !run.over) {   // thưởng nhiệm vụ phụ: vàng / (+1 lựa chọn gene đã cộng ở trên) / gene Hiếm ngẫu nhiên thẳng vào kho (kho đầy => đổi thành vàng bán gene)
    reward = { gold: 0, extraGeneChoice: obj.reward.extraGeneChoice || 0, rareGene: null };
    if (obj.reward.gold) { run.gold += obj.reward.gold; reward.gold = obj.reward.gold; }
    if (obj.reward.rareGene) {
      const gid = rollGeneChoices(run, wave, 1, 'rare')[0];
      if (run.stash.length < ECONOMY.GENE_STASH_MAX) { run.stash.push(gid); reward.rareGene = gid; }
      else { run.gold += ECONOMY.SELL_GENE; reward.gold += ECONOMY.SELL_GENE; reward.rareGene = gid; reward.converted = true; }
    }
  }
  return { win, wave, income, bonus, loss, streak: run.streak, over: run.over, obj: { id: obj.id, done: objDone, reward }, market: !!run.market };
}


// ======================= LUẬT / NHIỆM VỤ / CHỢ ĐEN (M5) =======================
// Toàn bộ suy ra từ seed của run (thuần, không cần lưu): lịch luật và nhiệm vụ từng ải.
// Luật: 4 luật khác nhau, bắt đầu ở các ải RULE_WAVES, mỗi luật kéo dài RULE_DURATION ải (áp cho cả hai phe).
function ruleSchedule(run) {
  const rng = mulberry32((run.seed ^ 0x9e3779b9) >>> 0), ids = RULES.map(r => r.id);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return ECONOMY.RULE_WAVES.map((start, i) => ({ start, end: start + ECONOMY.RULE_DURATION - 1, id: ids[i] }));
}
function ruleForWave(run, wave) { const r = ruleSchedule(run).find(x => wave >= x.start && wave <= x.end); return r ? r.id : null; }
// Luật sắp tới (để báo trước): { id, start, in } hoặc null
function nextRule(run, wave) { const r = ruleSchedule(run).find(x => x.start > wave); return r ? { id: r.id, start: r.start, in: r.start - wave } : null; }
function objectiveForWave(run, wave) { return OBJECTIVES[Math.floor(mulberry32((run.seed * 104729 + wave * 7) >>> 0)() * OBJECTIVES.length)]; }
// Chợ đen: sau ải 4/8/12 có 1 gene Nguyền rủa, trả bằng 1 mạng. Luôn có thể từ chối. Không cho mua nếu chỉ còn 1 mạng hoặc kho đầy.
function buyMarket(run) {
  const m = run.market;
  if (!m) return { ok: false, msg: 'Không có chợ đen' };
  if (run.lives <= 1) return { ok: false, msg: 'Chỉ còn 1 mạng — không thể trả' };
  if (run.stash.length >= ECONOMY.GENE_STASH_MAX) return { ok: false, msg: 'Kho gene đầy' };
  run.lives--; run.stash.push(m.gene); run.market = null;
  return { ok: true, gene: m.gene };
}
function refuseMarket(run) { run.market = null; return { ok: true }; }

// ======================= GENE TRONG RUN (M4) =======================
// Gene thưởng, kho gene, gắn/gỡ/bán gene, chọn gene khi gộp sao. Gene tự chạy qua engine chung ở simulateBattle
// (fire/applyEffect) — ở đây chỉ quản lý việc sở hữu gene, KHÔNG có code riêng cho từng gene.
function geneRarityWeights(wave) { let w = GENE_RARITY_BY_WAVE[0].w; for (const r of GENE_RARITY_BY_WAVE) if (wave >= r.fromWave) w = r.w; return w; }
// Bốc n gene khác nhau theo tỉ lệ độ hiếm của ải. Hết gene trong nhóm hiếm đã bốc thì lấy nhóm khác.
function rollGeneChoices(run, wave, n, forceRarity) {
  const w = geneRarityWeights(wave), keys = Object.keys(w), out = [];
  for (let i = 0; i < n; i++) {
    let r = forceRarity;
    if (!r) {
      let t = runRand(run) * keys.reduce((a, k) => a + w[k], 0);
      r = keys[keys.length - 1];
      for (const k of keys) { t -= w[k]; if (t < 0) { r = k; break; } }
    }
    let pool = GENES_BY_RARITY[r].filter(g => !out.includes(g.id));
    if (!pool.length) pool = GENES.filter(g => !out.includes(g.id));
    out.push(pool[Math.floor(runRand(run) * pool.length)].id);
  }
  return out;
}
function pickGene(run, idx) {
  const gc = run.geneChoice;
  if (!gc || !gc.options[idx]) return { ok: false, msg: 'Không có gene để chọn' };
  if (run.stash.length >= ECONOMY.GENE_STASH_MAX) return { ok: false, msg: 'Kho gene đầy (' + ECONOMY.GENE_STASH_MAX + '): gắn hoặc bán bớt gene trước' };
  run.stash.push(gc.options[idx]); run.geneChoice = null;
  return { ok: true };
}
function skipGene(run) { run.geneChoice = null; return { ok: true }; }
function rerollGeneChoice(run) {
  const gc = run.geneChoice;
  if (!gc) return { ok: false, msg: 'Không có lựa chọn gene' };
  if (gc.rerolled) return { ok: false, msg: 'Chỉ đổi được 1 lần mỗi ải' };
  if (run.gold < ECONOMY.GENE_REROLL_COST) return { ok: false, msg: 'Không đủ vàng' };
  run.gold -= ECONOMY.GENE_REROLL_COST; gc.rerolled = true;
  gc.options = rollGeneChoices(run, gc.wave, gc.count);
  return { ok: true };
}
function attachGene(run, stashIdx, pos) {
  const g = run.stash[stashIdx], u = getAt(run, pos);
  if (!g) return { ok: false, msg: 'Chưa chọn gene' };
  if (!u) return { ok: false, msg: 'Ô trống' };
  if (u.genes.length >= CONFIG.MAX_GENES_PER_UNIT) return { ok: false, msg: 'Quân đã đủ ' + CONFIG.MAX_GENES_PER_UNIT + ' gene — gỡ bớt trước' };
  u.genes.push(g); run.stash.splice(stashIdx, 1);
  return { ok: true };
}
function detachGene(run, pos, geneIdx) {
  const u = getAt(run, pos);
  if (!u || !u.genes[geneIdx]) return { ok: false, msg: 'Không có gene' };
  if (run.stash.length >= ECONOMY.GENE_STASH_MAX) return { ok: false, msg: 'Kho gene đầy' };
  run.stash.push(u.genes.splice(geneIdx, 1)[0]);
  return { ok: true };
}
function sellGene(run, stashIdx) {
  if (!run.stash[stashIdx]) return { ok: false, msg: 'Không có gene' };
  run.stash.splice(stashIdx, 1); run.gold += ECONOMY.SELL_GENE;
  return { ok: true, price: ECONOMY.SELL_GENE };
}
// Xử lý 1 mục chờ trong mergeQueue: keepIdx = chỉ số (trong item.pool) các gene giữ lại (tối đa 2)
function resolveMerge(run, keepIdx) {
  const item = run.mergeQueue.shift();
  if (!item) return { ok: false, msg: 'Không có gì để chọn' };
  const keep = [...new Set(keepIdx)].filter(i => i >= 0 && i < item.pool.length).slice(0, CONFIG.MAX_GENES_PER_UNIT);
  const e = listUnits(run).find(x => x.unit.uid === item.uid);
  if (e) e.unit.genes = keep.map(i => item.pool[i]);
  let lost = 0;
  item.pool.forEach((g, i) => { if (keep.includes(i)) return; if (run.stash.length < ECONOMY.GENE_STASH_MAX) run.stash.push(g); else lost++; });
  return { ok: true, lost };
}
// Chặn bắt đầu trận khi còn việc dở (chọn gene thưởng / chọn gene khi gộp)
const runBusy = run => !!run.geneChoice || run.mergeQueue.length > 0 || !!run.market;

// ======================= AUTO-PLAYTEST + LƯU RUN (M6) =======================
// Bot ngẫu nhiên chơi trọn run bằng đúng các hàm của run (buyUnit/moveUnit/pickGene/...) rồi gom thống kê để soi cân bằng.
// Bot KHÔNG bán quân, không reroll, không chọn synergy — chỉ là "người chơi ngẫu nhiên", dùng làm mốc so sánh.
function newPlaytestAcc() {
  const a = { runs: 0, wins: 0, endWave: {}, lives: 0, waves: {}, units: {}, genes: {}, rules: {}, objDone: 0, objN: 0, marketBuys: 0, marketSeen: 0 };
  for (let w = 1; w <= ECONOMY.TOTAL_WAVES; w++) a.waves[w] = { fights: 0, wins: 0, sec: 0, draws: 0, runsReached: 0 };
  for (const t of Object.keys(UNITS)) a.units[t] = { fights: 0, wins: 0, star: 0 };
  for (const g of GENES) a.genes[g.id] = { picked: 0, fights: 0, wins: 0, dmg: 0, trig: 0 };
  for (const r of RULES) a.rules[r.id] = { fights: 0, wins: 0 };
  return a;
}
function botPlayRun(seed, acc) {
  const run = newRun(seed), rng = mulberry32((seed * 2654435761) >>> 0), ri = n => Math.floor(rng() * n);
  const bot = { picks: 0 };
  let guard = 0;
  while (!run.over && guard++ < 60) {
    // mua: hết vàng thì thôi, chọn slot ngẫu nhiên
    for (let k = 0; k < 8 && run.gold >= ECONOMY.BUY_COST; k++) {
      const slots = run.shop.map((t, i) => t ? i : -1).filter(i => i >= 0); if (!slots.length) break;
      if (!buyUnit(run, slots[ri(slots.length)]).ok) break;
    }
    while (run.mergeQueue.length) { const n = run.mergeQueue[0].pool.length, idx = []; while (idx.length < Math.min(CONFIG.MAX_GENES_PER_UNIT, n)) { const i = ri(n); if (!idx.includes(i)) idx.push(i); } resolveMerge(run, idx); }
    if (run.geneChoice) { const o = run.geneChoice.options; const gid = o[ri(o.length)]; if (pickGene(run, o.indexOf(gid)).ok) { acc.genes[gid].picked++; } else skipGene(run); }
    if (run.market) { acc.marketSeen++; if (rng() < 0.5 && buyMarket(run).ok) { acc.marketBuys++; acc.genes[run.stash[run.stash.length - 1]].picked++; } else refuseMarket(run); }
    // xếp quân: đưa quân ghế dự bị lên sân ở ô trống ngẫu nhiên
    for (const e of listUnits(run).filter(e => e.zone === 'bench')) {
      if (fieldCount(run) >= fieldLimit(run.wave)) break;
      const cells = []; for (let y = 0; y < CONFIG.ROWS; y++) for (let x = CONFIG.PLAYER_COLS[0]; x <= CONFIG.PLAYER_COLS[1]; x++) if (!run.field[fKey(x, y)]) cells.push({ x, y });
      if (cells.length) moveUnit(run, e, Object.assign({ zone: 'field' }, cells[ri(cells.length)]));
    }
    for (const e of listUnits(run)) while (run.stash.length && e.unit.genes.length < CONFIG.MAX_GENES_PER_UNIT) { if (!attachGene(run, ri(run.stash.length), e).ok) break; }
    if (fieldCount(run) === 0) { run.over = 'lose'; break; }
    const st = buildBattleState(run), res = simulateBattle(st, battleSeed(run)), wave = run.wave, win = res.winner === 'P';
    const W = acc.waves[wave]; W.fights++; if (win) W.wins++; if (res.winner === 'draw') W.draws++; W.sec += res.seconds;
    if (st.ruleId) { acc.rules[st.ruleId].fights++; if (win) acc.rules[st.ruleId].wins++; }
    for (const e of listUnits(run).filter(e => e.zone === 'field')) {
      const U = acc.units[e.unit.type]; U.fights++; U.star += e.unit.star; if (win) U.wins++;
      for (const gid of e.unit.genes) { const G = acc.genes[gid]; G.fights++; if (win) G.wins++; }
    }
    for (const gid in res.stats.geneDamage || {}) if (acc.genes[gid]) acc.genes[gid].dmg += res.stats.geneDamage[gid] || 0;
    for (const gid in res.stats.geneTriggers || {}) if (acc.genes[gid]) acc.genes[gid].trig += res.stats.geneTriggers[gid] || 0;
    const sum = applyBattleResult(run, res); acc.objN++; if (sum.obj.done) acc.objDone++;
  }
  acc.runs++; if (run.over === 'win') acc.wins++; acc.lives += Math.max(0, run.lives);
  acc.endWave[run.wave] = (acc.endWave[run.wave] || 0) + 1;
  for (let w = 1; w <= run.wave; w++) acc.waves[w].runsReached++;
  return run;
}
// Chạy n run theo từng cụm nhỏ để trình duyệt không bị đơ. onProgress(done,n), onDone(acc).
function autoPlaytest(n, baseSeed, onProgress, onDone) {
  const acc = newPlaytestAcc(); let i = 0; const CH = 4;
  (function step() {
    const end = Math.min(n, i + CH);
    for (; i < end; i++) botPlayRun((baseSeed + i * 7919) >>> 0, acc);
    if (onProgress) onProgress(i, n);
    if (i < n) setTimeout(step, 0); else onDone(acc);
  })();
}
// Lưu / nạp run (localStorage ở index.html). run là JSON thuần; RNG của run suy ra từ (seed, rngN) nên nạp lại là tiếp tục y hệt.
const SAVE_VERSION = 1;
function serializeRun(run) { return JSON.stringify({ v: SAVE_VERSION, run }); }
function parseRun(str) {
  try {
    const d = JSON.parse(str), r = d && d.run;
    if (!d || d.v !== SAVE_VERSION || !r || r.over) return null;
    const okNum = k => typeof r[k] === 'number' && isFinite(r[k]);
    if (!['seed', 'rngN', 'wave', 'gold', 'lives', 'streak', 'wins', 'nextUid'].every(okNum)) return null;
    if (r.wave < 1 || r.wave > ECONOMY.TOTAL_WAVES) return null;
    if (!Array.isArray(r.bench) || r.bench.length !== ECONOMY.BENCH_SIZE || !Array.isArray(r.stash) || !Array.isArray(r.shop) || !Array.isArray(r.history) || !Array.isArray(r.mergeQueue)) return null;
    if (!r.field || typeof r.field !== 'object') return null;
    const unitOk = u => u === null || (u && UNITS[u.type] && u.star >= 1 && u.star <= 3 && Array.isArray(u.genes) && u.genes.every(g => GENE_BY_ID[g]) && Array.isArray(u.shards));
    if (!r.bench.every(unitOk) || !Object.values(r.field).every(u => u && unitOk(u))) return null;
    if (!r.stash.every(g => GENE_BY_ID[g])) return null;
    if (r.geneChoice === undefined) r.geneChoice = null; if (r.market === undefined) r.market = null;
    return r;
  } catch (e) { return null; }
}
// Hash nhỏ của chuỗi sự kiện, để debug so sánh 2 lần chạy cùng seed.
function hashEvents(res) { const s = JSON.stringify(res.events); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }

// ======================= DEMO (console) =======================
// Mở index.html -> F12 -> demoBattle(1, 3)  hoặc demoBattle(seed, wave, ruleId, verbose)
const DEMO_TEAM = [
  { type: 'tank', star: 1, genes: ['da_cung'], x: 3, y: 2 },
  { type: 'fighter', star: 1, genes: ['rang_nanh'], x: 3, y: 1 },
  { type: 'assassin', star: 1, genes: [], x: 2, y: 3 },
  { type: 'archer', star: 1, genes: ['lua_ky_sinh'], x: 1, y: 2 },
  { type: 'mage', star: 1, genes: ['mua_dan'], x: 1, y: 1 },
  { type: 'healer', star: 1, genes: ['tiep_mau'], x: 0, y: 2 }
];
function demoBattle(seed, wave, ruleId, verbose) {
  seed = seed || 1; wave = wave || 1;
  const enemy = generateEnemy(wave, mulberry32(seed * 7919 + wave));
  const res = simulateBattle({ player: DEMO_TEAM, enemy, ruleId: ruleId || null }, seed);
  const lines = formatLog(res, !!verbose);
  console.log(lines.join('\n'));
  console.log('--- stats ---', JSON.stringify({ winner: res.winner, seconds: res.seconds, deaths: res.stats.deaths, damageByGene: res.stats.damageByGene, healTotal: res.stats.healTotal, geneTriggers: res.stats.geneTriggers }));
  return res;
}
