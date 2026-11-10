// GENE ARENA v0.1 — data.js
// Toàn bộ dữ liệu game (const toàn cục, không fetch). Thêm gene/rule/objective mới = chỉ sửa file này.

// ======================= CONFIG =======================
const CONFIG = {
  COLS: 8, ROWS: 5,
  PLAYER_COLS: [0, 3], ENEMY_COLS: [4, 7],     // [min,max] cột mỗi phe
  TICK_MS: 50, TICKS_PER_SEC: 20, MAX_BATTLE_SEC: 60,
  MOVE_SEC: 0.6,            // 1 ô / 0.6s cho mọi quân
  CRIT_CHANCE: 0.10, CRIT_MULT: 2,
  STAR_MULT: 1.8,           // mỗi sao x1.8 HP và ATK
  BURN_DPS: 5,              // burn: 5 sát thương/giây
  SLOW_MULT: 0.6,           // slow: -40% tốc độ (áp cho cả di chuyển lẫn nhịp đánh)
  MAX_GENES_PER_UNIT: 2,
  MEMORY_PCT: 0.25, MEMORY_MAX: 3,
  MAX_TRIGGER_DEPTH: 6      // chặn đệ quy chuỗi trigger
};

// Kinh tế & tiến trình run (dùng từ M3)
const ECONOMY = {
  START_GOLD: 10, START_LIVES: 5, TOTAL_WAVES: 15, BOSS_WAVES: [5, 10, 15], BOSS_LIFE_LOSS: 2,
  INCOME_BASE: 6,                       // thu nhập = 6 + floor(wave/2)
  STREAK_BONUS: { 3: 2, 5: 4 },
  SHOP_SLOTS: 5, REROLL_COST: 1, BUY_COST: 3,
  SELL_UNIT: { 1: 2, 2: 5, 3: 9 }, SELL_GENE: 1,
  GENE_REROLL_COST: 2, GENE_CHOICES_WIN: 3, GENE_CHOICES_LOSE: 2, GENE_STASH_MAX: 6,
  FIELD_SIZE: [{ fromWave: 1, size: 6 }, { fromWave: 6, size: 7 }, { fromWave: 11, size: 8 }],
  BENCH_SIZE: 4,
  RULE_WAVES: [3, 6, 9, 12], RULE_DURATION: 3,
  BLACK_MARKET_AFTER: [4, 8, 12]
};

// Tỉ lệ độ hiếm khi bốc gene theo ải (lấy dòng có fromWave lớn nhất <= ải hiện tại)
const GENE_RARITY_BY_WAVE = [
  { fromWave: 1, w: { common: 100 } },
  { fromWave: 3, w: { common: 75, rare: 25 } },
  { fromWave: 6, w: { common: 60, rare: 30, cursed: 10 } }
];

// Sinh địch (section 10)
const ENEMY = {
  BASE_COUNT: 2, MAX_COUNT: 8, SCALE_PER_WAVE: 0.12,
  COUNT_ADJUST: {},                      // chỉnh số quân theo ải, vd {1:-1}
  BOSS_COUNT_BONUS: 0, BOSS_MULT: 1, BOSS_RARE_FRAC: 1,   // boss: +quân (gốc 1, hạ về 0: ải 5 bot thắng 17%->44%), nhân chỉ số, tỉ lệ quân có gene Rare
  MULT_ADJUST: { 1: 0.85 },                       // nhân chỉ số thêm theo ải, ải 1 nhẹ tay (bot ngẫu nhiên: ~30% -> ~68%)
  TYPE_WEIGHTS: { tank: 3, fighter: 3, archer: 2, mage: 2, healer: 1, assassin: 1 },
  RANGED_TYPES: ['archer', 'mage'],      // "đánh xa" để đảm bảo khi >= 4 quân
  STAR2_CHANCE: 0.4,                     // ải 6-10: 40% quân sao 2
  STAR3_CHANCE: 0.4,                     // ải 11-15: 40% quân sao 3 (còn lại sao 2)
  RARE_CHANCE_W8: 0.3,                   // ải 8+: mỗi gene 30% là Rare
  ROLE_COL: { tank: 4, fighter: 5, assassin: 5, mage: 6, healer: 6, archer: 7 }, // cột ưa thích
  ROW_ORDER: [2, 1, 3, 0, 4]
};

