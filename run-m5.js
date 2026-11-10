// Test M5: luật theo ải, nhiệm vụ phụ, chợ đen, mảnh ký ức.   node run-m5.js
const fs=require('fs'),vm=require('vm'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'data.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'game.js'),'utf8');
vm.runInThisContext(src+'\n;globalThis.G={newRun,buyUnit,sellUnit,moveUnit,listUnits,fieldCount,fieldLimit,buildBattleState,battleSeed,applyBattleResult,simulateBattle,pickGene,skipGene,attachGene,resolveMerge,runBusy,ruleSchedule,ruleForWave,nextRule,objectiveForWave,buyMarket,refuseMarket,checkObjective,GENES,GENE_BY_ID,RULES,OBJECTIVES,UNITS,ECONOMY,CONFIG};','bundle.js');
const g=G; let fails=0; const ok=(c,m)=>{ if(!c){fails++;console.log('FAIL '+m);} };
// 1. lịch luật
{ const r=g.newRun(5), sc=g.ruleSchedule(r);
  ok(sc.length===4&&new Set(sc.map(x=>x.id)).size===4,'4 luật khác nhau');
  ok(JSON.stringify(sc)===JSON.stringify(g.ruleSchedule(g.newRun(5))),'lịch luật deterministic theo seed');
  for(let w=1;w<=15;w++){ const id=g.ruleForWave(r,w), exp=sc.find(x=>w>=x.start&&w<=x.end); ok(id===(exp?exp.id:null),'ruleForWave '+w); }
  ok(g.ruleForWave(r,2)===null&&g.ruleForWave(r,3)===sc[0].id&&g.ruleForWave(r,5)===sc[0].id&&g.ruleForWave(r,6)===sc[1].id&&g.ruleForWave(r,15)===null,'ải 3-5 luật 1, 6-8 luật 2, ải 15 không luật');
  const n=g.nextRule(r,1); ok(n&&n.start===3&&n.in===2&&n.id===sc[0].id,'nextRule báo trước'); ok(g.nextRule(r,12)===null,'hết luật => null');
  ok(g.buildBattleState(Object.assign({},r,{wave:4})).ruleId===sc[0].id,'buildBattleState mang ruleId'); }
// 2. nhiệm vụ
{ const r=g.newRun(9); for(let w=1;w<=15;w++) ok(g.objectiveForWave(r,w)===g.objectiveForWave(r,w),'obj ổn định');
  const seen=new Set(); for(let s=1;s<200;s++) seen.add(g.objectiveForWave(g.newRun(s),4).id); ok(seen.size===g.OBJECTIVES.length,'mọi nhiệm vụ đều có thể ra'); }
// 3. thưởng nhiệm vụ
function fake(win){ return {winner:win?'P':'E',seconds:5,survivors:[],stats:{deaths:{P:0,E:3},frontline:[],lastDeath:{E:{kind:'gene'}},damageByGene:{P:999},healTotal:{P:0}}}; }
function runWith(seed,wave,objId,win){ const r=g.newRun(seed); r.wave=wave; const real=g.OBJECTIVES.find(o=>o.id===objId);
  const o=g.objectiveForWave(r,wave); if(o.id!==objId){ for(let s=1;s<5000;s++){ const q=g.newRun(s); q.wave=wave; if(g.objectiveForWave(q,wave).id===objId) return q; } } return r; }
{ const r=runWith(1,3,'toc_chien'); const gold0=r.gold; const s=g.applyBattleResult(r,fake(true));
  ok(s.obj.done&&s.obj.reward.gold===3,'Tốc Chiến đạt +3'); ok(r.gold===gold0+s.income+s.bonus+3,'vàng nhận đủ');
  const r2=runWith(1,3,'toc_chien'); const sl=fake(true); sl.seconds=40; ok(!g.applyBattleResult(r2,sl).obj.done,'Tốc Chiến 40s không đạt'); }
{ const r=runWith(1,3,'khong_ai_chet'); const s=g.applyBattleResult(r,fake(true)); ok(s.obj.done&&r.geneChoice.count===4&&r.geneChoice.options.length===4,'Bất Tử Đội => 4 lựa chọn gene'); }
{ const r=runWith(1,3,'chot_bang_gene'); const s=g.applyBattleResult(r,fake(true)); ok(s.obj.done&&r.stash.length===1&&g.GENE_BY_ID[r.stash[0]].rarity==='rare','Đòn Chốt Gene => gene Hiếm vào kho');
  const r2=runWith(1,3,'chot_bang_gene'); r2.stash=new Array(6).fill('da_cung'); const g0=r2.gold; const s2=g.applyBattleResult(r2,fake(true)); ok(r2.stash.length===6&&s2.obj.reward.converted&&r2.gold===g0+s2.income+s2.bonus+1,'kho đầy => đổi thành 1🪙'); }
{ const r=runWith(1,3,'toc_chien'); const s=g.applyBattleResult(r,fake(false)); ok(!s.obj.done,'thua không nhận thưởng'); }
// 4. chợ đen
{ const r=g.newRun(3); r.wave=4; g.applyBattleResult(r,fake(true)); ok(r.market&&g.GENE_BY_ID[r.market.gene].rarity==='cursed','sau ải 4 có chợ đen Cursed'); ok(g.runBusy(r),'chợ đen => bận');
  g.skipGene(r); ok(g.runBusy(r),'bỏ gene thưởng chưa tắt chợ đen');
  const l=r.lives,gid=r.market.gene; const b=g.buyMarket(r); ok(b.ok&&r.lives===l-1&&r.stash.includes(gid)&&!r.market,'mua: -1 mạng, gene vào kho');
  const r2=g.newRun(3); r2.wave=8; g.applyBattleResult(r2,fake(true)); g.refuseMarket(r2); ok(!r2.market&&r2.lives===5,'từ chối: không mất gì');
  const r3=g.newRun(3); r3.wave=12; r3.lives=2; g.applyBattleResult(r3,fake(true)); r3.lives=1; ok(!g.buyMarket(r3).ok&&r3.market,'1 mạng không mua được');
  const r4=g.newRun(3); r4.wave=4; g.applyBattleResult(r4,fake(true)); r4.stash=new Array(6).fill('da_cung'); ok(!g.buyMarket(r4).ok,'kho đầy không mua');
  const r5=g.newRun(3); r5.wave=5; g.applyBattleResult(r5,fake(true)); ok(!r5.market,'ải 5 không có chợ'); }
// 5. mảnh ký ức
{ const r=g.newRun(2); r.gold=99; r.shop=['tank','tank','tank','mage','mage']; g.buyUnit(r,0); g.buyUnit(r,3);
  const [a,b]=g.listUnits(r); const gold=r.gold; const hpB=g.UNITS[a.unit.type].hp, atkB=g.UNITS[a.unit.type].atk;
  const res=g.sellUnit(r,a,{to:b}); ok(res.ok&&b.unit.shards.length===1,'truyền ký ức tạo 1 mảnh');
  ok(res.shard.hp===Math.round(hpB*0.25)&&res.shard.atk===Math.round(atkB*0.25),'mảnh = 25% HP/ATK gốc'); ok(r.gold===gold+2,'vẫn nhận vàng bán');
  const r2=g.newRun(2); r2.gold=99; r2.shop=['tank','tank','tank','mage','mage']; for(let i=0;i<4;i++){ r2.shop=['tank','mage','mage','mage','mage']; g.buyUnit(r2,0); g.buyUnit(r2,1);} 
  const L=g.listUnits(r2); const tgt=L[0]; tgt.unit.shards=[{hp:1,atk:1},{hp:1,atk:1},{hp:1,atk:1}]; const other=L[1]; const gl=r2.gold;
  const bad=g.sellUnit(r2,other,{to:tgt}); ok(!bad.ok&&r2.gold===gl&&g.listUnits(r2).length===L.length,'quá 3 mảnh: từ chối, không bán');
  ok(!g.sellUnit(r2,other,{to:other}).ok,'không tự truyền cho mình');
  // mảnh có tác dụng trong trận
  const st={player:[{type:'tank',star:1,genes:[],shards:[{hp:100,atk:10}],x:3,y:2}],enemy:[{type:'tank',star:1,genes:[],x:4,y:2}]}; ok(JSON.stringify(g.simulateBattle(st,1).initial)!==JSON.stringify(g.simulateBattle({player:[{type:'tank',star:1,genes:[],x:3,y:2}],enemy:st.enemy},1).initial),'mảnh đổi chỉ số trong sim'); }
// 6. bot 200 run: toàn vẹn + dùng luật/chợ
{ let N=200,mk=0,waves=0,rulesSeen=new Set(),objDone=0,objN=0;
  for(let n=1;n<=N;n++){ const run=g.newRun(n*77); let guard=0;
    while(!run.over&&guard++<80){
      for(let k=0;k<5;k++){ if(run.gold>=3){ const sl=run.shop.findIndex(Boolean); if(sl>=0) g.buyUnit(run,sl); } }
      while(run.mergeQueue.length) g.resolveMerge(run,[0,1]);
      if(run.geneChoice){ if(!g.pickGene(run,0).ok) g.skipGene(run); }
      if(run.market){ if(n%2&&g.buyMarket(run).ok) mk++; else g.refuseMarket(run); }
      ok(!g.runBusy(run)||false,'bot đã xử lý hết');
      for(const e of g.listUnits(run).filter(e=>e.zone==='bench')){ for(let y=0;y<5&&g.fieldCount(run)<g.fieldLimit(run.wave);y++) for(let x=3;x>=0;x--){ if(!run.field[x+','+y]){ g.moveUnit(run,e,{zone:'field',x,y}); y=9; break; } } }
      for(const e of g.listUnits(run)){ while(run.stash.length&&e.unit.genes.length<2) g.attachGene(run,0,e); }
      if(g.fieldCount(run)===0){ run.over='lose'; break; }
      const st=g.buildBattleState(run); if(st.ruleId) rulesSeen.add(st.ruleId);
      const res=g.simulateBattle(st,g.battleSeed(run)); const s=g.applyBattleResult(run,res); objN++; if(s.obj.done) objDone++;
      ok((run.over||run.lives>0)&&run.gold>=0,'bất biến');
    } waves+=run.wave; }
  console.log('200 run bot: ải TB '+(waves/N).toFixed(1)+', mua chợ đen '+mk+', luật gặp '+rulesSeen.size+'/10, nhiệm vụ đạt '+(objDone/objN*100).toFixed(0)+'%'); }
console.log(fails?'CÓ '+fails+' LỖI':'TẤT CẢ OK'); process.exit(fails?1:0);
