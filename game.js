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
// gộp sao: giữ tối đa 2 gene đầu tiên (hộp chọn gene khi gộp làm ở M4).
const fKey = (x, y) => x + ',' + y;
function runRand(run) { run.rngN++; return mulberry32((run.seed ^ Math.imul(run.rngN, 2654435761)) >>> 0)(); }   // RNG của run, lưu được bằng (seed, rngN)
function fieldLimit(wave) { let n = 6; for (const f of ECONOMY.FIELD_SIZE) if (wave >= f.fromWave) n = f.size; return n; }
function isBossWave(w) { return ECONOMY.BOSS_WAVES.includes(w); }
function newRun(seed) {
  seed = (seed === undefined ? Math.floor(Math.random() * 1e9) : seed) >>> 0;
  const run = { seed, rngN: 0, wave: 1, gold: ECONOMY.START_GOLD, lives: ECONOMY.START_LIVES, streak: 0, wins: 0, over: null,
    nextUid: 1, field: {}, bench: new Array(ECONOMY.BENCH_SIZE).fill(null), shop: [], history: [] };
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
    const three = list.slice(0, 3), genes = [], shards = [];
    three.forEach(e => { genes.push(...e.unit.genes); shards.push(...e.unit.shards); });
    const nu = { uid: run.nextUid++, type, star: star + 1, genes: genes.slice(0, CONFIG.MAX_GENES_PER_UNIT), shards: shards.slice(0, CONFIG.MEMORY_MAX) };
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
function sellUnit(run, pos) {
  const u = getAt(run, pos);
  if (!u) return { ok: false, msg: 'Ô trống' };
  const price = ECONOMY.SELL_UNIT[u.star];
  run.gold += price; setAt(run, pos, null);
  return { ok: true, price };
}
const enemyForWave = run => generateEnemy(run.wave, mulberry32(run.seed * 7919 + run.wave));
const battleSeed = run => (run.seed * 31 + run.wave) >>> 0;
function buildBattleState(run) {
  const player = listUnits(run).filter(e => e.zone === 'field').map(e => ({ type: e.unit.type, star: e.unit.star, genes: e.unit.genes.slice(), shards: e.unit.shards.slice(), x: e.x, y: e.y }));
  return { player, enemy: enemyForWave(run), ruleId: null };
}
// Áp kết quả trận vào run: thu nhập, chuỗi thắng, mất mạng, sang ải kế / kết thúc run.
function applyBattleResult(run, res) {
  const win = res.winner === 'P', wave = run.wave, boss = isBossWave(wave);
  run.history.push({ wave, win, seconds: res.seconds });
  if (win) { run.wins++; run.streak++; } else run.streak = 0;
  const income = ECONOMY.INCOME_BASE + Math.floor(wave / 2);
  const bonus = run.streak >= 5 ? ECONOMY.STREAK_BONUS[5] : run.streak >= 3 ? ECONOMY.STREAK_BONUS[3] : 0;
  run.gold += income + bonus;
  const loss = win ? 0 : (boss ? ECONOMY.BOSS_LIFE_LOSS : 1);
  run.lives -= loss;
  if (run.lives <= 0) run.over = 'lose';
  else if (win && wave >= ECONOMY.TOTAL_WAVES) run.over = 'win';
  else { if (wave < ECONOMY.TOTAL_WAVES) run.wave++; rollShop(run); }   // thua ải 15 còn mạng: đánh lại ải 15
  return { win, wave, income, bonus, loss, streak: run.streak, over: run.over };
}

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
