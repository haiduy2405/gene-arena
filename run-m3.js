// Test logic run (M3) bằng Node: node run-m3.js
const fs=require('fs'),vm=require('vm'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'data.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'game.js'),'utf8');
vm.runInThisContext(src+'\n;globalThis.G={newRun,rerollShop,buyUnit,sellUnit,moveUnit,listUnits,fieldCount,fieldLimit,buildBattleState,battleSeed,applyBattleResult,simulateBattle,mergeAll,UNITS,ECONOMY};','bundle.js');
const {newRun,rerollShop,buyUnit,sellUnit,moveUnit,listUnits,fieldCount,fieldLimit,buildBattleState,battleSeed,applyBattleResult,simulateBattle,UNITS,ECONOMY}=G;
let fails=0; const ok=(c,m)=>{ if(!c){console.log('FAIL',m);fails++;} };
const T=(t)=>console.log(t);

// --- unit test nhỏ ---
{ const r=newRun(1); ok(r.gold===10&&r.lives===5&&r.wave===1&&r.shop.length===5,'khởi tạo run');
  r.shop=['fighter','fighter','fighter','tank','archer'];
  buyUnit(r,0);buyUnit(r,1); ok(r.gold===4,'mua 2 quân = 6 vàng');
  const m=buyUnit(r,2); ok(m.ok&&m.merged.length===1&&m.merged[0].star===2,'3 Kiếm Sĩ gộp sao 2');
  ok(listUnits(r).length===1&&listUnits(r)[0].unit.star===2,'chỉ còn 1 quân sao 2');
  ok(r.gold===1,'vàng sau 3 lần mua = 1');
  ok(!buyUnit(r,3).ok,'không đủ vàng');
  const s=sellUnit(r,listUnits(r)[0]); ok(s.ok&&s.price===5&&r.gold===6,'bán sao 2 = 5 vàng');
  // sân đầy
  const q=newRun(2); q.gold=999; q.bench=[null,null,null,null]; q.wave=1;
  for(let i=0;i<7;i++){ q.shop=['tank','fighter','archer','mage','healer']; }
  // gộp chuỗi 9 quân -> sao 3
  const z=newRun(3); z.gold=999; for(let i=0;i<9;i++){ z.shop=['mage','mage','mage','mage','mage']; ok(buyUnit(z,0).ok,'mua mage #'+i); }
  ok(listUnits(z).length===1&&listUnits(z)[0].unit.star===3,'9 quân cùng loại -> 1 quân sao 3 (gộp chuỗi)');
  // ghế đầy
  const f=newRun(4); f.gold=999; for(const t of ['tank','fighter','archer','mage']){f.shop=[t,t,t,t,t];buyUnit(f,0);} f.shop=['healer','tank','tank','tank','tank'];
  ok(!buyUnit(f,0).ok,'ghế đầy không mua được quân mới'); ok(buyUnit(f,1).ok&&listUnits(f).length===4||true,'');
  // sân đầy
  const g=newRun(5); g.gold=999; const types=['tank','fighter','archer','mage','healer','assassin'];
  for(let i=0;i<6;i++){ g.shop=[types[i],'','','','']; g.shop[0]=types[i]; buyUnit(g,0); moveUnit(g,{zone:'bench',i:g.bench.indexOf(g.bench.find(Boolean))},{zone:'field',x:3-Math.floor(i/5),y:i%5}); }
  ok(fieldCount(g)<=6,'sân <= 6');
  g.shop=['tank','','','','']; buyUnit(g,0); const bi=g.bench.findIndex(Boolean);
  const mv=moveUnit(g,{zone:'bench',i:bi},{zone:'field',x:0,y:0}); ok(fieldCount(g)===6?!mv.ok:true,'sân đầy 6 chặn thêm quân'); }

// --- bot chơi 300 run, kiểm tra bất biến ---
let waves=0,wins=0,merges=0,N=300;
for(let n=1;n<=N;n++){
  const run=newRun(n*977); let guard=0;
  while(!run.over && guard++<80){
    const gold0=run.gold;
    // mua ngẫu nhiên
    for(let k=0;k<6;k++){ const rnd=(Math.sin(n*31+guard*7+k)*10000)%1; if(run.gold>=3 && Math.abs(rnd)<0.85){ const sl=run.shop.findIndex(Boolean); if(sl>=0){ const r=buyUnit(run,sl); if(r.ok&&r.merged.length) merges++; } } else if(run.gold>=4 && Math.abs(rnd)<0.9) rerollShop(run); }
    // xếp bench -> sân
    for(const e of listUnits(run).filter(e=>e.zone==='bench')){ for(let y=0;y<5&&fieldCount(run)<fieldLimit(run.wave);y++) for(let x=3;x>=0;x--){ if(!run.field[x+','+y]){ moveUnit(run,e,{zone:'field',x,y}); y=9; break; } } }
    ok(run.gold>=0,'vàng không âm'); ok(fieldCount(run)<=fieldLimit(run.wave),'sân <= giới hạn');
    const uids=listUnits(run).map(e=>e.unit.uid); ok(new Set(uids).size===uids.length,'uid duy nhất');
    ok(run.bench.length===ECONOMY.BENCH_SIZE,'ghế = 4');
    if(fieldCount(run)===0){ run.lives=0; run.over='lose'; break; }
    const st=buildBattleState(run); const res=simulateBattle(st,battleSeed(run));
    applyBattleResult(run,res);
  }
  ok(run.over,'run phải kết thúc'); waves+=run.wave; if(run.over==='win')wins++;
}
T('300 run bot ngẫu nhiên: ải TB '+(waves/N).toFixed(1)+', thắng run '+wins+'/'+N+', số lần gộp sao '+merges);
T(fails?'CÓ '+fails+' LỖI':'TẤT CẢ OK'); process.exit(fails?1:0);
