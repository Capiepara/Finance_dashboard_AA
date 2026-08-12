"use strict";

const CONFIG={
  sheetId:"1gAr4O_sTA6L68ThUHqcrmiruMe2aP_Oh39khKwVcOt8",
  gid:"1116776327",
  totalBudget:19000000,
  categoryBudgets:{Fixed:14000000,Meal:4000000,Unexpected:1000000},
  allocations:[["Investment",15],["Kids",10],["Education",25],["Emergency",20],["Saving",30]],
  palette:["#81B29A","#E07A5F","#3D405B","#F2CC8F","#6F83B1","#9C755F","#B9AE9A","#76A89C"]
};

let transactions=[];
let selectedMonth="";
let transactionMonth="all";
let savingsMonth="";
const $=id=>document.getElementById(id);

window.addEventListener("DOMContentLoaded",()=>{
  document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.page)));
  document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.go)));
  $("refreshButton").addEventListener("click",loadData);
  $("monthSelect").addEventListener("change",e=>{selectedMonth=e.target.value;renderDashboard();renderVisibleCharts();});
  $("transactionMonthSelect").addEventListener("change",e=>{transactionMonth=e.target.value;renderAllTransactions();});
  $("savingsMonthSelect").addEventListener("change",e=>{savingsMonth=e.target.value;renderSavings();renderVisibleCharts();});
  $("transactionSearch").addEventListener("input",renderAllTransactions);
  window.addEventListener("resize",debounce(renderVisibleCharts,120));
  loadData();
});

function showPage(page){
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  document.querySelectorAll(".page").forEach(s=>s.classList.remove("active"));
  $(`${page}Page`).classList.add("active");
  $("pageTitle").textContent=page[0].toUpperCase()+page.slice(1);
  if(page==="transactions") renderAllTransactions();
  if(page==="savings") renderSavings();
  setTimeout(renderVisibleCharts,20);
}

async function loadData(){
  setDataStatus("Loading data…","");hideMessage();
  const urls=[
    `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/gviz/tq?tqx=out:csv&gid=${CONFIG.gid}&_=${Date.now()}`,
    `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/export?format=csv&gid=${CONFIG.gid}&_=${Date.now()}`
  ];
  let parsed=[],lastError=null;
  for(const url of urls){
    try{
      const r=await fetch(url,{cache:"no-store"});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const text=await r.text();
      if(/^\s*</.test(text)) throw new Error("Google returned HTML instead of CSV");
      parsed=parseTransactions(parseCSV(text));
      if(parsed.length) break;
      throw new Error("No valid transaction rows found");
    }catch(e){lastError=e;console.warn("Sheet endpoint failed",e);}
  }
  if(!parsed.length){
    transactions=[];setDataStatus("Google Sheets unavailable","error");
    showMessage("Unable to load live Google Sheets data. Confirm that the sheet is shared for viewing, then press Refresh.");
    console.error(lastError);populateFilters();renderAll();return;
  }
  transactions=parsed;setDataStatus("Live Google Sheets","live");
  populateFilters();renderAll();
}