// ======================= QUÂN =======================
// cd = chu kỳ đánh (giây). Cờ đặc biệt đọc bởi simulateBattle: taunt, splash, heal, jump.
const UNITS = {
  tank:     { id: 'tank',     name: 'Giáp Sắt', hp: 120, atk: 8,  cd: 1.2, range: 1, taunt: true,  note: 'Chặn đòn, thu hút mục tiêu' },
  fighter:  { id: 'fighter',  name: 'Kiếm Sĩ',  hp: 80,  atk: 12, cd: 1.0, range: 1, note: 'Cân bằng' },
  archer:   { id: 'archer',   name: 'Cung Thủ', hp: 55,  atk: 10, cd: 1.0, range: 4, note: 'Đánh xa' },
  mage:     { id: 'mage',     name: 'Pháp Sư',  hp: 50,  atk: 14, cd: 1.5, range: 3, splash: 0.5, note: 'Lan 50% sát thương sang ô kế bên' },
  healer:   { id: 'healer',   name: 'Y Sĩ',     hp: 60,  atk: 4,  cd: 1.5, range: 3, heal: 10, note: 'Hồi 10 HP cho đồng minh thấp máu % nhất trong tầm' },
  assassin: { id: 'assassin', name: 'Sát Thủ',  hp: 55,  atk: 14, cd: 0.8, range: 1, jump: true, note: 'Đầu trận nhảy ra sau lưng địch' }
};

