const CONFIG = {
  // Khi Google Sheet đã public, thay null bằng link CSV export bên dưới:
  // 'https://docs.google.com/spreadsheets/d/1gAr4O_sTA6L68ThUHqcrmiruMe2aP_Oh39khKwVcOt8/export?format=csv&gid=1116776327'
  googleSheetCsvUrl: null,
  localCsvUrl: './data/transactions.csv',
  totalExpenseBudget: 19_000_000,
  categoryBudgets: { Meal: 4_000_000, Unexpected: 1_000_000 },
  allocations: [
    ['Investment', 15, '#D9ED92'], ['Kids', 10, '#B5E48C'],
    ['Education', 25, '#99D98C'], ['Emergency', 20, '#52B69A'],
    ['Saving', 30, '#168AAD']
  ]
};
const COLORS=['#D9ED92','#B5E48C','#99D98C','#76C893','#52B69A','#34A0A4','#168AAD','#1A759F','#1E6091','#184E77'];
let rows=[], charts={}, selectedMonth='all';
const $=s=>document.querySelector(s);
const money=n=>new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(Number(n)||0);
const num=v=>Number(String(v??'').replace(/[^0-9.-]/g,''))||0;
const clean=v=>String(v??'').trim();
const normalizeCategory=v=>{const x=clean(v).toLowerCase();if(x==='fix'||x==='fixed')return'Fixed';if(x==='meal')return'Meal';if(x==='unexpected')return'Unexpected';return clean(v)||'Other'};
function monthLabel(m){const s=clean(m);const mt=s.match(/A?(\d{2})(\d{2})/i);return mt?`T${Number(mt[2])}/${2000+Number(mt[1])}`:s}
function dateValue(v){const d=new Date(v);return isNaN(d)?0:d.getTime()}
function parseRows(raw){
  const lines=Papa.parse(raw,{skipEmptyLines:false}).data;
  const headerIndex=lines.findIndex(r=>r.some(c=>clean(c).toLowerCase()==='month')&&r.some(c=>clean(c).toLowerCase()==='amount'));
  if(headerIndex<0)throw new Error('Không tìm thấy dòng tiêu đề có Month và Amount.');
  const headers=lines[headerIndex].map(c=>clean(c));
  return lines.slice(headerIndex+1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,clean(r[i])]))).filter(r=>r.Month||r.Date||r.Type||r.Amount).map(r=>({
    month:r.Month,date:r.Date,actual:r.Actual,type:clean(r.Type),category:normalizeCategory(r.Category),item:clean(r.Items),amount:num(r.Amount),description:clean(r.Description)
  })).filter(r=>r.amount!==0||r.item||r.description);
}
async function loadData(){
  $('#loading').classList.remove('hidden');$('#error').classList.add('hidden');
  try{const url=CONFIG.googleSheetCsvUrl||CONFIG.localCsvUrl;const res=await fetch(url,{cache:'no-store'});if(!res.ok)throw new Error(`Không tải được CSV (${res.status})`);rows=parseRows(await res.text());setupMonths();renderAll();}
  catch(e){$('#error').textContent=e.message;$('#error').classList.remove('hidden');}
  finally{$('#loading').classList.add('hidden')}
}
function setupMonths(){const months=[...new Set(rows.map(r=>r.month).filter(Boolean))].sort();$('#monthFilter').innerHTML='<option value="all">Tất cả tháng</option>'+months.map(m=>`<option value="${m}">${monthLabel(m)}</option>`).join('');selectedMonth=months.at(-1)||'all';$('#monthFilter').value=selectedMonth}
const filtered=()=>selectedMonth==='all'?rows:rows.filter(r=>r.month===selectedMonth);
const sum=(arr,pred=()=>true)=>arr.filter(pred).reduce((a,r)=>a+r.amount,0);
function monthlyStats(){const map={};rows.forEach(r=>{if(!r.month)return;map[r.month]??={income:0,expense:0,albert:0,annie:0};if(r.type.toLowerCase()==='income'){map[r.month].income+=r.amount;const who=(r.item+' '+r.description).toLowerCase();if(who.includes('albert'))map[r.month].albert+=r.amount;else if(who.includes('annie'))map[r.month].annie+=r.amount}else if(r.type.toLowerCase()==='expense')map[r.month].expense+=r.amount});return map}
function destroy(name){if(charts[name])charts[name].destroy()}
function renderAll(){renderDashboard();renderExpenses();renderSavings();renderTransactions()}
function renderDashboard(){const data=filtered(),income=sum(data,r=>r.type.toLowerCase()==='income'),expense=sum(data,r=>r.type.toLowerCase()==='expense'),net=income-expense,used=expense/CONFIG.totalExpenseBudget*100;
  $('#kpiIncome').textContent=money(income);$('#kpiExpense').textContent=money(expense);$('#kpiNet').textContent=money(net);$('#kpiNet').className=net<0?'negative':'positive';$('#savingRate').textContent=income?`${Math.round(net/income*100)}% thu nhập`:'Không có thu nhập';$('#kpiRemaining').textContent=money(CONFIG.totalExpenseBudget-expense);$('#budgetStatus').textContent=`${Math.round(used)}% đã sử dụng`;
  const ms=monthlyStats(),months=Object.keys(ms).sort();destroy('income');charts.income=new Chart($('#incomeChart'),{type:'bar',data:{labels:months.map(monthLabel),datasets:[{label:'Albert',data:months.map(m=>ms[m].albert),backgroundColor:'#168AAD',borderRadius:6},{label:'Annie',data:months.map(m=>ms[m].annie),backgroundColor:'#34A0A4',borderRadius:6}]},options:chartOptions(true)});
  const exp=data.filter(r=>r.type.toLowerCase()==='expense'),cats=group(exp,'category');destroy('category');charts.category=new Chart($('#categoryChart'),{type:'doughnut',data:{labels:Object.keys(cats),datasets:[{data:Object.values(cats),backgroundColor:COLORS,borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}}}});
  renderBudget(exp);renderTop(exp)
}
function chartOptions(stacked=false){return{responsive:true,maintainAspectRatio:false,scales:{x:{stacked,grid:{display:false}},y:{stacked,beginAtZero:true,ticks:{callback:v=>(v/1e6)+'M'},grid:{color:'#edf2f0'}}},plugins:{legend:{position:'bottom'},tooltip:{callbacks:{label:c=>`${c.dataset.label||c.label}: ${money(c.raw)}`}}}}}
function group(arr,key){return arr.reduce((o,r)=>(o[r[key]||'Other']=(o[r[key]||'Other']||0)+r.amount,o),{})}
function renderBudget(exp){const actual={Total:sum(exp),Meal:sum(exp,r=>r.category==='Meal'),Unexpected:sum(exp,r=>r.category==='Unexpected')};const budgets={Total:CONFIG.totalExpenseBudget,...CONFIG.categoryBudgets};$('#budgetBars').innerHTML=Object.keys(budgets).map(k=>{const pct=actual[k]/budgets[k]*100;return`<div><div class="budget-row-head"><strong>${k==='Total'?'Tổng chi tiêu':k}</strong><span>${money(actual[k])} / ${money(budgets[k])}</span></div><div class="progress"><i class="${pct>100?'over':''}" style="width:${Math.min(pct,100)}%"></i></div></div>`}).join('')}
function renderTop(exp){const top=[...exp].sort((a,b)=>b.amount-a.amount).slice(0,6);$('#topExpenses').innerHTML=top.map((r,i)=>`<div class="rank-item"><div class="rank-row"><strong>${i+1}. ${r.item||r.category}</strong><strong>${money(r.amount)}</strong></div><div class="rank-note">${r.description||'Không có ghi chú'} · ${r.category}</div></div>`).join('')||'<p>Chưa có dữ liệu.</p>'}
function renderExpenses(){const exp=filtered().filter(r=>r.type.toLowerCase()==='expense');$('#expenseTotal2').textContent=money(sum(exp));$('#mealTotal').textContent=money(sum(exp,r=>r.category==='Meal'));$('#unexpectedTotal').textContent=money(sum(exp,r=>r.category==='Unexpected'));$('#fixedTotal').textContent=money(sum(exp,r=>r.category==='Fixed'));
  const items=Object.entries(group(exp,'item')).sort((a,b)=>b[1]-a[1]).slice(0,10);destroy('items');charts.items=new Chart($('#itemsChart'),{type:'bar',data:{labels:items.map(x=>x[0]||'Other'),datasets:[{label:'Chi tiêu',data:items.map(x=>x[1]),backgroundColor:items.map((_,i)=>COLORS[(i+2)%COLORS.length]),borderRadius:6}]},options:{...chartOptions(),indexAxis:'y'}});
  const days={};exp.forEach(r=>{const k=r.date||r.actual||'Không rõ';days[k]=(days[k]||0)+r.amount});const dayEntries=Object.entries(days).sort((a,b)=>dateValue(a[0])-dateValue(b[0]));destroy('daily');charts.daily=new Chart($('#dailyExpenseChart'),{type:'line',data:{labels:dayEntries.map(x=>x[0]),datasets:[{label:'Chi tiêu',data:dayEntries.map(x=>x[1]),borderColor:'#34A0A4',backgroundColor:'rgba(52,160,164,.12)',fill:true,tension:.35}]},options:chartOptions()});renderExpenseTable(exp)}
