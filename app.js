/* @台操盤 V6 · client-only viewer. No API keys, fetch(), or telemetry. */
'use strict';
const $ = id => document.getElementById(id);
const nfmt = new Intl.NumberFormat('zh-TW',{maximumFractionDigits:2});
const money = n => (n!==null && n!==undefined && String(n).trim()!=='' && Number.isFinite(Number(n))) ? ((Number(n)<0?'-':'')+'NT$'+nfmt.format(Math.abs(Number(n)))) : '未提供';
const num = x => {if(x===null||x===undefined||String(x).trim()==='')return null;let v=Number(String(x).replace(/[,％%NT$元\s]/g,''));return Number.isFinite(v)?v:null};
const esc = x => String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const goodText = x=>x===null||x===undefined||String(x).trim()===''?'未提供':String(x);
const benchmark = {capital:50000,percent:5};
const marketModules = [
 ['即時報價','未接富果即時行情'],['1 / 5 / 15 分K','需分時數據與時間戳'],['技術指標','待匯入 OHLCV 或現有模型'],
 ['VWAP / ORB','需要盤中K線與逐筆價量'],['籌碼／法人','需要官方盤後資料'],['逐筆主動買賣','只能估計買賣方向，不能識別法人'],
 ['融資融券 / 券源','需交易所與券商資料'],['美股 / 台指夜盤','尚未建立資料源'],['未來達標機率','尚未完成獨立樣本外校準']
];
let model = null;let priceBars = [];let priceSymbol = '2324';let currentView = 'overview';
const titles = {
 overview:['市場總覽','單一帳戶的績效、獲利目標與資料狀態。'],
 scanner:['策略選股','驗證期初篩與最新候選分開顯示，不把過去當成今天。'],
 goal:['獲利達標日期','真正追蹤整個帳戶何時首次達到扣成本後淨利目標。'],
 backtest:['歷史回測','逐筆檢查獨立樣本外交易、成本、勝率與未達標情形。'],
 risk:['風險與資金','先確認最多可能虧多少，再談目標獲利時間。'],
 data:['資料中心','從 GitHub Actions ZIP 直接匯入，所有資料留在本機瀏覽器。']
};
function safeDate(s){return /^\d{4}-\d{2}-\d{2}$/.test(String(s||''))?String(s):null}
function parseCsv(raw){
 let s=String(raw||'').replace(/^\ufeff/,'');let rows=[],row=[],cell='',quoted=false;
 for(let i=0;i<s.length;i++){
  let ch=s[i];if(ch==='"'){
   if(quoted&&s[i+1]==='"'){cell+='"';i++} else quoted=!quoted;
  } else if(ch===','&&!quoted){row.push(cell);cell=''}
  else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&s[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x!==''))rows.push(row);row=[];cell=''}
  else cell+=ch;
 }
 if(quoted)throw Error('CSV 雙引號未閉合');
 if(cell!==''||row.length){row.push(cell);if(row.some(x=>x!==''))rows.push(row)}
 if(!rows.length)return [];
 let head=rows.shift().map(x=>x.trim());
 return rows.slice(0,50000).map(r=>Object.fromEntries(head.map((key,i)=>[key,r[i]??''])));
}
function extractSummary(text){
 const find=(regexp)=>{let m=text.match(regexp);return m?m[1]:null};
 const asOf=find(/資料截至[：:]\s*(\d{4}-\d\d-\d\d)/);
 const period=find(/檢索區間[：:]\s*([^\n;；]+)/);
 const accountCapital=num(find(/帳戶本金[：:]\s*([\d,.]+)/));
 const profitTarget=num(find(/獲利目標[：:]\s*([\d,.]+)/));
 const goal=num(find(/達標總額[：:]\s*([\d,.]+)/));
 const requested=num(find(/股票要求[：:]\s*(\d+)檔/));
 const loaded=num(find(/成功[：:]\s*(\d+)檔/));
 const errors=num(find(/資料錯誤[：:]\s*(\d+)檔/));
 const selected=num(find(/驗證入選[：:]\s*(\d+)檔/));
 const actualTrades=num(find(/樣本外交易[：:]\s*(\d+)筆/));
 const ending=num(find(/期末已實現帳戶資金[：:]\s*([\d,.]+)/));
 const pnl=num(find(/已實現損益[：:]\s*([-\d,.]+)/));
 const dd=num(find(/估計最大回撤[：:]\s*([\d,.]+)/));
 const first=find(/歷史樣本外首次達成[\d,.]+元日期[：:]\s*(\d{4}-\d\d-\d\d)/);
 const latest=num(find(/最新進場候選[：:]\s*(\d+)檔/));
 return {asOf,period,capital:accountCapital,profitTarget,goal,requested,loaded,errors,selected,actualTrades,ending,pnl,dd,first,latest};
}
function normalizeZip({summary,trades,strategies,top,horizons,latest,errors,valuations,fileName}){
 const info=extractSummary(summary);
 const n=info.capital??50000;
 let equity=[];
 const cleanTrades=trades.map(r=>({
  ticker:r['股票'],rule:r['完整規則'],entry:safeDate(r['進場日']),exit:safeDate(r['出場日']),days:num(r['持有交易日']),
  buy:num(r['買進成交假設價']),sell:num(r['賣出成交假設價']),qty:num(r['股數']),
  pnl:num(r['交易淨損益元']),before:num(r['進場前帳戶元']),after:num(r['出場後帳戶元']),event:r['事件']
 })).filter(t=>t.entry&&t.exit&&t.pnl!==null).sort((a,b)=>a.exit.localeCompare(b.exit));
 if(cleanTrades.length){
  equity.push({date:cleanTrades[0].entry,equity:cleanTrades[0].before??n});
  for(const t of cleanTrades){if(t.after!==null)equity.push({date:t.exit,equity:t.after})}
 }
 if(!equity.length&&info.ending!==null&&info.ending!==undefined)equity=[{date:info.asOf??'',equity:info.ending}];
 let distinctErrors=[...new Set(errors.map(r=>r['股票']).filter(Boolean))];
 return {
  type:'v54-artifact',filename:fileName,summaryText:summary,
  info,capital:n,goal:info.goal??n+(info.profitTarget??n*.05),asOf:info.asOf,
  trades:cleanTrades,equity,strategies,top,horizons,latest,
  errorCount:info.errors??distinctErrors.length,errors:distinctErrors,
  valuations,
  importedAt:new Date().toISOString(),
  warning:'這是歷史回測報告，並非即時行情或未來獲利保證。'
 };
}
let zipLoadingPromise = null;
async function ensureZipLib(){
 if(typeof JSZip !== 'undefined')return;
 if(!zipLoadingPromise){
  zipLoadingPromise = new Promise((resolve,reject)=>{
   const script=document.createElement('script');
   script.src='https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
   script.onload=()=>typeof JSZip!=='undefined'?resolve():reject(Error('ZIP 元件載入失敗'));
   script.onerror=()=>reject(Error('ZIP 元件無法下載；請檢查網路連線'));
   document.head.appendChild(script);
  }).catch(err=>{zipLoadingPromise=null;throw err});
 }
 await zipLoadingPromise;
}
async function importArtifact(file){
 if(file.size>24*1024*1024)throw Error('檔案超過 24 MB，請分批匯入。');
 if(file.name.toLowerCase().endsWith('.json')){
  let parsed=JSON.parse(await file.text());
  if(parsed&&parsed.type==='v54-artifact'&&Array.isArray(parsed.trades)&&parsed.info){return parsed}
  throw Error('這個 JSON 不是完整 V6 報告格式。請匯入 V5.4 GitHub Actions ZIP。');
 }
 if(!file.name.toLowerCase().endsWith('.zip'))throw Error('請選擇 ZIP 或 V6 JSON 報告。');
 if(typeof JSZip==='undefined')await ensureZipLib();
 let zip=await JSZip.loadAsync(file,{checkCRC32:true});
 const get=async(prefix,max=12*1024*1024)=>{
  let entry=Object.values(zip.files).find(e=>!e.dir&&e.name.split('/').pop().startsWith(prefix));
  if(!entry)return '';
  // Reject suspiciously large expanded files based on ZIP metadata, then parse locally.
  if(entry._data&&entry._data.uncompressedSize>max)throw Error('報告解壓後太大，已停止匯入：'+prefix);
  let result=await entry.async('string');
  if(result.length>max)throw Error('檔案超過安全大小：'+prefix);
  return result;
 };
 const summary=await get('08_',300000);
 const trade=await get('03_');
 const strat=await get('01_');
 if(!summary||!strat)throw Error('ZIP 沒有 V5.4 的 01_全部候選策略 和 08_繁體中文摘要。');
 return normalizeZip({summary,trades:parseCsv(trade),strategies:parseCsv(strat),
  top:parseCsv(await get('02_')),horizons:parseCsv(await get('04_')),
  latest:parseCsv(await get('05_')),errors:parseCsv(await get('06_')),
  valuations:parseCsv(await get('07_')),fileName:file.name});
}
function currentScenario(){
 let capital=num($('settingCapital').value)??50000;
 let pct=num($('settingTarget').value)??5;
 if(capital<1000||capital>10000000||pct<.1||pct>100)return null;
 return {capital,pct,goal:capital*(1+pct/100),profit:capital*pct/100};
}
function scenarioMatches(){let s=currentScenario();return !!(s&&model&&Math.abs(s.capital-model.capital)<.01&&Math.abs(s.goal-model.goal)<.01)}
function reportFirstHit(){
 if(!model||!scenarioMatches())return null;
 let capital=model.capital,goal=model.goal;
 if(capital>=goal)return null;
 for(const point of model.equity){if(point.equity>=goal)return point.date||null}
 return null;
}
function calculateDrawdown(){
 if(!model||!model.equity.length)return null;
 let peak=model.capital,dd=0;
 for(let p of model.equity){if(p.equity>peak)peak=p.equity;dd=Math.max(dd,peak-p.equity)}
 return dd;
}
function setView(view){
 if(!titles[view])return;
 currentView=view;
 document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id==='view-'+view));
 document.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('selected',el.dataset.view===view));
 $('viewTitle').textContent=titles[view][0];$('viewDesc').textContent=titles[view][1];
 window.scrollTo({top:0,behavior:'instant'});
}
function makeEquitySvg(points,goal){
 if(points.length<2)return '';
 const W=760,H=238,left=57,right=16,top=16,bottom=34;
 let values=points.map(x=>x.equity);if(goal)values.push(goal);
 let low=Math.min(...values),high=Math.max(...values),span=high-low||1000;
 low-=span*.09;high+=span*.09;
 const px=i=>left+(W-left-right)*(i/(points.length-1));
 const py=v=>top+(H-top-bottom)*(1-(v-low)/(high-low));
 const coords=points.map((p,i)=>`${px(i).toFixed(1)},${py(p.equity).toFixed(1)}`).join(' ');
 const gy=py(goal);
 let grid='';for(let j=0;j<4;j++){let v=low+(high-low)*(j/3),y=py(v);grid+=`<line x1="${left}" x2="${W-right}" y1="${y}" y2="${y}" stroke="#26374c" stroke-width="1"/><text x="${left-8}" y="${y+4}" fill="#7892af" text-anchor="end" font-size="10">${Math.round(v/1000)}k</text>`}
 let labels=`<text x="${left}" y="${H-7}" font-size="10" fill="#849bb7">${esc(points[0].date)}</text><text x="${W-right}" y="${H-7}" text-anchor="end" font-size="10" fill="#849bb7">${esc(points[points.length-1].date)}</text>`;
 let circles=points.map((p,i)=>`<circle cx="${px(i)}" cy="${py(p.equity)}" r="3" fill="${p.equity>=goal?'#51ddba':'#5bafff'}"><title>${esc(p.date)} ${money(p.equity)}</title></circle>`).join('');
 return `<svg role="img" aria-label="歷史模擬帳戶資金走勢" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${grid}<line x1="${left}" x2="${W-right}" y1="${gy}" y2="${gy}" stroke="#51ddba" stroke-dasharray="6 5" stroke-width="1.6"/>${labels}<polyline points="${coords}" stroke="#61b9ff" stroke-linejoin="round" stroke-linecap="round" stroke-width="3" fill="none"/>${circles}<text x="${W-right-1}" y="${Math.max(12,gy-7)}" text-anchor="end" fill="#51ddba" font-size="10">目標 ${nfmt.format(goal)}</text></svg>`;
}
function setMoneyText(id, value, down=false){$(id).textContent=value;$(id).classList.toggle('down',!!down);$(id).classList.toggle('up',!down&&value.startsWith('+'))}
function renderOverview(){
 const cap=model?.capital??50000,goal=model?.goal??52500;
 $('mInitial').textContent=money(cap);$('mGoal').textContent=money(goal);
 let ending=model?.info.ending;
 $('mFinal').textContent=ending!==null&&ending!==undefined?money(ending):'尚無資料';
 let pnl=model?.info.pnl;
 setMoneyText('mPnl',pnl!==null&&pnl!==undefined?((pnl>0?'+':'')+money(pnl)+' 已實現損益'):'尚無可驗證績效',pnl<0);
 const hit=reportFirstHit();$('mDate').textContent=hit||'無法估計';
 $('mDateHint').textContent=hit?'歷史首次達標，非未來預測':(model?'樣本外尚未觀測到達標':'需匯入歷史交易路徑');
 if(model&&model.equity.length>1){$('equityChart').innerHTML=makeEquitySvg(model.equity,goal);$('equityTag').textContent='已實現資金路徑';}
 else{$('equityChart').innerHTML='<div class="empty"><div class="empty-icon">⌁</div>尚無可繪製的歷史帳戶交易資金路徑</div>';$('equityTag').textContent='等待交易紀錄'}
 const i=model?.info||{};
 let coverage=i.loaded!==null&&i.loaded!==undefined&&i.requested?i.loaded/i.requested:null;
 $('coverageValue').textContent=coverage!==null?`${(coverage*100).toFixed(1)}%`:'未提供';
 $('coverageBar').style.width=coverage!==null?`${Math.min(100,coverage*100)}%`:'0%';
 $('coverageNote').textContent=coverage!==null?`預計 ${i.requested} 檔，取得 ${i.loaded} 檔；資料失敗 ${i.errors??model.errorCount} 檔`:'目前沒有批次掃描紀錄';
 const count=model?.trades.length;
 $('tradesValue').textContent=count===undefined?'未提供':`${count} 筆`;
 const wins=model?.trades.filter(x=>x.pnl>0).length??0;
 $('tradesNote').textContent=count?`勝率 ${(wins/count*100).toFixed(1)}%，僅代表本次獨立樣本外樣本`:'還沒有完成交易';
 let dd=i.dd??calculateDrawdown();$('drawdownValue').textContent=dd!==null&&dd!==undefined?money(dd):'未提供';
 $('drawdownNote').textContent=dd!==null&&dd!==undefined?`相當本金 ${(dd/cap*100).toFixed(2)}%，未必涵蓋盤中最大虧損`:'非完整盤中最大回撤';
 $('decisionTag').textContent=model?.latest?.length?'研究候選（待驗證）':'無可發布訊號';
 let latest=model?.latest??[];
 $('decisionBody').innerHTML=latest.length?latest.slice(0,4).map(x=>`<div class="item"><div class="title">${esc(x['股票'])} ${esc(x['進場型態']??'研究候選')}<span class="chip">待驗證</span></div><p>${esc(x['原因']??'尚未核實即時報價與成交條件')}</p></div>`).join(''):'<div class="empty">沒有通過驗證的最新進場訊號。請勿把歷史研究候選直接當成買進建議。</div>';
 const mods=[['完整行情','缺少即時 / 分K'],['樣本外驗證',count>=30?'已累積至少 30 筆交易':`只有 ${count??0} 筆，樣本不足`],['獲利目標',hit?'歷史上曾達標':'尚未觀測到達標'],['未來日期模型','尚無可發布的校準預測']];
 $('healthChecks').innerHTML=mods.map(([k,v],ix)=>`<div class="item"><div class="title">${esc(k)}<span class="chip ${ix===2&&hit?'good':'muted'}">${ix===2&&hit?'已觀測':'待確認'}</span></div><p>${esc(v)}</p></div>`).join('');
}
function sortStrategyRows(rows){
 let sort=$('strategySort').value;
 const key=sort==='pnl'?'驗證總淨損益元':sort==='trades'?'驗證筆數':'驗證研究得分';
 return [...rows].sort((a,b)=>(num(b[key])??-Infinity)-(num(a[key])??-Infinity));
}
function renderScanner(){
 const all=model?.strategies??[];
 const q=$('strategySearch').value.trim().toLowerCase();
 const filter=$('strategyFilter').value;
 const filtered=sortStrategyRows(all.filter(r=>{
  let text=[r['股票'],r['進場策略'],r['停損規則']].join(' ').toLowerCase();
  if(q&&!text.includes(q))return false;
  if(filter==='passing'&&r['研究門檻通過']!=='是')return false;
  if(filter==='positive'&&(num(r['驗證總淨損益元'])??0)<=0)return false;
  return true;
 }));
 $('scannerCount').textContent=all.length?`${filtered.length}/${all.length} 組`:'0 組';
 const rows=filtered.slice(0,60);
 $('strategyTable').innerHTML=rows.length?`<table><thead><tr><th>股票</th><th>進場型態</th><th>停損 / 停利</th><th class="t-right">驗證筆數</th><th class="t-right">驗證淨損益</th><th class="t-right">勝率</th><th>研究門檻</th></tr></thead><tbody>${rows.map(r=>{let pnl=num(r['驗證總淨損益元']);return `<tr><td><strong>${esc(r['股票'])}</strong></td><td>${esc(r['進場策略'])}</td><td>${esc(r['停損規則'])} / ${esc(r['獎酬倍數R'])}R</td><td class="t-right">${esc(r['驗證筆數'])}</td><td class="t-right ${pnl>0?'t-green':pnl<0?'t-red':''}">${pnl===null?'—':money(pnl)}</td><td class="t-right">${esc(r['驗證勝率%'])}%</td><td>${r['研究門檻通過']==='是'?'<span class="chip good">初篩通過</span>':'<span class="chip muted">未通過</span>'}</td></tr>`}).join('')}</tbody></table>`:'<div class="empty">目前沒有符合條件的研究策略</div>';
 $('strategyFooter').textContent=`本次顯示前 ${rows.length} 組；相似參數可能重複，不能當成獨立成功案例。`;
 $('latestSignals').innerHTML=model?.latest.length?model.latest.map(x=>`<div class="item"><div class="title">${esc(x['股票'])} · ${esc(x['進場型態'])}<span class="chip">非即時交易訊號</span></div><p>參考價 ${esc(x['假設買入價（非實際成交）']??'未提供')}；原因：${esc(x['原因']??'資料不足')}</p></div>`).join(''):'<div class="empty">目前沒有可信的最新進場候選</div>';
}
function renderGoal(){
 const s=currentScenario();if(!s)return;
 $('goalAmount').textContent=money(s.goal);$('goalProfit').textContent=money(s.profit);
 $('mGoal').textContent=money(model?.goal??s.goal);
 const matching=scenarioMatches(),hit=reportFirstHit();
 $('scenarioWarning').textContent=!model?'尚未匯入回測。調整本金與目標只是試算，不能產生獲利日期。':(matching?'目前設定與報告一致，可閱讀這份歷史績效；日期仍不是未來保證。':'目前設定與歷史回測的本金／目標不同，不能把舊報告當作這組條件的實際績效。請重新執行回測。');
 $('goalFirst').textContent=matching?(hit?hit+'（歷史）':'樣本外未達標'):'尚無可用回測';
 $('goalSummary').textContent=matching?(hit?'此日為匯入交易紀錄中首次達到帳戶目標的歷史日，不是預測未來日期。':'截至目前回測資料，沒有觀測到帳戶達標。這不代表未來達標機率為零。'):'必須使用相同本金與目標比例的回測結果才能比較。';
 const c=model?.trades.length??0;
 const checklist=[['資料條件',model?'已匯入 '+goodText(model.asOf)+' 的歷史回測':'未匯入'],['可用交易筆數',`${c} 筆${c<30?'，不足 30 筆':'，仍需跨期間檢查'}`],['獲利日期估計', '沒有經獨立校準的未來機率預測，不發布單一預測日期']];
 $('goalCriteria').innerHTML=checklist.map(([a,b])=>`<div class="item"><div class="title">${esc(a)}</div><p>${esc(b)}</p></div>`).join('');
 const horizons=model?.horizons??[];
 $('horizonTable').innerHTML=horizons.length?`<table><thead><tr><th>期限交易日</th><th class="t-right">歷史獨立區塊</th><th class="t-right">歷史達標區塊</th><th class="t-right">歷史觀測頻率</th><th>是否可發布</th><th>未來達標機率</th></tr></thead><tbody>${horizons.map(r=>`<tr><td>${esc(r['期限交易日'])}</td><td class="t-right">${esc(r['獨立觀測區塊數'])}</td><td class="t-right">${esc(r['歷史達標區塊數'])}</td><td class="t-right">${esc(r['觀測達標頻率%'])}%</td><td>${r['可發布歷史頻率']==='是'?'<span class="chip good">歷史觀測可引用</span>':'<span class="chip bad">樣本不足／不可發布</span>'}</td><td>無法可靠估計</td></tr>`).join('')}</tbody></table>`:'<div class="empty">尚無期限觀測資料。需要多個獨立樣本外帳戶路徑，才可估計不同持有期限的達標機率。</div>';
}
function renderBacktest(){
 let trades=model?.trades??[],strats=model?.strategies??[];
 $('btStrategies').textContent=strats.length?nfmt.format(strats.length):'—';
 $('btPositive').textContent=strats.length?String(strats.filter(r=>(num(r['驗證總淨損益元'])??0)>0).length):'—';
 $('btTrades').textContent=model?String(trades.length):'—';
 const pnl=model?.info.pnl;$('btPnl').textContent=pnl===null||pnl===undefined?'—':money(pnl);$('btPnl').classList.toggle('down',pnl<0);
 $('tradeTable').innerHTML=trades.length?`<table><thead><tr><th>股票</th><th>進場日</th><th>出場日</th><th>持有日</th><th>事件</th><th class="t-right">股數</th><th class="t-right">買進／賣出</th><th class="t-right">淨損益</th><th class="t-right">出場帳戶</th></tr></thead><tbody>${trades.map(t=>`<tr><td>${esc(t.ticker)}</td><td>${esc(t.entry)}</td><td>${esc(t.exit)}</td><td>${esc(t.days)}</td><td>${esc(t.event)}</td><td class="t-right">${esc(t.qty)}</td><td class="t-right">${esc(t.buy)} / ${esc(t.sell)}</td><td class="t-right ${t.pnl>=0?'t-green':'t-red'}">${money(t.pnl)}</td><td class="t-right">${money(t.after)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">沒有獨立樣本外交易。這不等於策略穩定獲利，也不能計算真實勝率。</div>';
 const known=[
 ['資料廣度',model?`掃描 ${model.info.requested??'?'} 檔，成功 ${model.info.loaded??'?'} 檔，失敗 ${model.info.errors??model.errorCount} 檔`:'尚無資料'],
 ['樣本外交易數',trades.length>=30?`已有 ${trades.length} 筆，仍要檢查統計穩定性`:`只有 ${trades.length} 筆，無法證明正期望值`],
 ['手續費、稅與滑價','以原始回測報表的假設為準，尚未核對實際券商成交'],
 ['回測盲點','未完整還原除權息、停牌、漲跌停成交、當日高低價先後與當沖分K'],
 ['批次比較','每批五萬元為獨立研究情境，不可把多批獲利加總成同一帳戶']
 ];
 $('backtestWarnings').innerHTML=known.map(([a,b])=>`<div class="item"><div class="title">${esc(a)}</div><p>${esc(b)}</p></div>`).join('');
}
function renderRisk(){
 const s=currentScenario();if(!s)return;
 const riskPct=num($('riskPct').value)??1,ddPct=num($('maxDDPct').value)??5;
 $('riskBudget').textContent=money(s.capital*riskPct/100);$('riskDrawdown').textContent=money(s.capital*ddPct/100);
 const d=model?.info?.dd??null;const p=model?.info?.pnl??null;
 const rows=[['歷史已實現淨損益',p!==null?money(p):'未提供'],['回測報告最大回撤',d!==null?`${money(d)}（${(d/(model.capital||1)*100).toFixed(2)}%）`:'未提供'],['是否超過目前警戒',d!==null?(d>s.capital*ddPct/100?'是，僅供風險警示':'否（按此設定比較）'):'無法判斷'],['重要注意','這是歷史估計值，尚非完整逐日／盤中真實資產淨值']];
 $('riskObservations').innerHTML=rows.map(([a,b])=>`<div class="item"><div class="title">${esc(a)}</div><p>${esc(b)}</p></div>`).join('');
 $('modules').innerHTML=marketModules.map(([a,b])=>`<div class="module"><strong>${esc(a)}</strong><small>${esc(b)}</small><em>尚待接入／核對</em></div>`).join('');
}
function renderData(){
 const info=model?.info??{};
 $('importStatus').textContent=model?`已在本機開啟 ${model.filename}；資料截至 ${model.asOf??'未提供'}。沒有將 ZIP 上傳至任何外部伺服器。`:'尚未匯入任何檔案。';
 const rows=[['來源',model?'本機匯入 '+model.filename:'尚無來源'],['歷史期間',model?goodText(info.period):'未提供'],['行情截止日期',model?goodText(model.asOf):'未提供'],['研究本金／目標',model?`${money(model.capital)} / ${money(model.goal)}`:'未提供'],['資料讀取',model?`${info.loaded??'?'} / ${info.requested??'?'} 檔，失敗 ${info.errors??model.errorCount}`:'未提供'],['策略組合',model?`${model.strategies.length} 組`:'未提供'],['資料安全','ZIP 在瀏覽器本地解壓、解析，不將 API Key 放在前端'],['即時行情','尚未連接；不應把報告截止日當成即時時間']];
 $('dataDetails').innerHTML=rows.map(([a,b])=>`<div class="item"><div class="title">${esc(a)}</div><p>${esc(b)}</p></div>`).join('');
}
function renderHeader(){
 $('statusText').textContent=model?`歷史回測・${model.asOf??'日期不明'}`:'尚未載入回測';
 $('statusDot').className=model?'dot caution':'dot';
 $('sideStatus').textContent=model?'已載入歷史回測':'等待匯入報告';
 $('footerTime').textContent=model?`最後資料 ${goodText(model.asOf)}`:'等待資料';
 const notice=model?`資料來源：${model.filename}；歷史行情截至 ${model.asOf??'未知'}。本頁不是即時行情。${model.info.errors?`有 ${model.info.errors} 檔資料讀取失敗。`:''}未來獲利日期目前沒有足夠校準證據。`:'目前尚未匯入回測資料。請到「資料中心」匯入 GitHub Actions ZIP；未驗證績效與日期不顯示為真實結果。';
 $('notice').textContent=notice;
 $('notice').className=model?'notice good':'notice';
}
function render(){renderHeader();renderOverview();renderScanner();renderGoal();renderBacktest();renderRisk();renderData();renderPrice()}
function drawPriceChart(data){
 let bars=data.slice(-65);if(bars.length<2)return '';
 const W=760,H=255,left=49,right=15,top=14,heightPrice=164,volTop=196,volHeight=38;
 const high=Math.max(...bars.map(x=>x.high)),low=Math.min(...bars.map(x=>x.low));
 const min=low-(high-low)*.07,max=high+(high-low)*.07;
 const x=i=>left+(W-left-right)*(i+.5)/bars.length;
 const y=p=>top+(heightPrice)*(max-p)/(max-min||1);
 const vmax=Math.max(1,...bars.map(r=>r.volume||0));
 let out=`<svg role="img" aria-label="日K和成交量圖" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">`;
 for(let i=0;i<4;i++){let v=min+(max-min)*i/3,yy=y(v);out+=`<line x1="${left}" x2="${W-right}" y1="${yy}" y2="${yy}" stroke="#283950"/><text x="${left-6}" y="${yy+4}" fill="#809ab8" font-size="10" text-anchor="end">${v.toFixed(1)}</text>`}
 const barWidth=Math.max(2,Math.min(10,(W-left-right)/bars.length*.60));
 bars.forEach((r,i)=>{
  let xx=x(i),color=r.close>=r.open?'#f27081':'#52c7af',cy1=y(r.open),cy2=y(r.close),body=Math.max(1.2,Math.abs(cy2-cy1));
  out+=`<line x1="${xx}" x2="${xx}" y1="${y(r.high)}" y2="${y(r.low)}" stroke="${color}" stroke-width="1.3"/>`;
  out+=`<rect x="${xx-barWidth/2}" y="${Math.min(cy1,cy2)}" width="${barWidth}" height="${body}" fill="${color}"/>`;
  out+=`<rect x="${xx-barWidth/2}" y="${volTop+volHeight*(1-(r.volume||0)/vmax)}" width="${barWidth}" height="${Math.max(1,volHeight*(r.volume||0)/vmax)}" fill="${color}" opacity=".64"/>`;
 });
 function ma(n,color){let pts=[];for(let i=0;i<bars.length;i++){if(i+1<n)continue;let avg=bars.slice(i+1-n,i+1).reduce((a,b)=>a+b.close,0)/n;pts.push(`${x(i)},${y(avg)}`)}if(pts.length>1)out+=`<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.7" opacity=".9"/>`}
 ma(5,'#ebbc69');ma(20,'#6bb4ff');ma(60,'#bb8cfa');
 out+=`<text x="${left}" y="${H-3}" fill="#7892af" font-size="10">${esc(bars[0].date)}</text><text x="${W-right}" y="${H-3}" text-anchor="end" fill="#7892af" font-size="10">${esc(bars[bars.length-1].date)}</text></svg>`;
 return out;
}
function renderPrice(){
 if(!priceBars.length){$('klineTag').textContent='尚未載入 K 線';$('klineChart').innerHTML='<div class="empty">尚無日 K 資料。請從本機匯入含日期、開高低收及成交量的 CSV。</div>';return}
 $('klineTag').textContent=`${priceSymbol} · ${priceBars[priceBars.length-1].date} 歷史`; $('klineChart').innerHTML=drawPriceChart(priceBars);
}
function importPriceCsv(text,name){
 const rows=parseCsv(text);
 const val=(r,names)=>{for(let k of names){if(r[k]!==undefined&&r[k]!=='')return r[k]}return null};
 const bars=[];
 for(let r of rows){let raw=val(r,['date','Date','日期','time','Time','timestamp','datetime']);
  let date=raw?String(raw).slice(0,10).replaceAll('/','-'):null;
  if(!safeDate(date))continue;
  let open=num(val(r,['open','Open','開盤價','開盤'])),high=num(val(r,['high','High','最高價','最高'])),low=num(val(r,['low','Low','最低價','最低'])),close=num(val(r,['close','Close','收盤價','收盤']));
  let volume=num(val(r,['volume','Volume','成交量','成交股數']))??0;
  if([open,high,low,close].some(x=>x===null)||low<=0||high<Math.max(open,close)||low>Math.min(open,close))continue;
  bars.push({date,open,high,low,close,volume});
 }
 bars.sort((a,b)=>a.date.localeCompare(b.date));
 priceBars=bars.filter((b,i)=>i===0||b.date!==bars[i-1].date).slice(-300);
 if(priceBars.length<2)throw Error('日 K 有效筆數不足，請提供含日期、open、high、low、close、volume 的 CSV');
 const guessed=name.match(/\b(\d{4}[A-Z]?)\b/);if(guessed)priceSymbol=guessed[1];
 $('chartSymbol').value=priceSymbol;
}
/* V6 本機自動還原：資料只存在此裝置的網站 IndexedDB，不進入公開 GitHub。 */
const V6_LOCAL_DB='taicaopan_v6_local_reports_v1';
const V6_LOCAL_TABLE='reports';
const V6_LOCAL_KEY='most_recent';
function openV6LocalDb(){
 return new Promise((resolve,reject)=>{
  if(!('indexedDB' in window)){reject(Error('此瀏覽器不支援本機儲存'));return}
  const req=indexedDB.open(V6_LOCAL_DB,1);
  req.onupgradeneeded=()=>{
   const db=req.result;
   if(!db.objectStoreNames.contains(V6_LOCAL_TABLE))db.createObjectStore(V6_LOCAL_TABLE);
  };
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error||Error('無法開啟本機資料庫'));
  req.onblocked=()=>reject(Error('本機資料庫正在其他頁面使用'));
 });
}
async function v6LocalOperation(mode,value){
 const db=await openV6LocalDb();
 try{
  return await new Promise((resolve,reject)=>{
   const tx=db.transaction(V6_LOCAL_TABLE,mode==='read'?'readonly':'readwrite');
   const store=tx.objectStore(V6_LOCAL_TABLE);
   let req;
   if(mode==='read')req=store.get(V6_LOCAL_KEY);
   else if(mode==='save')req=store.put(value,V6_LOCAL_KEY);
   else req=store.delete(V6_LOCAL_KEY);
   let result=null;
   req.onsuccess=()=>{result=req.result};
   req.onerror=()=>reject(req.error||Error('無法操作本機資料'));
   tx.oncomplete=()=>resolve(result);
   tx.onerror=()=>reject(tx.error||Error('本機資料庫交易失敗'));
   tx.onabort=()=>reject(tx.error||Error('本機資料庫交易已取消'));
  });
 }finally{db.close()}
}
function useV6Report(report){
 model=report;
 benchmark.capital=report.capital;
 benchmark.percent=(report.goal/report.capital-1)*100;
 $('settingCapital').value=report.capital;
 $('settingTarget').value=String(benchmark.percent.toFixed(4));
 render();
}
async function restoreV6LocalReport(){
 try{
  const saved=await v6LocalOperation('read');
  if(!saved)return;
  if(saved.type!=='v54-artifact'||!saved.info||!Array.isArray(saved.trades)||!Array.isArray(saved.strategies))return;
  if(!Number.isFinite(saved.capital)||!Number.isFinite(saved.goal)||saved.capital<=0)return;
  if(model)return; // 不覆蓋使用者這次已經手動匯入的新報告。
  useV6Report(saved);
  $('importStatus').textContent=`已從這支裝置的本機儲存自動還原：${saved.filename||'V5.4報告'}；資料截至 ${saved.asOf||'未提供'}。新回測仍需手動匯入。`;
  toast('已自動還原本機 V5.4 歷史回測');
 }catch(err){
  console.warn('V6 本機報告還原失敗（可繼續手動匯入）',err);
 }
}
function makeSummary(){
 const s=currentScenario();if(!model)return '台操盤 V6：尚未匯入回測報告。';
 const i=model.info;
 return `@台操盤 V6｜繁體中文歷史研究摘要\n資料來源：${model.filename}\n資料截至：${model.asOf||'未提供'}\n回測本金：${money(model.capital)}\n回測目標：${money(model.goal)}\n本次選擇的試算本金：${money(s.capital)}；目標：${money(s.goal)}\n注意：情境更改不會重算原始績效。\n獨立樣本外交易：${model.trades.length} 筆\n實現淨損益：${i.pnl===null?'未提供':money(i.pnl)}\n期末帳戶：${i.ending===null?'未提供':money(i.ending)}\n已觀測首次達標：${reportFirstHit()||'未觀測到／無法可靠估計'}\n資料掃描：${i.loaded??'?'} / ${i.requested??'?'} 檔\n資料失敗：${i.errors??model.errorCount} 檔\n研究策略組合：${model.strategies.length}\n最新研究訊號：${model.latest.length} 檔\n風險注意：無經校準的未來達標日期模型。歷史績效不代表未來獲利。\n`;
}
function downloadText(text,name,mime){let blob=new Blob([text],{type:mime});let link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),5000)}
function toast(text){const p=document.createElement('div');p.className='toast';p.setAttribute('role','status');p.textContent=text;document.body.appendChild(p);setTimeout(()=>p.remove(),4000)}
async function onReport(file){
 if(!file)return;
 try{
  $('importStatus').textContent='正在本機解壓並解析：'+file.name;
  let parsed=await importArtifact(file);
  useV6Report(parsed);
  setView('overview');
  try{
   await v6LocalOperation('save',parsed);
   $('importStatus').textContent=`已匯入並保存在本機：${file.name}。下次以同一個 iPhone 網站入口開啟時會自動還原。`;
   toast('已匯入且保存在這支裝置：'+file.name);
  }catch(saveErr){
   $('importStatus').textContent=`已匯入 ${file.name}，但無法保存在本機：${saveErr.message}。下次可能需要重新匯入。`;
   toast('已匯入，但本機保存失敗');
  }
 }catch(e){$('importStatus').textContent='匯入失敗：'+e.message;toast('無法匯入：'+e.message);}
}
for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>setView(button.dataset.view));
$('headerImport').addEventListener('click',()=>{$('artifactFile').value='';setView('data');$('artifactFile').click()});
$('artifactFile').addEventListener('change',e=>onReport(e.target.files[0]));
$('priceFile').addEventListener('change',async e=>{let f=e.target.files[0];if(!f)return;try{if(f.size>5*1024*1024)throw Error('K 線 CSV 超過 5MB');importPriceCsv(await f.text(),f.name);renderPrice();toast(`載入 ${priceBars.length} 根歷史日 K`)}catch(err){toast('K 線匯入失敗：'+err.message)}});
$('chartSymbol').addEventListener('change',e=>{priceSymbol=e.target.value.trim()||priceSymbol;renderPrice()});
for(const key of ['strategySearch','strategySort','strategyFilter'])$(key).addEventListener(key==='strategySearch'?'input':'change',renderScanner);
for(const key of ['settingCapital','settingTarget'])$(key).addEventListener('input',()=>{let s=currentScenario();if(s){renderGoal();renderRisk()}else toast('本金或獲利目標超出設定範圍')});
for(const key of ['riskPct','maxDDPct'])$(key).addEventListener('input',renderRisk);
$('clearData').addEventListener('click',async ()=>{
 try{await v6LocalOperation('clear')}catch(err){toast('本機資料清除失敗：'+err.message);return}
 model=null;priceBars=[];render();toast('已清除本機儲存的回測資料');
});
$('exportSummary').addEventListener('click',()=>downloadText(makeSummary(),'台操盤V6_繁體中文分析摘要.txt','text/plain;charset=utf-8'));
render();
restoreV6LocalReport();