// ======================= GENE =======================
// Schema: { id, name, desc, rarity, trigger:{type, n?, p?, chance?, replaces?}, effect:{type, target?, ...}, drawback?:{trigger?, effect} }
// trigger.type: battle_start | on_attack | on_hit_taken | on_kill | on_death | on_ally_death |
//               every_n_sec(n) | hp_below_pct(p, 1 lần/trận) | on_heal_received (mở rộng, cho Hồi Máu Ngược)
// effect.type : stat_mod(stat, op add|mult, value) | deal_damage(target, value, raw?) | heal | shield |
//               apply_status(status burn|slow|stun, duration[s]) | stack_stat(stat, value, max) | set_flag(flag)
// stat        : maxHP | ATK | cooldown | speed | range | dmgDealt | dmgTaken | crit
// target      : self | attacker | current_target | nearest_enemy | random_enemy | all_enemies |
//               lowest_hp_ally | all_allies | adjacent_enemies
// value       : số, hoặc { flat, atkPct, maxHpPct, victimMaxHpPct, ctxAmountMult }
// drawback.trigger mặc định = battle_start.
const GENES = [
  // ---------- COMMON ----------
  { id: 'rang_nanh', name: 'Răng Nanh', rarity: 'common',
    desc: 'Mỗi đòn đánh: gây thêm 3 sát thương lên mục tiêu.',
    trigger: { type: 'on_attack' }, effect: { type: 'deal_damage', target: 'current_target', value: 3 } },
  { id: 'da_cung', name: 'Da Cứng', rarity: 'common',
    desc: 'Đầu trận: nhận giáp 30.',
    trigger: { type: 'battle_start' }, effect: { type: 'shield', target: 'self', value: 30 } },
  { id: 'mau_nong', name: 'Máu Nóng', rarity: 'common',
    desc: 'Khi hạ gục địch: hồi 25% máu tối đa.',
    trigger: { type: 'on_kill' }, effect: { type: 'heal', target: 'self', value: { maxHpPct: 0.25 } } },
  { id: 'lua_ky_sinh', name: 'Lửa Ký Sinh', rarity: 'common',
    desc: 'Mỗi đòn đánh: 30% thiêu đốt mục tiêu 3s (5 sát thương/giây).',
    trigger: { type: 'on_attack', chance: 0.3 }, effect: { type: 'apply_status', target: 'current_target', status: 'burn', duration: 3 } },
  { id: 'phan_xa', name: 'Phản Xạ', rarity: 'common',
    desc: 'Khi bị đánh: phản 4 sát thương cho kẻ đánh.',
    trigger: { type: 'on_hit_taken' }, effect: { type: 'deal_damage', target: 'attacker', value: 4 } },
  { id: 'chay_nuoc_rut', name: 'Chạy Nước Rút', rarity: 'common',
    desc: 'Tốc độ di chuyển +30%.',
    trigger: { type: 'battle_start' }, effect: { type: 'stat_mod', target: 'self', stat: 'speed', op: 'mult', value: 1.3 } },
  { id: 'linh_hon_ben', name: 'Linh Hồn Bền', rarity: 'common',
    desc: 'Khi máu dưới 40% (1 lần/trận): nhận giáp 40.',
    trigger: { type: 'hp_below_pct', p: 40 }, effect: { type: 'shield', target: 'self', value: 40 } },
  { id: 'tiep_mau', name: 'Tiếp Máu', rarity: 'common',
    desc: 'Mỗi 4s: hồi 12 máu cho đồng minh thấp máu % nhất.',
    trigger: { type: 'every_n_sec', n: 4 }, effect: { type: 'heal', target: 'lowest_hp_ally', value: 12 } },
  { id: 'don_choang', name: 'Đòn Choáng', rarity: 'common',
    desc: 'Mỗi đòn đánh: 15% làm choáng mục tiêu 0.5s.',
    trigger: { type: 'on_attack', chance: 0.15 }, effect: { type: 'apply_status', target: 'current_target', status: 'stun', duration: 0.5 } },
  { id: 'han_thu', name: 'Hận Thù', rarity: 'common',
    desc: 'Khi đồng minh chết: +3 ATK (tối đa +15).',
    trigger: { type: 'on_ally_death' }, effect: { type: 'stack_stat', target: 'self', stat: 'ATK', value: 3, max: 15 } },

  // ---------- RARE (lợi lớn + 1 hại nhỏ) ----------
  { id: 'cuong_no', name: 'Cuồng Nộ', rarity: 'rare',
    desc: 'Khi bị đánh: +2 ATK (tối đa +20). Hại: máu tối đa -15%.',
    trigger: { type: 'on_hit_taken' }, effect: { type: 'stack_stat', target: 'self', stat: 'ATK', value: 2, max: 20 },
    drawback: { effect: { type: 'stat_mod', target: 'self', stat: 'maxHP', op: 'mult', value: 0.85 } } },
  { id: 'mua_dan', name: 'Mưa Đạn', rarity: 'rare',
    desc: 'Mỗi đòn đánh: bắn thêm 50% ATK vào 1 địch ngẫu nhiên. Hại: đánh chậm hơn 25%.',
    trigger: { type: 'on_attack' }, effect: { type: 'deal_damage', target: 'random_enemy', value: { atkPct: 0.5 } },
    drawback: { effect: { type: 'stat_mod', target: 'self', stat: 'cooldown', op: 'mult', value: 1.25 } } },
  { id: 'song_no', name: 'Sóng Nổ', rarity: 'rare',
    desc: 'Khi hạ gục địch: xác nổ 30% máu tối đa của nó lên địch kề cạnh. Hại: ATK -10%.',
    trigger: { type: 'on_kill' }, effect: { type: 'deal_damage', target: 'adjacent_enemies', value: { victimMaxHpPct: 0.3 } },
    drawback: { effect: { type: 'stat_mod', target: 'self', stat: 'ATK', op: 'mult', value: 0.9 } } },
  { id: 'dong_bang_tim', name: 'Đóng Băng Tim', rarity: 'rare',
    desc: 'Mỗi đòn đánh: 40% làm chậm mục tiêu 2s. Hại: không nhận được hồi máu.',
    trigger: { type: 'on_attack', chance: 0.4 }, effect: { type: 'apply_status', target: 'current_target', status: 'slow', duration: 2 },
    drawback: { effect: { type: 'set_flag', target: 'self', flag: 'noHeal' } } },
  { id: 'kich_hoat_lien_tuc', name: 'Kích Hoạt Liên Tục', rarity: 'rare',
    desc: 'Mỗi 2s: 6 sát thương lên 1 địch ngẫu nhiên. Hại: mất 3% máu tối đa mỗi 2s.',
    trigger: { type: 'every_n_sec', n: 2 }, effect: { type: 'deal_damage', target: 'random_enemy', value: 6 },
    drawback: { trigger: { type: 'every_n_sec', n: 2 }, effect: { type: 'deal_damage', target: 'self', value: { maxHpPct: 0.03 }, raw: true } } },
  { id: 'la_chan_chung', name: 'Lá Chắn Chung', rarity: 'rare',
    desc: 'Đầu trận: cả đội nhận giáp 15. Hại: máu tối đa bản thân -20%.',
    trigger: { type: 'battle_start' }, effect: { type: 'shield', target: 'all_allies', value: 15 },
    drawback: { effect: { type: 'stat_mod', target: 'self', stat: 'maxHP', op: 'mult', value: 0.8 } } },
  { id: 'lieu_mang', name: 'Liều Mạng', rarity: 'rare',
    desc: 'Khi máu dưới 50% (1 lần/trận): đánh nhanh hơn ~43%. Hại: nhận sát thương x1.15.',
    trigger: { type: 'hp_below_pct', p: 50 }, effect: { type: 'stat_mod', target: 'self', stat: 'cooldown', op: 'mult', value: 0.7 },
    drawback: { effect: { type: 'stat_mod', target: 'self', stat: 'dmgTaken', op: 'mult', value: 1.15 } } },
  { id: 'mat_bang', name: 'Mắt Băng', rarity: 'rare',
    desc: 'Đầu trận: làm chậm toàn bộ địch 3s. Hại: ATK -10%.',
    trigger: { type: 'battle_start' }, effect: { type: 'apply_status', target: 'all_enemies', status: 'slow', duration: 3 },
    drawback: { effect: { type: 'stat_mod', target: 'self', stat: 'ATK', op: 'mult', value: 0.9 } } },

  // ---------- CURSED (lợi rất lớn + 1 hại lớn) ----------
  { id: 'hoi_mau_nguoc', name: 'Hồi Máu Ngược', rarity: 'cursed',
    desc: 'Mọi lượng hồi máu nhận vào biến thành sát thương x2 lên địch gần nhất. Hại: máu tối đa -30%.',
    trigger: { type: 'on_heal_received', replaces: true }, effect: { type: 'deal_damage', target: 'nearest_enemy', value: { ctxAmountMult: 2 } },
    drawback: { effect: { type: 'stat_mod', target: 'self', stat: 'maxHP', op: 'mult', value: 0.7 } } },
  { id: 'khat_mau', name: 'Khát Máu Vô Hạn', rarity: 'cursed',
    desc: 'ATK +80%. Hại: mất 2% máu tối đa mỗi giây.',
    trigger: { type: 'battle_start' }, effect: { type: 'stat_mod', target: 'self', stat: 'ATK', op: 'mult', value: 1.8 },
    drawback: { trigger: { type: 'every_n_sec', n: 1 }, effect: { type: 'deal_damage', target: 'self', value: { maxHpPct: 0.02 }, raw: true } } },
  { id: 'tu_huy', name: 'Tự Hủy', rarity: 'cursed',
    desc: 'Khi chết: nổ 35% máu tối đa lên toàn bộ địch. Hại: máu tối đa -40%.',
    trigger: { type: 'on_death' }, effect: { type: 'deal_damage', target: 'all_enemies', value: { maxHpPct: 0.35 } },
    drawback: { effect: { type: 'stat_mod', target: 'self', stat: 'maxHP', op: 'mult', value: 0.6 } } },
  { id: 'song_sinh_gia', name: 'Song Sinh Giả', rarity: 'cursed',
    desc: 'Sát thương gây ra x2. Hại: sát thương nhận vào x1.7.',
    trigger: { type: 'battle_start' }, effect: { type: 'stat_mod', target: 'self', stat: 'dmgDealt', op: 'mult', value: 2 },
    drawback: { effect: { type: 'stat_mod', target: 'self', stat: 'dmgTaken', op: 'mult', value: 1.7 } } },
  { id: 'hien_te', name: 'Hiến Tế', rarity: 'cursed',
    desc: 'Khi đồng minh chết: +8 ATK (tối đa +40). Hại: mất 4% máu tối đa mỗi 3s.',
    trigger: { type: 'on_ally_death' }, effect: { type: 'stack_stat', target: 'self', stat: 'ATK', value: 8, max: 40 },
    drawback: { trigger: { type: 'every_n_sec', n: 3 }, effect: { type: 'deal_damage', target: 'self', value: { maxHpPct: 0.04 }, raw: true } } },
  { id: 'set_danh', name: 'Sét Đánh', rarity: 'cursed',
    desc: 'Mỗi 3s: làm choáng 1 địch ngẫu nhiên 1.5s. Hại: nhận sát thương x1.4.',
    trigger: { type: 'every_n_sec', n: 3 }, effect: { type: 'apply_status', target: 'random_enemy', status: 'stun', duration: 1.5 },
    drawback: { effect: { type: 'stat_mod', target: 'self', stat: 'dmgTaken', op: 'mult', value: 1.4 } } }
];
const GENE_BY_ID = Object.fromEntries(GENES.map(g => [g.id, g]));
const GENES_BY_RARITY = {
  common: GENES.filter(g => g.rarity === 'common'),
  rare: GENES.filter(g => g.rarity === 'rare'),
  cursed: GENES.filter(g => g.rarity === 'cursed')
};