function renderExpenseTable(exp){const q=clean($('#expenseSearch').value).toLowerCase();const data=exp.filter(r=>(r.item+' '+r.description+' '+r.category).toLowerCase().includes(q)).sort((a,b)=>dateValue(b.date)-dateValue(a.date));$('#expenseTable').innerHTML=data.map(r=>`<tr><td>${r.date||'-'}</td><td><span class="pill">${r.category}</span></td><td>${r.item||'-'}</td><td>${r.description||'-'}</td><td class="amount">${money(r.amount)}</td></tr>`).join('')}
function renderSavings(){const data=filtered(),income=sum(data,r=>r.type.toLowerCase()==='income'),expense=sum(data,r=>r.type.toLowerCase()==='expense'),net=income-expense,rate=income?Math.max(0,net/income*100):0;$('#savingHero').textContent=money(net);$('#savingRingText').textContent=`${Math.round(rate)}%`;$('#savingRing').style.background=`conic-gradient(#D9ED92 ${Math.min(rate,100)}%, rgba(255,255,255,.18) 0)`;$('#allocationCards').innerHTML=CONFIG.allocations.map(([n,p,c])=>`<div class="allocation-card"><i style="background:${c}"></i><span>${n}</span><strong>${money(Math.max(0,net)*p/100)}</strong><small>${p}% tiền tiết kiệm</small></div>`).join('');
  destroy('waterfall');charts.waterfall=new Chart($('#waterfallChart'),{type:'bar',data:{labels:['Thu nhập','Chi tiêu','Tiết kiệm ròng'],datasets:[{label:'Dòng tiền',data:[[0,income],[income,net],[0,net]],backgroundColor:['#76C893','#d95d5d','#168AAD'],borderRadius:7}]},options:{...chartOptions(),plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>money(c.raw[1]-c.raw[0])}}}}});
  const ms=monthlyStats(),months=Object.keys(ms).sort(),nets=months.map(m=>ms[m].income-ms[m].expense);destroy('savingTrend');charts.savingTrend=new Chart($('#savingTrendChart'),{type:'bar',data:{labels:months.map(monthLabel),datasets:[{label:'Tiết kiệm',data:nets,backgroundColor:nets.map(n=>n>=0?'#168AAD':'#d95d5d'),borderRadius:6}]},options:chartOptions()})}
