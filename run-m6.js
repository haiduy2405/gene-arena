// Test M6: auto-playtest + save/load.   node run-m6.js
const fs=require('fs'),vm=require('vm'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'data.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'game.js'),'utf8');
vm.runInThisContext(src+'\n;globalThis.G={newRun,buyUnit,listUnits,moveUnit,buildBattleState,battleSeed,applyBattleResult,simulateBattle,autoPlaytest,botPlayRun,newPlaytestAcc,serializeRun,parseRun,hashEvents,GENES,ECONOMY};','bundle.js');
const g=G; let fails=0; const ok=(c,m)=>{ if(!c){fails++;console.log('FAIL '+m);} };
// save/load round-trip + tiếp tục y hệt
{ const a=g.newRun(42); a.gold=50; for(let i=0;i<3;i++){ a.shop=['tank','mage','tank','tank','mage']; g.buyUnit(a,0);} const e=g.listUnits(a)[0]; g.moveUnit(a,e,{zone:'field',x:3,y:2});
  const b=g.parseRun(g.serializeRun(a)); ok(b&&JSON.stringify(b)===JSON.stringify(a),'round-trip run');
  const ra=g.simulateBattle(g.buildBattleState(a),g.battleSeed(a)), rb=g.simulateBattle(g.buildBattleState(b),g.battleSeed(b)); ok(g.hashEvents(ra)===g.hashEvents(rb),'nạp lại => trận y hệt');
  g.applyBattleResult(a,ra); g.applyBattleResult(b,rb); ok(JSON.stringify(a)===JSON.stringify(b),'sau trận 2 nhánh vẫn y hệt (RNG run khôi phục đúng)'); }
ok(g.parseRun('rác')===null&&g.parseRun('{}')===null&&g.parseRun(JSON.stringify({v:99,run:{}}))===null,'save hỏng bị từ chối');
{ const a=g.newRun(1); a.over='lose'; ok(g.parseRun(g.serializeRun(a))===null,'run đã kết thúc không nạp'); const c=JSON.parse(g.serializeRun(g.newRun(1))); c.run.bench[0]={type:'xxx',star:1,genes:[],shards:[]}; ok(g.parseRun(JSON.stringify(c))===null,'quân lạ bị từ chối'); }
// playtest xác định + thống kê khớp
{ const t0=Date.now(); let r1,r2; g.autoPlaytest(100,1000,null,a=>r1=a); const dt=Date.now()-t0;
  // setTimeout bất đồng bộ -> đợi
  setTimeout(()=>{ g.autoPlaytest(100,1000,null,a=>{ r2=a;
    ok(JSON.stringify(r1)===JSON.stringify(r2),'playtest deterministic theo baseSeed');
    ok(r1.runs===100,'đủ 100 run'); ok(Object.values(r1.endWave).reduce((x,y)=>x+y,0)===100,'endWave cộng đủ 100');
    let f=0,w=0; for(const k in r1.waves){ f+=r1.waves[k].fights; w+=r1.waves[k].wins; ok(r1.waves[k].wins<=r1.waves[k].fights,'wave '+k); }
    let uf=0; for(const t in r1.units) uf+=r1.units[t].fights; ok(uf>=f,'unit fights >= wave fights');
    ok(r1.waves[1].runsReached===100,'ải 1: 100 run');
    const W=r1.waves; console.log('100 run bot: thắng run '+r1.wins+', ải kết thúc TB '+(Object.entries(r1.endWave).reduce((s,[k,v])=>s+k*v,0)/100).toFixed(1)+', số trận '+f+', nhiệm vụ đạt '+(r1.objDone/r1.objN*100).toFixed(0)+'%, chợ đen mua '+r1.marketBuys+'/'+r1.marketSeen);
    for(const k of [1,3,5,7,10,15]) console.log('  ải '+k+': đến '+W[k].runsReached+' run, thắng '+(W[k].fights?(W[k].wins/W[k].fights*100).toFixed(0):'-')+'%');
    console.log(fails?'CÓ '+fails+' LỖI':'TẤT CẢ OK'); process.exit(fails?1:0); }); },0); }
