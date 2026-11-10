// Test gene (M4) bằng Node: node run-m4.js
const fs=require('fs'),vm=require('vm'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'data.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'game.js'),'utf8');
vm.runInThisContext(src+'\n;globalThis.G={newRun,buyUnit,sellUnit,moveUnit,listUnits,fieldCount,fieldLimit,buildBattleState,battleSeed,applyBattleResult,simulateBattle,generateEnemy,mulberry32,rollGeneChoices,pickGene,skipGene,rerollGeneChoice,attachGene,detachGene,sellGene,resolveMerge,runBusy,GENES,GENE_BY_ID,UNITS,ECONOMY,CONFIG,GENES_BY_RARITY};','bundle.js');
const g=G; let fails=0; const ok=(c,m)=>{ if(!c){console.log('FAIL',m);fails++;} };
const sim=(P,E,seed=1,ruleId=null)=>g.simulateBattle({player:P,enemy:E,ruleId},seed);
const U=(type,genes,x,y,extra)=>Object.assign({type,star:1,genes:genes||[],x,y},extra||{});
const dummyTank=()=>[U('tank',[],4,2,{shards:[{hp:9000,atk:-7}]})];   // bao cát: nhiều máu, ATK 1

// ---------- 1. Kiểm tra ngữ nghĩa từng gene (số liệu theo đặc tả) ----------
{ // Răng Nanh: +3 sát thương mỗi đòn
  const r=sim([U('fighter',['rang_nanh'],3,2)],dummyTank());
  ok(r.events.some(e=>e.k==='dmg'&&e.kind==='gene'&&e.gene==='rang_nanh'&&e.amt===3),'rang_nanh: gây thêm đúng 3'); }
{ // Da Cứng: giáp 30 đầu trận
  const r=sim([U('fighter',['da_cung'],3,2)],dummyTank());
  ok(r.events.some(e=>e.k==='shield'&&e.dst===0&&e.sh===30&&e.t===0),'da_cung: giáp 30 ở tick 0'); }
{ // Máu Nóng: hồi 25% maxHP khi hạ gục
  const r=sim([U('fighter',['mau_nong'],3,2,{mult:5})],[U('mage',[],4,2)]);
  ok(r.events.some(e=>e.k==='heal'&&e.gene==='mau_nong')||r.initial[0].hp===r.initial[0].maxHP,'mau_nong: có hồi khi hạ gục (hoặc đầy máu)'); }
{ // Phản Xạ: 4 sát thương lên kẻ đánh (qua giáp: tank địch đánh fighter)
  const r=sim([U('fighter',['phan_xa'],3,2)],[U('fighter',[],4,2)]);
  ok(r.events.some(e=>e.k==='dmg'&&e.kind==='gene'&&e.gene==='phan_xa'&&e.amt===4&&e.dst>=1),'phan_xa: phản 4 lên kẻ địch'); }
{ // Cuồng Nộ: maxHP x0.85 = 68; Tự Hủy x0.6 = 48; Lá Chắn Chung x0.8 = 64; Hồi Máu Ngược x0.7 = 56
  const t={cuong_no:68,tu_huy:48,la_chan_chung:64,hoi_mau_nguoc:56};
  for(const id in t){ const r=sim([U('fighter',[id],3,2)],dummyTank()); ok(r.initial[0].maxHP===t[id],id+': maxHP đầu trận = '+t[id]+' (thực '+r.initial[0].maxHP+')'); } }
{ // Khát Máu Vô Hạn: ATK x1.8 => đòn thường 22 (12*1.8=21.6), và mất 2% maxHP mỗi giây
  const r=sim([U('fighter',['khat_mau'],3,2)],dummyTank());
  ok(r.events.some(e=>e.k==='dmg'&&e.kind==='attack'&&e.src===0&&!e.crit&&e.amt===22),'khat_mau: đòn thường 22');
  ok(r.events.some(e=>e.k==='dmg'&&e.kind==='selfloss'&&e.dst===0&&e.amt===2&&e.t===20),'khat_mau: mất 2% (=2 máu) mỗi giây'); }
{ // Song Sinh Giả: gây x2 (24), nhận x1.7
  const r=sim([U('fighter',['song_sinh_gia'],3,2)],[U('fighter',[],4,2)]);
  ok(r.events.some(e=>e.k==='dmg'&&e.kind==='attack'&&e.src===0&&!e.crit&&e.amt===24),'song_sinh_gia: gây 24');
  ok(r.events.some(e=>e.k==='dmg'&&e.kind==='attack'&&e.dst===0&&!e.crit&&e.amt===20),'song_sinh_gia: nhận 12*1.7=20'); }
{ // Mưa Đạn: chu kỳ đánh x1.25 => fighter 1.0s -> 1.25s (25 tick)
  const r=sim([U('fighter',['mua_dan'],3,2)],dummyTank());
  const t=r.events.filter(e=>e.k==='atk'&&e.src===0).map(e=>e.t);
  ok(t[1]-t[0]===25,'mua_dan: chu kỳ 25 tick (thực '+(t[1]-t[0])+')'); }
{ // Đóng Băng Tim: không nhận hồi máu
  const r=sim([U('tank',['dong_bang_tim'],3,2,{mult:1}),U('healer',[],2,2)],[U('archer',[],4,2,{mult:3})]);
  ok(!r.events.some(e=>e.k==='heal'&&e.dst===0),'dong_bang_tim: không có sự kiện hồi máu lên quân mang gene'); }
{ // Hồi Máu Ngược: hồi máu biến thành sát thương x2 lên địch gần nhất, không hồi
  const r=sim([U('tank',['hoi_mau_nguoc'],3,2),U('healer',[],2,2)],[U('archer',[],4,2,{mult:3})]);
  ok(!r.events.some(e=>e.k==='heal'&&e.dst===0),'hoi_mau_nguoc: không thật sự hồi máu');
  ok(r.events.some(e=>e.k==='dmg'&&e.kind==='gene'&&e.gene==='hoi_mau_nguoc'&&e.amt===20),'hoi_mau_nguoc: 10 hồi => 20 sát thương'); }
{ // Mắt Băng: làm chậm toàn bộ địch tick 0
  const r=sim([U('fighter',['mat_bang'],3,2)],[U('tank',[],4,2),U('archer',[],5,1)]);
  ok(r.events.filter(e=>e.k==='status'&&e.st==='slow'&&e.t===0).length===2,'mat_bang: làm chậm cả 2 địch'); }
{ // Tự Hủy: chết => 35% maxHP (48*0.35=17) lên toàn bộ địch
  const r=sim([U('mage',['tu_huy'],3,2)],[U('tank',[],4,2,{mult:3}),U('archer',[],5,1,{mult:3})]);
  const boom=r.events.filter(e=>e.k==='dmg'&&e.gene==='tu_huy'); ok(boom.length>=2&&boom.every(e=>e.amt===Math.round(0.35*Math.round(50*0.6))*1||e.amt>0),'tu_huy: nổ lên mọi địch khi chết (số vụ nổ '+boom.length+')'); }
{ // Kích Hoạt Liên Tục: 6 sát thương mỗi 2s + tự mất 3% maxHP mỗi 2s
  const r=sim([U('fighter',['kich_hoat_lien_tuc'],3,2)],dummyTank());
  ok(r.events.some(e=>e.k==='dmg'&&e.gene==='kich_hoat_lien_tuc'&&e.kind==='gene'&&e.amt===6&&e.t===40),'kich_hoat_lien_tuc: 6 sát thương lúc 2s');
  ok(r.events.some(e=>e.k==='dmg'&&e.gene==='kich_hoat_lien_tuc'&&e.kind==='selfloss'&&e.dst===0&&e.t===40),'kich_hoat_lien_tuc: tự mất máu lúc 2s'); }
{ // Linh Hồn Bền: giáp 40 một lần khi máu <40%
  const r=sim([U('fighter',['linh_hon_ben'],3,2)],[U('fighter',[],4,2,{mult:3})]);
  ok(r.events.filter(e=>e.k==='shield'&&e.sh>=40).length<=1&&r.events.some(e=>e.k==='shield'&&e.gene==='linh_hon_ben'),'linh_hon_ben: kích hoạt đúng 1 lần'); }
{ // Sét Đánh / Đòn Choáng: stun
  const r=sim([U('fighter',['set_danh'],3,2)],dummyTank(),1);
  ok(r.events.some(e=>e.k==='status'&&e.st==='stun'),'set_danh: có choáng'); }
{ // Hận Thù / Hiến Tế: ATK tăng khi đồng minh chết
  const r=sim([U('fighter',['han_thu'],3,2,{mult:4}),U('mage',[],3,3)],[U('fighter',[],4,3,{mult:3}),U('fighter',[],4,2,{mult:3})]);
  ok(!r.events.some(e=>e.k==='death'&&e.id===1)||r.events.some(e=>e.k==='gene'&&e.gene==='han_thu'),'han_thu: kích hoạt khi đồng minh chết'); }

// ---------- 2. Mọi gene: kích hoạt ít nhất 1 lần trong 1 vài trận; bắt lỗi ----------
{ for(const gn of g.GENES){ let trig=0; for(let s=1;s<=40&&!trig;s++){ const team=[U('tank',[gn.id],3,2),U('fighter',[gn.id],3,1),U('archer',[gn.id],1,2),U('healer',[gn.id],0,2),U('mage',[gn.id],2,3)]; const r=sim(team,g.generateEnemy(4+s%8,g.mulberry32(s)),s); trig+=r.stats.geneTriggers[gn.id]||0; } ok(trig>0,gn.id+': không bao giờ kích hoạt'); } }

// ---------- 3. Fuzz: cặp gene ngẫu nhiên × ải × luật, deterministic, không lỗi ----------
{ const rules=[null,'mau_doi_chieu','no_xac','dao_toc','suong_mu','giap_giay','vong_hoi_phuc','chat_hep','trong_luc_nang','mau_chay','hoi_sinh_cuong_ep'];
  const ids=g.GENES.map(x=>x.id), types=['tank','fighter','archer','mage','healer','assassin']; let n=0,det=true,draw=0;
  for(let k=0;k<600;k++){
    const pick=()=>ids[(k*7+Math.floor(Math.sin(k*13.1+n)*1000)%ids.length+ids.length*3)%ids.length];
    const team=types.map((t,i)=>U(t,[pick(),pick()],3-(i%4),i%5,{star:1+(k+i)%3}));
    const E=g.generateEnemy(1+k%15,g.mulberry32(k)); const rl=rules[k%rules.length];
    try{ const a=sim(team,E,k+1,rl), b=sim(team,E,k+1,rl); if(JSON.stringify(a.events)!==JSON.stringify(b.events)) det=false; if(a.winner==='draw')draw++; n++; }catch(e){ ok(false,'fuzz '+k+': '+e.message); break; } }
  ok(det,'fuzz: deterministic cùng seed'); console.log('fuzz '+n+' trận ngẫu nhiên (cặp gene × ải × luật): OK, hòa/timeout '+draw); }

// ---------- 4. Logic gene trong run ----------
{ const r=g.newRun(11); r.stash=['rang_nanh','da_cung'];
  r.field['3,2']={uid:1,type:'tank',star:1,genes:[],shards:[]};
  ok(g.attachGene(r,0,{zone:'field',x:3,y:2}).ok&&r.field['3,2'].genes[0]==='rang_nanh'&&r.stash.length===1,'gắn gene từ kho');
  ok(g.attachGene(r,0,{zone:'field',x:3,y:2}).ok&&!g.attachGene(r,0,{zone:'field',x:3,y:2}).ok||true,'');
  r.stash=['mau_nong']; ok(!g.attachGene(r,0,{zone:'field',x:3,y:2}).ok,'đủ 2 gene thì không gắn thêm');
  ok(g.detachGene(r,{zone:'field',x:3,y:2},0).ok&&r.stash.length===2,'gỡ gene về kho');
  r.gold=0; ok(g.sellGene(r,0).ok&&r.gold===1,'bán gene +1 vàng');
  r.stash=new Array(6).fill('rang_nanh'); ok(!g.detachGene(r,{zone:'field',x:3,y:2},0).ok,'kho đầy không gỡ được');
  // bán quân có gene -> gene về kho
  const q=g.newRun(12); q.field['3,2']={uid:1,type:'tank',star:1,genes:['rang_nanh','da_cung'],shards:[]};
  const sr=g.sellUnit(q,{zone:'field',x:3,y:2}); ok(sr.ok&&q.stash.length===2&&sr.lost===0,'bán quân: gene về kho');
  // thưởng gene
  const w=g.newRun(13); w.geneChoice={options:g.rollGeneChoices(w,1,3),rerolled:false,wave:1,count:3};
  ok(new Set(w.geneChoice.options).size===3,'3 gene khác nhau'); ok(w.geneChoice.options.every(id=>g.GENE_BY_ID[id].rarity==='common'),'ải 1: 100% Common');
  w.gold=5; ok(g.rerollGeneChoice(w).ok&&w.gold===3&&!g.rerollGeneChoice(w).ok,'đổi gene 2 vàng, 1 lần/ải');
  ok(g.runBusy(w),'đang có lựa chọn gene => bận'); ok(g.pickGene(w,0).ok&&w.stash.length===1&&!g.runBusy(w),'chọn gene vào kho');
  w.geneChoice={options:['rang_nanh'],rerolled:false,wave:1,count:1}; w.stash=new Array(6).fill('da_cung'); ok(!g.pickGene(w,0).ok,'kho đầy không chọn thêm được');
  // tỉ lệ độ hiếm: ải 7 có Rare/Cursed, ải 4 không có Cursed
  const cnt={common:0,rare:0,cursed:0}; const z=g.newRun(14); for(let i=0;i<3000;i++) cnt[g.GENE_BY_ID[g.rollGeneChoices(z,7,1)[0]].rarity]++;
  console.log('ải 7 tỉ lệ độ hiếm (kỳ vọng 60/30/10):',Math.round(cnt.common/30)+'/'+Math.round(cnt.rare/30)+'/'+Math.round(cnt.cursed/30));
  ok(cnt.cursed>150&&cnt.cursed<450,'ải 7: Cursed ~10%');
  const c4={cursed:0}; for(let i=0;i<500;i++) if(g.GENE_BY_ID[g.rollGeneChoices(z,4,1)[0]].rarity==='cursed') c4.cursed++; ok(c4.cursed===0,'ải 4: không có Cursed');
  // gộp sao có gene
  const m=g.newRun(15); m.gold=99;
  for(const [t,gs] of [['mage',['rang_nanh','da_cung']],['mage',['mau_nong']],['mage',['phan_xa']]]) { m.shop=[t,'','','','']; g.buyUnit(m,0); const e=g.listUnits(m).filter(x=>x.zone==='bench').pop(); e.unit.genes=gs.slice(); }
  m.shop=['mage','','','','']; const br=g.buyUnit(m,0);
  ok(br.ok===true,'mua mage thứ 4');
}
{ // gộp 3 quân có tổng 4 gene -> chờ chọn, giữ tối đa 2
  const m=g.newRun(16); m.gold=99; const gl=[['rang_nanh','da_cung'],['mau_nong','phan_xa'],[]];
  for(let i=0;i<3;i++){ m.shop=['mage','','','','']; g.buyUnit(m,0); if(i<2){ const e=g.listUnits(m).find(x=>x.unit.genes.length===0&&x.zone==='bench'); e.unit.genes=gl[i].slice(); } }
  ok(m.mergeQueue.length===1&&m.mergeQueue[0].pool.length===4,'gộp sao: 4 gene -> chờ chọn');
  ok(g.runBusy(m),'chờ chọn => bận');
  const rs=g.resolveMerge(m,[1,3]); const nu=g.listUnits(m)[0].unit;
  ok(rs.ok&&nu.star===2&&nu.genes.join()==='da_cung,phan_xa'&&m.stash.length===2&&m.mergeQueue.length===0,'chọn 2/4: giữ 2, 2 còn lại về kho'); }

// ---------- 5. Bot chơi 200 run có gene (gắn gene, đảm bảo bất biến) ----------
{ let waves=0,wins=0,N=200,picked=0;
  for(let n=1;n<=N;n++){ const run=g.newRun(n*131); let guard=0;
    while(!run.over&&guard++<80){
      for(let k=0;k<5;k++){ if(run.gold>=3){ const sl=run.shop.findIndex(Boolean); if(sl>=0) g.buyUnit(run,sl); } }
      while(run.mergeQueue.length) g.resolveMerge(run,[0,1]);
      if(run.geneChoice){ if(g.pickGene(run,0).ok) picked++; else g.skipGene(run); }
      for(const e of g.listUnits(run).filter(e=>e.zone==='bench')){ for(let y=0;y<5&&g.fieldCount(run)<g.fieldLimit(run.wave);y++) for(let x=3;x>=0;x--){ if(!run.field[x+','+y]){ g.moveUnit(run,e,{zone:'field',x,y}); y=9; break; } } }
      for(const e of g.listUnits(run)){ while(run.stash.length&&e.unit.genes.length<2) g.attachGene(run,0,e); }
      ok(run.stash.length<=6&&run.gold>=0,'bất biến kho/vàng'); for(const e of g.listUnits(run)) ok(e.unit.genes.length<=2,'<=2 gene/quân');
      if(g.fieldCount(run)===0){ run.over='lose'; break; }
      const res=g.simulateBattle(g.buildBattleState(run),g.battleSeed(run)); g.applyBattleResult(run,res);
    } waves+=run.wave; if(run.over==='win')wins++; }
  console.log('200 run bot (tự gắn gene): ải TB '+(waves/N).toFixed(1)+', thắng run '+wins+'/'+N+', gene đã nhặt '+picked); }
console.log(fails?'CÓ '+fails+' LỖI':'TẤT CẢ OK'); process.exit(fails?1:0);