function renderTransactions(){const q=clean($('#allSearch').value).toLowerCase();const data=filtered().filter(r=>Object.values(r).join(' ').toLowerCase().includes(q)).sort((a,b)=>dateValue(b.date)-dateValue(a.date));$('#transactionCount').textContent=`${data.length} giao dịch`;$('#allTable').innerHTML=data.map(r=>`<tr><td>${monthLabel(r.month)}</td><td>${r.date||'-'}</td><td><span class="pill ${r.type.toLowerCase()==='income'?'income':''}">${r.type}</span></td><td>${r.category}</td><td>${r.item||'-'}</td><td>${r.description||'-'}</td><td class="amount ${r.type.toLowerCase()==='income'?'positive':''}">${money(r.amount)}</td></tr>`).join('')}
$('.nav-btn')?.addEventListener('click',()=>{});document.querySelectorAll('.nav-btn').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.nav-btn,.page').forEach(x=>x.classList.remove('active'));btn.classList.add('active');$('#'+btn.dataset.page).classList.add('active');$('#pageTitle').textContent={dashboard:'Tổng quan tài chính',expenses:'Phân tích chi tiêu',savings:'Tiết kiệm & phân bổ',transactions:'Danh sách giao dịch'}[btn.dataset.page]}));
$('#monthFilter').addEventListener('change',e=>{selectedMonth=e.target.value;renderAll()});$('#refreshBtn').addEventListener('click',loadData);$('#expenseSearch').addEventListener('input',()=>renderExpenseTable(filtered().filter(r=>r.type.toLowerCase()==='expense')));$('#allSearch').addEventListener('input',renderTransactions);loadData();