// ======================= LUẬT THẾ GIỚI =======================
// Mỗi luật = bộ "mods" khai báo; simulateBattle đọc chung (không code riêng cho từng thẻ).
const DEFAULT_RULE_MODS = {
  critChance: null,     // đặt tỉ lệ crit gốc của mọi quân
  critHeals: false,     // crit => hồi máu mục tiêu thay vì gây sát thương
  deathExplodePct: 0,   // quân chết nổ % maxHP lên quân kề cạnh (cả hai phe)
  cooldownInvert: 0,    // >0: chu kỳ đánh = giá trị này - chu kỳ gốc
  rangeAdd: 0,          // cộng vào tầm đánh (tối thiểu 1)
  dmgMult: 1,           // nhân mọi sát thương
  regenPctPerSec: 0,    // hồi % maxHP mỗi giây cho mọi quân
  rows: null,           // chỉ dùng các hàng này (mảng) — null = tất cả
  moveMult: 1,          // nhân tốc độ di chuyển
  bleedEveryN: 0, bleedPctCurrent: 0, // mỗi N giây mất % máu hiện tại
  reviveFirst: 0        // quân chết đầu tiên mỗi phe hồi sinh 1 lần với % HP
};
const RULES = [
  { id: 'mau_doi_chieu', name: 'Máu Đổi Chiều', desc: 'Crit hồi máu cho mục tiêu thay vì gây sát thương. Tỉ lệ crit 25%.', mods: { critChance: 0.25, critHeals: true } },
  { id: 'no_xac', name: 'Nổ Xác', desc: 'Quân chết (cả hai phe) nổ 20% máu tối đa lên mọi quân kề cạnh.', mods: { deathExplodePct: 0.2 } },
  { id: 'dao_toc', name: 'Đảo Tốc', desc: 'Chu kỳ đánh = 2.2 trừ chu kỳ gốc (quân chậm đánh nhanh, quân nhanh đánh chậm).', mods: { cooldownInvert: 2.2 } },
  { id: 'suong_mu', name: 'Sương Mù', desc: 'Tầm đánh mọi quân -2 (tối thiểu 1).', mods: { rangeAdd: -2 } },
  { id: 'giap_giay', name: 'Giáp Giấy', desc: 'Mọi sát thương +40%.', mods: { dmgMult: 1.4 } },
  { id: 'vong_hoi_phuc', name: 'Vòng Hồi Phục', desc: 'Mọi quân hồi 3% máu tối đa mỗi giây.', mods: { regenPctPerSec: 0.03 } },
  { id: 'chat_hep', name: 'Chật Hẹp', desc: 'Bàn đấu chỉ dùng 3 hàng giữa.', mods: { rows: [1, 2, 3] } },
  { id: 'trong_luc_nang', name: 'Trọng Lực Nặng', desc: 'Tốc độ di chuyển -40%.', mods: { moveMult: 0.6 } },
  { id: 'mau_chay', name: 'Máu Chảy', desc: 'Mỗi 5s mọi quân mất 8% máu hiện tại.', mods: { bleedEveryN: 5, bleedPctCurrent: 0.08 } },
  { id: 'hoi_sinh_cuong_ep', name: 'Hồi Sinh Cưỡng Ép', desc: 'Quân chết đầu tiên của mỗi phe hồi sinh 1 lần với 30% HP.', mods: { reviveFirst: 0.3 } }
];
const RULES_BY_ID = Object.fromEntries(RULES.map(r => [r.id, r]));