function parseCSV(text){
  const rows=[];let row=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){
      if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}
      else if(c==='"')quoted=false;else cell+=c;
    }else{
      if(c==='"')quoted=true;
      else if(c===','){row.push(cell);cell="";}
      else if(c==='\n'){row.push(cell.replace(/\r$/, ""));rows.push(row);row=[];cell="";}
      else cell+=c;
    }
  }
  if(cell.length||row.length){row.push(cell);rows.push(row)}
  return rows;
}
function parseTransactions(rows){
  const hi=rows.findIndex(r=>r.some(c=>String(c).trim().toLowerCase()==="month")&&r.some(c=>String(c).trim().toLowerCase()==="amount"));
  if(hi<0)return[];
  const headers=rows[hi].map(v=>String(v).trim().toLowerCase());
  const raw=rows.slice(hi+1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??""])));
  return normalizeRows(raw);
}
function normalizeRows(rawRows){
  return rawRows.map(r=>{
    const amount=toNumber(r.amount),actualDate=parseDate(r.actual),date=parseDate(r.date)||actualDate;
    return{month:normalizeMonth(r.month,date),date,type:canonicalType(r.type),category:canonicalCategory(r.category),item:String(r.items||r.item||"").trim(),amount,description:String(r.description||"").trim()}
  }).filter(r=>r.type&&r.amount>0&&r.month!=="Unknown");
}
function canonicalType(v){const s=String(v||"").trim();if(/^income$/i.test(s))return"Income";if(/^expense$/i.test(s))return"Expense";return s}
function canonicalCategory(v){const s=String(v||"").trim();if(!s||s==="0")return"Income";return s}
function toNumber(v){return Number(String(v??"").replace(/[^0-9.-]/g,""))||0}
function parseDate(v){const s=String(v||"").trim();if(!s)return null;let m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);if(m){const d=new Date(+m[3],+m[1]-1,+m[2]);return isNaN(d)?null:d}const d=new Date(s);return isNaN(d)?null:d}
function normalizeMonth(code,date){const m=String(code||"").match(/A?(\d{2})(\d{2})/i);if(m)return`20${m[1]}-${m[2]}`;if(date)return`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;return"Unknown"}

function availableMonths(){return[...new Set(transactions.map(r=>r.month))].sort()}
function populateFilters(){
  const months=availableMonths();
  if(!months.length){
    ["monthSelect","transactionMonthSelect","savingsMonthSelect"].forEach(id=>$(id).innerHTML="<option>No data</option>");return;
  }
  if(!selectedMonth||!months.includes(selectedMonth))selectedMonth=months[months.length-1];
  if(!savingsMonth||!months.includes(savingsMonth))savingsMonth=selectedMonth;
  $("monthSelect").innerHTML=months.slice().reverse().map(m=>`<option value="${m}" ${m===selectedMonth?"selected":""}>${formatMonth(m)}</option>`).join("");
  $("transactionMonthSelect").innerHTML=`<option value="all">All months</option>`+months.slice().reverse().map(m=>`<option value="${m}">${formatMonth(m)}</option>`).join("");
  $("transactionMonthSelect").value=transactionMonth;
  $("savingsMonthSelect").innerHTML=months.slice().reverse().map(m=>`<option value="${m}" ${m===savingsMonth?"selected":""}>${formatMonth(m)}</option>`).join("");
}
function rowsForMonth(month){return transactions.filter(r=>r.month===month)}
function selectedRows(){return rowsForMonth(selectedMonth)}
function sum(rows,type){return rows.filter(r=>!type||r.type===type).reduce((a,r)=>a+r.amount,0)}
function renderAll(){renderDashboard();renderAllTransactions();renderSavings();renderVisibleCharts()}

function renderDashboard(){
  const rows=selectedRows(),income=sum(rows,"Income"),expense=sum(rows,"Expense"),savings=income-expense,left=CONFIG.totalBudget-expense;
  $("totalIncome").textContent=formatMoney(income);$("totalExpense").textContent=formatMoney(expense);$("netSavings").textContent=formatMoney(savings);
  $("netSavings").className=savings<0?"negative":"positive";$("savingRate").textContent=income?`${(savings/income*100).toFixed(1)}% saving rate`:"No income recorded";
  $("budgetLeft").textContent=formatMoney(left);$("budgetLeft").className=left<0?"negative":"positive";$("budgetUsage").textContent=`${(expense/CONFIG.totalBudget*100).toFixed(1)}% of budget used`;
  $("incomeMeta").textContent=formatMonth(selectedMonth);$("expenseMeta").textContent=formatMonth(selectedMonth);
  renderCategoryBars(rows);renderBudgetTable(rows);renderRecent(rows);renderItemPie(rows);
}
function monthlySummary(){
  const map=new Map();
  for(const r of transactions){
    if(!map.has(r.month))map.set(r.month,{income:0,expense:0,Albert:0,Annie:0,Other:0});const x=map.get(r.month);
    if(r.type==="Income"){x.income+=r.amount;const t=`${r.item} ${r.description}`;if(/albert/i.test(t))x.Albert+=r.amount;else if(/annie/i.test(t))x.Annie+=r.amount;else x.Other+=r.amount}else if(r.type==="Expense")x.expense+=r.amount;
  }
  return[...map.entries()].sort(([a],[b])=>a.localeCompare(b));
}
function categoryData(rows){const exp=rows.filter(r=>r.type==="Expense"),total=sum(exp),map=new Map();exp.forEach(r=>map.set(r.category||"Other",(map.get(r.category||"Other")||0)+r.amount));return[...map.entries()].map(([category,amount])=>({category,amount,percent:total?amount/total*100:0})).sort((a,b)=>b.amount-a.amount)}
function itemData(rows){
  const exp=rows.filter(r=>r.type==="Expense"),total=sum(exp),map=new Map();exp.forEach(r=>map.set(r.item||"Other",(map.get(r.item||"Other")||0)+r.amount));
  let data=[...map.entries()].map(([item,amount])=>({item,amount,percent:total?amount/total*100:0})).sort((a,b)=>b.amount-a.amount);
  if(data.length>6){const top=data.slice(0,5),rest=data.slice(5),amount=rest.reduce((a,x)=>a+x.amount,0);data=[...top,{item:"Others",amount,percent:total?amount/total*100:0}]}
  return data;
}
function renderCategoryBars(rows){const d=categoryData(rows);$("categoryTotal").textContent=formatMoney(d.reduce((a,x)=>a+x.amount,0));$("categoryBars").innerHTML=d.length?d.map((x,i)=>`<div class="category-row"><span class="category-name">${esc(x.category)}</span><div class="category-track"><div class="category-fill" style="width:${Math.max(x.percent,1)}%;background:${CONFIG.palette[i%CONFIG.palette.length]}"></div></div><span class="category-percent">${x.percent.toFixed(1)}%</span><span class="category-amount">${formatMoney(x.amount)}</span></div>`).join(""):`<div class="empty-state">No expenses recorded for this month.</div>`}
function renderItemPie(rows){
  const data=itemData(rows);pieChart($("itemPieChart"),data);
  $("itemPieLegend").innerHTML=data.length?data.map((x,i)=>`<div class="pie-legend-row"><i class="swatch" style="background:${CONFIG.palette[i%CONFIG.palette.length]}"></i><span class="pie-legend-name" title="${esc(x.item)}">${esc(x.item)}</span><span class="num">${x.percent.toFixed(1)}%</span><strong>${formatMoney(x.amount)}</strong></div>`).join(""):`<div class="empty-state">No expenses recorded.</div>`;
}
function budgetFor(cat){return CONFIG.categoryBudgets[cat]??null}
function renderBudgetTable(rows){
  const d=categoryData(rows);$("budgetTableBody").innerHTML=d.length?d.map(x=>{const b=budgetFor(x.category),left=b==null?null:b-x.amount,pct=b?x.amount/b*100:null;return`<tr><td>${esc(x.category)}</td><td class="num">${b==null?"—":formatMoney(b)}</td><td class="num"><strong>${formatMoney(x.amount)}</strong></td><td class="num">${pct==null?"—":`<div class="budget-progress"><span>${pct.toFixed(1)}%</span><div class="budget-track"><div class="budget-fill ${pct>100?"over":""}" style="width:${Math.min(pct,100)}%"></div></div></div>`}</td><td class="num ${left!=null&&left<0?"negative":""}">${left==null?"—":formatMoney(left)}</td></tr>`}).join(""):`<tr><td colspan="5">No expenses recorded.</td></tr>`;
}
function renderRecent(rows){const list=rows.slice().sort(sortByDateDesc).slice(0,8);$("recentTableBody").innerHTML=list.map(transactionRow).join("")||`<tr><td colspan="6">No transactions recorded.</td></tr>`}
function transactionRow(r){return`<tr><td>${formatDate(r.date)}</td><td class="type-${r.type.toLowerCase()}">${esc(r.type)}</td><td>${esc(r.item)}</td><td>${esc(r.category)}</td><td class="num"><strong>${formatMoney(r.amount)}</strong></td><td>${esc(r.description)}</td></tr>`}
function sortByDateDesc(a,b){return(b.date?.getTime()||0)-(a.date?.getTime()||0)}
function renderAllTransactions(){
  const q=($("transactionSearch")?.value||"").trim().toLowerCase();
  const list=transactions.filter(r=>(transactionMonth==="all"||r.month===transactionMonth)&&(!q||`${r.item} ${r.category} ${r.description} ${r.type}`.toLowerCase().includes(q))).sort(sortByDateDesc);
  $("allTransactionsBody").innerHTML=list.map(r=>`<tr><td>${formatDate(r.date)}</td><td>${formatMonth(r.month)}</td><td class="type-${r.type.toLowerCase()}">${esc(r.type)}</td><td>${esc(r.category)}</td><td>${esc(r.item)}</td><td class="num"><strong>${formatMoney(r.amount)}</strong></td><td>${esc(r.description)}</td></tr>`).join("")||`<tr><td colspan="7">No transactions match this filter.</td></tr>`;
}

function renderSavings(){
  const rows=rowsForMonth(savingsMonth),income=sum(rows,"Income"),expense=sum(rows,"Expense"),available=income-expense;
  $("savingIncome").textContent=formatMoney(income);$("savingExpense").textContent=formatMoney(expense);$("savingAvailable").textContent=formatMoney(available);$("savingAvailable").className=available<0?"negative":"positive";
  $("allocationList").innerHTML=CONFIG.allocations.map(([name,p],i)=>`<div class="allocation-row"><span class="allocation-name"><span style="display:inline-block;width:9px;height:9px;background:${CONFIG.palette[i%CONFIG.palette.length]};margin-right:8px"></span>${name}</span><span class="allocation-percent">${p}%</span><strong class="allocation-value">${formatMoney(Math.max(available,0)*p/100)}</strong></div>`).join("");
  renderSavingsTable();
}
function savingsByMonth(){return monthlySummary().map(([m,x])=>({month:m,net:x.income-x.expense,income:x.income,expense:x.expense}))}
function renderSavingsTable(){
  const all=savingsByMonth();const cutoff=all.findIndex(x=>x.month===savingsMonth);const shown=(cutoff>=0?all.slice(0,cutoff+1):all).slice(-8);
  $("savingsTableHead").innerHTML=`<tr><th>Category</th><th class="num">Target %</th>${shown.map(x=>`<th class="num">${formatMonthShort(x.month)}</th>`).join("")}</tr>`;
  const body=CONFIG.allocations.map(([name,p])=>`<tr><td><strong>${name}</strong></td><td class="num">${p}%</td>${shown.map(x=>`<td class="num">${formatMoney(Math.max(x.net,0)*p/100)}</td>`).join("")}</tr>`).join("");
  const total=`<tr><td><strong>TOTAL</strong></td><td class="num"><strong>100%</strong></td>${shown.map(x=>`<td class="num"><strong>${formatMoney(Math.max(x.net,0))}</strong></td>`).join("")}</tr>`;
  $("savingsTableBody").innerHTML=body+total;
}

function renderVisibleCharts(){
  if($("dashboardPage").classList.contains("active")){renderIncomeChart();renderExpenseChart();renderItemPie(selectedRows())}
  if($("savingsPage").classList.contains("active")){renderWaterfall()}
}
function renderIncomeChart(){const s=monthlySummary();barChart($("incomeChart"),s.map(([m])=>formatMonthShort(m)),[{name:"Albert",color:CONFIG.palette[0],data:s.map(([,x])=>x.Albert)},{name:"Annie",color:CONFIG.palette[2],data:s.map(([,x])=>x.Annie)}])}
function renderExpenseChart(){const s=monthlySummary();lineChart($("expenseChart"),s.map(([m])=>formatMonthShort(m)),s.map(([,x])=>x.expense),CONFIG.palette[1])}
function renderWaterfall(){const rows=rowsForMonth(savingsMonth),income=sum(rows,"Income"),expense=sum(rows,"Expense"),saving=income-expense;waterfallChart($("waterfallChart"),income,expense,saving)}

function svgEl(tag,attrs={}){const e=document.createElementNS("http://www.w3.org/2000/svg",tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e}
function setupSVG(el){el.innerHTML="";if(!el.clientWidth||!el.clientHeight)return null;const svg=svgEl("svg",{viewBox:`0 0 ${el.clientWidth} ${el.clientHeight}`,class:"svg-chart",preserveAspectRatio:"none"});el.appendChild(svg);return{svg,w:el.clientWidth,h:el.clientHeight}}
function barChart(el,labels,series){
  const s=setupSVG(el);if(!s)return;if(!labels.length)return empty(el);const{svg,w,h}=s,L=48,R=12,T=40,B=42,pw=w-L-R,ph=h-T-B;
  const totals=labels.map((_,i)=>series.reduce((a,x)=>a+(x.data[i]||0),0)),max=Math.max(...totals,1)*1.18;
  for(let k=0;k<=4;k++){const y=T+ph*k/4;svg.appendChild(svgEl("line",{x1:L,y1:y,x2:w-R,y2:y,class:"grid-line"}));addText(svg,axisMoney(max*(1-k/4)),L-8,y+4,"axis-text","end")}
  const gw=pw/labels.length,bw=Math.min(40,gw*.58);
  labels.forEach((lab,i)=>{let base=0;series.forEach(ser=>{const v=ser.data[i]||0,hh=v/max*ph,y=T+ph-(base+v)/max*ph;const rect=svgEl("rect",{x:L+i*gw+(gw-bw)/2,y,width:bw,height:Math.max(hh,0),fill:ser.color});svg.appendChild(rect);if(v>0&&hh>20)addText(svg,formatMoney(v),L+i*gw+gw/2,y+hh/2+4,"data-label-light","middle");base+=v});if(totals[i]>0)addText(svg,formatMoney(totals[i]),L+i*gw+gw/2,T+ph-totals[i]/max*ph-8,"data-label","middle");addText(svg,lab,L+i*gw+gw/2,h-14,"axis-text","middle")});
  let lx=L;series.forEach(ser=>{svg.appendChild(svgEl("rect",{x:lx,y:8,width:10,height:10,fill:ser.color}));addText(svg,ser.name,lx+15,17,"legend-text","start");lx+=80});
}
function lineChart(el,labels,data,color){
  const s=setupSVG(el);if(!s)return;if(!labels.length)return empty(el);const{svg,w,h}=s,L=48,R=18,T=34,B=42,pw=w-L-R,ph=h-T-B,max=Math.max(...data,1)*1.18;
  for(let k=0;k<=4;k++){const y=T+ph*k/4;svg.appendChild(svgEl("line",{x1:L,y1:y,x2:w-R,y2:y,class:"grid-line"}));addText(svg,axisMoney(max*(1-k/4)),L-8,y+4,"axis-text","end")}
  const pts=data.map((v,i)=>[L+(labels.length===1?pw/2:i*pw/(labels.length-1)),T+ph-v/max*ph]);svg.appendChild(svgEl("polyline",{points:pts.map(p=>p.join(",")).join(" "),fill:"none",stroke:color,"stroke-width":2}));
  pts.forEach((p,i)=>{svg.appendChild(svgEl("circle",{cx:p[0],cy:p[1],r:4,fill:color}));addText(svg,formatMoney(data[i]),p[0],p[1]-10,"data-label","middle");addText(svg,labels[i],p[0],h-14,"axis-text","middle")});
}
function pieChart(el,data){
  const s=setupSVG(el);if(!s)return;if(!data.length)return empty(el);const{svg,w,h}=s,cx=w/2,cy=h/2,r=Math.min(w,h)*.34,total=data.reduce((a,x)=>a+x.amount,0);let angle=-Math.PI/2;
  data.forEach((x,i)=>{const a=x.amount/total*Math.PI*2,end=angle+a,x1=cx+r*Math.cos(angle),y1=cy+r*Math.sin(angle),x2=cx+r*Math.cos(end),y2=cy+r*Math.sin(end),large=a>Math.PI?1:0,path=svgEl("path",{d:`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`,fill:CONFIG.palette[i%CONFIG.palette.length],stroke:"#FFFDF7","stroke-width":1});svg.appendChild(path);const mid=angle+a/2,lr=r*.66;if(x.percent>=5)addText(svg,`${x.percent.toFixed(1)}%`,cx+lr*Math.cos(mid),cy+lr*Math.sin(mid)+4,"data-label-light","middle");angle=end;});
}
function waterfallChart(el,income,expense,saving){
  const s=setupSVG(el);if(!s)return;const{svg,w,h}=s,L=52,R=18,T=40,B=48,pw=w-L-R,ph=h-T-B;const max=Math.max(income,saving,1)*1.15,min=Math.min(saving,0),range=max-min;
  for(let k=0;k<=4;k++){const val=max-range*k/4,y=T+(max-val)/range*ph;svg.appendChild(svgEl("line",{x1:L,y1:y,x2:w-R,y2:y,class:"grid-line"}));addText(svg,axisMoney(val),L-8,y+4,"axis-text","end")}
  const labels=["Income","Expense","Net Savings"],gw=pw/3,bw=Math.min(90,gw*.45),x=i=>L+i*gw+(gw-bw)/2,y=v=>T+(max-v)/range*ph;
  // income from zero
  const zeroY=y(0),incomeY=y(income),savingY=y(saving);
  svg.appendChild(svgEl("rect",{x:x(0),y:incomeY,width:bw,height:Math.abs(zeroY-incomeY),fill:CONFIG.palette[0]}));
  // expense decreases from income to saving
  const ey=Math.min(incomeY,savingY),eh=Math.abs(savingY-incomeY);svg.appendChild(svgEl("rect",{x:x(1),y:ey,width:bw,height:Math.max(eh,2),fill:CONFIG.palette[1]}));
  // total net saving
  const sy=Math.min(zeroY,savingY),sh=Math.abs(zeroY-savingY);svg.appendChild(svgEl("rect",{x:x(2),y:sy,width:bw,height:Math.max(sh,2),fill:CONFIG.palette[2]}));
  // connectors
  svg.appendChild(svgEl("line",{x1:x(0)+bw,y1:incomeY,x2:x(1),y2:incomeY,class:"connector-line"}));svg.appendChild(svgEl("line",{x1:x(1)+bw,y1:savingY,x2:x(2),y2:savingY,class:"connector-line"}));
  addText(svg,formatMoney(income),x(0)+bw/2,incomeY-9,"data-label","middle");addText(svg,`-${formatMoney(expense)}`,x(1)+bw/2,ey+eh/2+4,"data-label-light","middle");addText(svg,formatMoney(saving),x(2)+bw/2,savingY-9,"data-label","middle");
  labels.forEach((lab,i)=>addText(svg,lab,x(i)+bw/2,h-15,"axis-text","middle"));
}
function addText(svg,text,x,y,cls,anchor){const t=svgEl("text",{x,y,class:cls,"text-anchor":anchor});t.textContent=text;svg.appendChild(t)}
function empty(el){el.innerHTML=`<div class="empty-state">No data for this period.</div>`}
function formatMoney(n){const sign=n<0?"-":"",v=Math.abs(n);if(v>=1e9)return sign+(v/1e9).toFixed(v%1e9?1:0)+"B";if(v>=1e6)return sign+(v/1e6).toFixed(v%1e6?1:0)+"M";if(v>=1e3)return sign+(v/1e3).toFixed(v%1e3?1:0)+"K";return sign+Math.round(v).toLocaleString("en-US")}
function axisMoney(n){const v=Math.abs(n);return(n<0?"-":"")+(v>=1e6?(v/1e6).toFixed(v>=1e7?0:1)+"M":v>=1e3?(v/1e3).toFixed(0)+"K":Math.round(v))}
function formatMonth(m){if(!/^\d{4}-\d{2}$/.test(m))return m;const[y,mo]=m.split("-").map(Number);return new Date(y,mo-1,1).toLocaleDateString("en-US",{month:"long",year:"numeric"})}
function formatMonthShort(m){if(!/^\d{4}-\d{2}$/.test(m))return m;const[y,mo]=m.split("-").map(Number);return new Date(y,mo-1,1).toLocaleDateString("en-US",{month:"short",year:"2-digit"})}
function formatDate(d){return d?d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):"—"}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function setDataStatus(text,cls){$("dataStatus").textContent=text;$("dataStatus").className=`data-status ${cls}`}
function showMessage(t){$("statusMessage").textContent=t;$("statusMessage").hidden=false}function hideMessage(){$("statusMessage").hidden=true}
function debounce(fn,ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}