// ======================= NHIỆM VỤ PHỤ =======================
// check.type được đánh giá bởi checkObjective(obj, result) dựa trên result.stats.
// reward: { gold } | { extraGeneChoice } | { rareGene }
const OBJECTIVES = [
  { id: 'toc_chien', name: 'Tốc Chiến', desc: 'Thắng trong 20 giây.', check: { type: 'win_within_sec', value: 20 }, reward: { gold: 3 } },
  { id: 'khong_ai_chet', name: 'Bất Tử Đội', desc: 'Thắng mà không quân nào của ta chết.', check: { type: 'no_ally_dead' }, reward: { extraGeneChoice: 1 } },
  { id: 'hang_dau_song', name: 'Tiền Tuyến Vững', desc: 'Mọi quân ở cột 3 (sát giữa bàn) sống sót đến cuối trận.', check: { type: 'frontline_survive', col: 3 }, reward: { gold: 3 } },
  { id: 'chot_bang_gene', name: 'Đòn Chốt Gene', desc: 'Kẻ địch cuối cùng bị hạ bằng sát thương từ gene (không phải đòn đánh thường).', check: { type: 'last_kill_by_gene' }, reward: { rareGene: 1 } },
  { id: 'gene_300', name: 'Nhà Di Truyền', desc: 'Gây tổng cộng >= 300 sát thương bằng gene.', check: { type: 'gene_damage_min', value: 300 }, reward: { gold: 4 } },
  { id: 'khong_hoi_mau', name: 'Tự Lực', desc: 'Thắng mà tổng lượng hồi máu của đội < 50.', check: { type: 'heal_total_max', value: 50 }, reward: { gold: 3 } }
];
const OBJECTIVES_BY_ID = Object.fromEntries(OBJECTIVES.map(o => [o.id, o]));
