"use strict";

const CONFIG={
  sheetId:"1gAr4O_sTA6L68ThUHqcrmiruMe2aP_Oh39khKwVcOt8",
  // Tabs the dashboard reads. "budget" is looked up by name because it is created by the Apps Script.
  tabs:{transaction:{gid:"1116776327"},saving:{gid:"948756412"},budget:{name:"budget"}},
  // Optional: links from File > Share > Publish to web (CSV), so the spreadsheet itself can be private.
  publishedCsv:{transaction:"",saving:"",budget:""},
  periodCutoffDay:23,           // Actual date on/after the 23rd counts toward next month (salary day)
  autoRefreshMinutes:5,
  // Fallback when the budget tab is missing or unreadable
  categoryBudgets:{Fixed:14000000,Meal:4000000,Unexpected:1000000},
  allocations:[["Investment",15],["Kids",10],["Education",25],["Emergency",20],["Saving",30]],
  palette:["#81B29A","#E07A5F","#3D405B","#F2CC8F","#6F83B1","#9C755F","#B9AE9A","#76A89C"]
};

let transactions=[];
let issues=[];
let savingRows=[];            // from the saving tab: {month, code, values:{bucket:amount}, total, note}
let savingBuckets=[];         // [{name, percent, bank}]
let savingStatus="";
let budgets={...CONFIG.categoryBudgets};
let budgetSource="default";
let selectedMonth="";
let transactionMonth="all";
let selectedSavingsMonths=[];
let isLoading=false;
let lastLoadedAt=0;
const $=id=>document.getElementById(id);

window.addEventListener("DOMContentLoaded",()=>{
  document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.page)));
  document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.go)));
  $("refreshButton").addEventListener("click",()=>loadData());
  $("monthSelect").addEventListener("change",e=>{selectedMonth=e.target.value;renderDashboard();renderVisibleCharts();});
  $("transactionMonthSelect").addEventListener("change",e=>{transactionMonth=e.target.value;renderAllTransactions();});
  $("savingsMonthMenu").addEventListener("change",handleSavingsMonthChange);
  $("savingsSelectAll").addEventListener("click",()=>setAllSavingsMonths(true));
  $("savingsClearAll").addEventListener("click",()=>setAllSavingsMonths(false));
  $("transactionSearch").addEventListener("input",renderAllTransactions);
  window.addEventListener("resize",debounce(renderVisibleCharts,120));
  loadData();
  startAutoRefresh();
});

// Reload the sheet on a timer while the tab is visible, and when the user comes back to the tab.
function startAutoRefresh(){
  const ms=CONFIG.autoRefreshMinutes*60*1000;
  if(!ms) return;
  setInterval(()=>{if(!document.hidden) loadData({silent:true});},ms);
  document.addEventListener("visibilitychange",()=>{
    if(!document.hidden&&Date.now()-lastLoadedAt>60*1000) loadData({silent:true});
  });
}

function showPage(page){
  const btn=document.querySelector(`.nav-item[data-page="${page}"]`);
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  document.querySelectorAll(".page").forEach(s=>s.classList.remove("active"));
  $(`${page}Page`).classList.add("active");
  $("pageTitle").textContent=btn?.dataset.title||page;
  if(page==="transactions") renderAllTransactions();
  if(page==="savings") renderSavings();
  if(page==="check") renderIssues();
  setTimeout(renderVisibleCharts,20);
}

// ---------------------------------------------------------------- loading

async function loadData({silent=false}={}){
  if(isLoading) return;
  isLoading=true;
  try{await fetchAndRender(silent);}finally{isLoading=false;}
}

// Candidate URLs for one tab, best first. "exact" = CSV rows line up 1:1 with sheet rows.
// The export endpoint ignores filters set in the sheet; gviz does not, so it is only a fallback.
function tabUrls(key){
  const t=CONFIG.tabs[key],base=`https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}`,n=Date.now(),list=[];
  if(CONFIG.publishedCsv[key]) list.push({url:CONFIG.publishedCsv[key]+(CONFIG.publishedCsv[key].includes("?")?"&":"?")+`_=${n}`,exact:true});
  if(t.gid){
    list.push({url:`${base}/export?format=csv&gid=${t.gid}&_=${n}`,exact:true});
    list.push({url:`${base}/gviz/tq?tqx=out:csv&gid=${t.gid}&_=${n}`,exact:false});
  }else{
    list.push({url:`${base}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(t.name)}&_=${n}`,exact:false});
  }
  return list;
}
async function fetchTab(key,parse){
  let lastError=null;
  for(const {url,exact} of tabUrls(key)){
    try{
      const r=await fetch(url,{cache:"no-store"});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const text=await r.text();
      if(/^\s*</.test(text)) throw new Error("Google returned HTML instead of CSV");
      const out=parse(parseCSV(text),exact);
      if(out) return out;
      throw new Error("No usable rows");
    }catch(e){lastError=e;console.warn(`${key}: endpoint failed`,e);}
  }
  throw lastError||new Error(`${key} unavailable`);
}

async function fetchAndRender(silent){
  if(!silent){setDataStatus("Loading data…","");hideMessage();}
  const [tx,sav,bud]=await Promise.allSettled([
    fetchTab("transaction",(rows,exact)=>{const out=parseTransactions(rows,exact);return out.rows.length?out:null}),
    fetchTab("saving",(rows,exact)=>{const out=parseSaving(rows,exact);return out.rows.length?out:null}),
    fetchTab("budget",rows=>parseBudget(rows))
  ]);
  if(tx.status!=="fulfilled"){
    // A failed background refresh keeps the data already on screen.
    if(silent&&transactions.length){setDataStatus(`Offline · last update ${formatTime(lastLoadedAt)}`,"error");return;}
    transactions=[];issues=[];setDataStatus("Google Sheets unavailable","error");
    showMessage("Unable to load live Google Sheets data. Confirm that the sheet is shared for viewing, then press Refresh.");
    console.error(tx.reason);populateFilters();renderAll();updateIssueBadge();return;
  }
  transactions=tx.value.rows;issues=tx.value.issues;
  if(sav.status==="fulfilled"){savingRows=sav.value.rows;savingBuckets=sav.value.buckets;savingStatus="";issues=issues.concat(sav.value.issues);}
  else if(!savingRows.length) savingStatus="Could not read the saving tab.";
  if(bud.status==="fulfilled"){budgets=bud.value;budgetSource="budget tab";}
  else if(budgetSource!=="budget tab"){budgets={...CONFIG.categoryBudgets};budgetSource="default";}
  lastLoadedAt=Date.now();hideMessage();
  setDataStatus(`Live · updated ${formatTime(lastLoadedAt)}`,"live");
  populateFilters();renderAll();updateIssueBadge();
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

// ---------------------------------------------------------------- transaction tab + data checks

function parseTransactions(rows,exact){
  const hi=rows.findIndex(r=>r.some(c=>/(^|\s)month$/i.test(String(c).trim()))&&r.some(c=>String(c).trim().toLowerCase()==="amount"));
  if(hi<0)return{rows:[],issues:[]};
  const headers=rows[hi].map(v=>String(v).trim().toLowerCase().replace(/^transaction\s+/,""));
  const out=[],found=[];
  rows.slice(hi+1).forEach((cells,i)=>{
    const r=Object.fromEntries(headers.map((h,j)=>[h,cells[j]??""]));
    const sheetRow=exact?hi+i+2:null;
    const item=String(r.items||r.item||"").trim(),rawType=String(r.type||"").trim(),rawAmount=String(r.amount||"").trim();
    if(!item&&!rawAmount&&!rawType)return;                       // empty row
    const amount=toNumber(rawAmount),actual=parseDate(r.actual),date=parseDate(r.date)||actual;
    const type=canonicalType(rawType),month=normalizeMonth(r.month,date);
    const base={row:sheetRow,month,type:rawType,item,amount};
    const flag=(problem,counted)=>found.push({...base,problem,counted});
    if(!rawType){flag("Type is empty",false);return}
    if(type!=="Income"&&type!=="Expense"){flag(`Unknown Type "${rawType}"`,false);return}
    if(!(amount>0)){flag("Amount is empty, zero or not a number",false);return}
    if(month==="Unknown"){flag("Month and Date are both empty",false);return}
    if(!item)flag("Item is empty",true);
    const rawCat=String(r.category||"").trim();
    let category=type==="Income"?"Income":rawCat;
    if(type==="Expense"&&(!rawCat||rawCat==="0")){category="Uncategorized";flag("Item not in the setup list, so no category",true)}
    if(type==="Income"&&rawCat&&rawCat!=="0")flag(`Income row has category "${rawCat}" (should be empty)`,true);
    if(r.month&&date&&monthKey(date)!==month)flag(`Month code ${r.month} does not match Date ${formatDate(date)}`,true);
    if(r.month&&actual&&periodOf(actual)!==month)flag(`Actual date ${formatDate(actual)} belongs to ${formatMonthShort(periodOf(actual))} (23rd rule)`,true);
    out.push({row:sheetRow,month,date,type,category,item,amount,description:String(r.description||"").trim()});
  });
  return{rows:out,issues:found};
}
function canonicalType(v){const s=String(v||"").trim();if(/^income$/i.test(s))return"Income";if(/^expense$/i.test(s))return"Expense";return s}
function toNumber(v){return Number(String(v??"").replace(/[^0-9.-]/g,""))||0}
function parseDate(v){const s=String(v||"").trim();if(!s)return null;let m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);if(m){const d=new Date(+m[3],+m[1]-1,+m[2]);return isNaN(d)?null:d}const d=new Date(s);return isNaN(d)?null:d}
function normalizeMonth(code,date){const m=String(code||"").match(/A?(\d{2})(\d{2})/i);if(m)return`20${m[1]}-${m[2]}`;if(date)return monthKey(date);return"Unknown"}
function monthKey(d){return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`}
// Budget month a date belongs to: from the 23rd on, it is next month's period.
function periodOf(d){return monthKey(new Date(d.getFullYear(),d.getMonth()+(d.getDate()>=CONFIG.periodCutoffDay?1:0),1))}
function currentPeriod(){return periodOf(new Date())}
function periodEndLabel(m){const[y,mo]=m.split("-").map(Number);return new Date(y,mo-1,CONFIG.periodCutoffDay-1).toLocaleDateString("en-US",{month:"short",day:"numeric"})}
function monthLabel(m){return formatMonth(m)+(m===currentPeriod()?" (in progress)":"")}

function updateIssueBadge(){
  const skipped=issues.filter(x=>!x.counted).length,n=issues.length;
  $("issueCount").textContent=n||"";$("issueCount").hidden=!n;
  const b=$("issueBadge");b.hidden=!n;
  b.textContent=skipped?`${skipped} row${skipped>1?"s":""} not counted`:`${n} row${n>1?"s":""} to check`;
  b.classList.toggle("bad",skipped>0);
}
function renderIssues(){
  const list=issues.slice().sort((a,b)=>(a.type==="saving tab")-(b.type==="saving tab")||(a.row??0)-(b.row??0));
  const skipped=list.filter(x=>!x.counted);
  $("issueSummary").textContent=!list.length?"No problems found. Every row is counted.":
    `${list.length} row${list.length>1?"s":""} to check · ${skipped.length} not counted (${formatMoney(skipped.reduce((a,x)=>a+(x.amount||0),0))} missing from totals)`;
  $("issueTableBody").innerHTML=list.map(x=>`<tr><td class="num">${x.row??"—"}</td><td>${x.month==="Unknown"?"—":formatMonthShort(x.month)}</td><td>${esc(x.type)||"—"}</td><td>${esc(x.item)||"—"}</td><td class="num">${x.amount?formatMoney(x.amount):"—"}</td><td>${esc(x.problem)}</td><td class="${x.counted?"":"negative"}">${x.counted?"Counted":"Not counted"}</td></tr>`).join("")||`<tr><td colspan="7">Nothing to fix.</td></tr>`;
}

// ---------------------------------------------------------------- saving + budget tabs

// Reads the "Savings Allocation Tracking" table: Year | Month | bucket columns | Total Allocated | note.
function parseSaving(rows,exact){
  const hi=rows.findIndex(r=>r.some(c=>/^investment$/i.test(String(c).trim()))&&r.some(c=>/total allocated/i.test(String(c))));
  if(hi<0)return{rows:[],buckets:[],issues:[]};
  const head=rows[hi].map(c=>String(c).trim());
  const monthCol=head.findIndex(c=>/^month$/i.test(c)),totalCol=head.findIndex(c=>/total allocated/i.test(c));
  const bucketCols=[];for(let j=monthCol+1;j<totalCol;j++)if(head[j])bucketCols.push(j);
  const pctRow=rows.slice(Math.max(0,hi-3),hi).find(r=>bucketCols.some(j=>/%$/.test(String(r[j]||"").trim())))||[];
  const bankRow=rows[hi-1]||[];
  const buckets=bucketCols.map(j=>{
    const name=head[j],cfg=CONFIG.allocations.find(([n])=>n===name);
    const pct=parseFloat(String(pctRow[j]||"").replace("%",""));
    return{name,col:j,percent:isNaN(pct)?(cfg?cfg[1]:0):pct,bank:/%/.test(bankRow[j]||"")?"":String(bankRow[j]||"").trim()};
  });
  const out=[],found=[];
  for(let i=hi+1;i<rows.length;i++){
    const r=rows[i],code=String(r[monthCol]||"").trim(),m=code.match(/^A(\d{2})(\d{2})/i);
    if(!m)break;
    const values=Object.fromEntries(buckets.map(b=>[b.name,toSigned(r[b.col])]));
    const total=toSigned(r[totalCol]);
    if(!total&&buckets.every(b=>!values[b.name]))continue;
    const month=`20${m[1]}-${m[2]}`,parts=buckets.reduce((a,b)=>a+values[b.name],0);
    if(Math.abs(parts-total)>1)found.push({row:exact?i+1:null,month,type:"saving tab",item:code,amount:total,counted:true,
      problem:`Buckets add up to ${formatMoney(parts)} but Total Allocated is ${formatMoney(total)}`});
    out.push({month,code,values,total,note:String(r[totalCol+1]||"").trim()});
  }
  return{rows:out,buckets:buckets.map(({name,percent,bank})=>({name,percent,bank})),issues:found};
}
function toSigned(v){const s=String(v??"").trim();if(!s)return 0;const neg=/^\(.*\)$/.test(s)||/^-/.test(s);const n=Number(s.replace(/[^0-9.]/g,""))||0;return neg?-n:n}

// Budget tab must start with the exact header written by the Apps Script.
// (Google returns the first tab when a tab name does not exist, so this check matters.)
function parseBudget(rows){
  const head=(rows[0]||[]).map(c=>String(c).trim().toLowerCase());
  if(head[0]!=="budget category"||!/monthly budget/.test(head[1]||""))return null;
  const out={};
  rows.slice(1).forEach(r=>{const name=String(r[0]||"").trim(),v=toNumber(r[1]);if(name&&!/^total$/i.test(name)&&v>0)out[name]=v});
  return Object.keys(out).length?out:null;
}
function totalBudget(){return Object.values(budgets).reduce((a,b)=>a+b,0)}

// ---------------------------------------------------------------- filters

function availableMonths(){return[...new Set(transactions.map(r=>r.month))].sort()}
function populateFilters(){
  const months=availableMonths();
  if(!months.length){
    ["monthSelect","transactionMonthSelect"].forEach(id=>$(id).innerHTML="<option>No data</option>");
    $("savingsMonthMenu").innerHTML='<div class="empty-filter">No data</div>';
    $("savingsMonthSummary").textContent="No data";
    return;
  }
  if(!selectedMonth||!months.includes(selectedMonth))selectedMonth=months[months.length-1];
  selectedSavingsMonths=selectedSavingsMonths.filter(m=>months.includes(m));
  if(!selectedSavingsMonths.length)selectedSavingsMonths=[...months];
  $("monthSelect").innerHTML=months.slice().reverse().map(m=>`<option value="${m}" ${m===selectedMonth?"selected":""}>${monthLabel(m)}</option>`).join("");
  $("transactionMonthSelect").innerHTML=`<option value="all">All months</option>`+months.slice().reverse().map(m=>`<option value="${m}">${monthLabel(m)}</option>`).join("");
  $("transactionMonthSelect").value=months.includes(transactionMonth)?transactionMonth:"all";
  renderSavingsMonthMenu();
}
function renderSavingsMonthMenu(){
  const months=availableMonths().slice().reverse();
  $("savingsMonthMenu").innerHTML=months.map(m=>`<label class="month-check"><input type="checkbox" value="${m}" ${selectedSavingsMonths.includes(m)?"checked":""}><span>${monthLabel(m)}</span></label>`).join("");
  updateSavingsMonthSummary();
}
function updateSavingsMonthSummary(){
  const all=availableMonths();
  const count=selectedSavingsMonths.length;
  let label="Select months";
  if(count===all.length&&all.length) label="All months";
  else if(count===1) label=formatMonth(selectedSavingsMonths[0]);
  else if(count>1) label=`${count} months selected`;
  $("savingsMonthSummary").textContent=label;
}
function handleSavingsMonthChange(e){
  if(!e.target.matches('input[type="checkbox"]'))return;
  const value=e.target.value;
  if(e.target.checked){if(!selectedSavingsMonths.includes(value))selectedSavingsMonths.push(value)}
  else selectedSavingsMonths=selectedSavingsMonths.filter(m=>m!==value);
  selectedSavingsMonths.sort();
  updateSavingsMonthSummary();renderSavings();renderVisibleCharts();
}
function setAllSavingsMonths(selectAll){
  selectedSavingsMonths=selectAll?[...availableMonths()]:[];
  renderSavingsMonthMenu();renderSavings();renderVisibleCharts();
}
function rowsForMonth(month){return transactions.filter(r=>r.month===month)}
function rowsForSavingsSelection(){return transactions.filter(r=>selectedSavingsMonths.includes(r.month))}
function selectedRows(){return rowsForMonth(selectedMonth)}
function sum(rows,type){return rows.filter(r=>!type||r.type===type).reduce((a,r)=>a+r.amount,0)}
function renderAll(){renderDashboard();renderAllTransactions();renderSavings();renderIssues();renderVisibleCharts()}

// ---------------------------------------------------------------- dashboard page

function renderDashboard(){
  const rows=selectedRows(),income=sum(rows,"Income"),expense=sum(rows,"Expense"),savings=income-expense,budget=totalBudget(),left=budget-expense;
  const inProgress=selectedMonth===currentPeriod();
  const meta=selectedMonth?formatMonth(selectedMonth)+(inProgress?` · in progress (ends ${periodEndLabel(selectedMonth)})`:""):"Selected month";
  $("totalIncome").textContent=formatMoney(income);$("totalExpense").textContent=formatMoney(expense);$("netSavings").textContent=formatMoney(savings);
  $("netSavings").className=savings<0?"negative":"positive";
  $("savingRate").textContent=inProgress?"Month in progress — expenses still coming":income?`${(savings/income*100).toFixed(1)}% saving rate`:"No income recorded";
  $("budgetTotal").textContent=formatMoney(budget);$("budgetSource").textContent=budgetSource==="budget tab"?"From the budget tab":"Default (budget tab not found)";
  $("budgetLeft").textContent=formatMoney(left);$("budgetLeft").className=left<0?"negative":"positive";$("budgetUsage").textContent=budget?`${(expense/budget*100).toFixed(1)}% of budget used`:"No budget set";
  $("incomeMeta").textContent=meta;$("expenseMeta").textContent=meta;
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
function budgetFor(cat){return budgets[cat]??null}
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

// ---------------------------------------------------------------- savings page (real money from the saving tab)

function savingForMonths(months){
  const set=new Set(months),out=Object.fromEntries(savingBuckets.map(b=>[b.name,0]));let total=0;
  savingRows.filter(r=>set.has(r.month)).forEach(r=>{savingBuckets.forEach(b=>out[b.name]+=r.values[b.name]||0);total+=r.total});
  return{byBucket:out,total};
}
function savingBalanceUpTo(month){
  const out=Object.fromEntries(savingBuckets.map(b=>[b.name,0]));let total=0;
  savingRows.filter(r=>!month||r.month<=month).forEach(r=>{savingBuckets.forEach(b=>out[b.name]+=r.values[b.name]||0);total+=r.total});
  return{byBucket:out,total};
}
function renderSavings(){
  const rows=rowsForSavingsSelection(),income=sum(rows,"Income"),expense=sum(rows,"Expense"),net=income-expense;
  const moved=savingForMonths(selectedSavingsMonths),lastMonth=selectedSavingsMonths[selectedSavingsMonths.length-1],balance=savingBalanceUpTo(lastMonth);
  $("savingIncome").textContent=formatMoney(income);$("savingExpense").textContent=formatMoney(expense);
  $("savingAvailable").textContent=formatMoney(net);$("savingAvailable").className=net<0?"negative":"positive";
  $("savingMoved").textContent=formatMoney(moved.total);$("savingMoved").className=moved.total<0?"negative":"positive";
  $("savingMovedMeta").textContent=savingStatus||"Deposits minus withdrawals (saving tab)";
  const head=`<div class="allocation-row allocation-head"><span>Bucket</span><span class="allocation-percent">Target</span><span class="allocation-value">Moved</span><span class="allocation-value">Balance</span></div>`;
  $("allocationList").innerHTML=savingBuckets.length?head+savingBuckets.map((b,i)=>`<div class="allocation-row"><span class="allocation-name"><span style="display:inline-block;width:9px;height:9px;background:${CONFIG.palette[i%CONFIG.palette.length]};margin-right:8px"></span>${esc(b.name)}${b.bank?` <small class="muted">${esc(b.bank)}</small>`:""}</span><span class="allocation-percent">${b.percent}%</span><strong class="allocation-value ${moved.byBucket[b.name]<0?"negative":""}">${formatMoney(moved.byBucket[b.name])}</strong><strong class="allocation-value">${formatMoney(balance.byBucket[b.name])}</strong></div>`).join("")+
    `<div class="allocation-row allocation-total"><span>TOTAL</span><span class="allocation-percent">100%</span><strong class="allocation-value">${formatMoney(moved.total)}</strong><strong class="allocation-value">${formatMoney(balance.total)}</strong></div><p class="panel-note">Balance = everything recorded in the saving tab up to ${lastMonth?formatMonth(lastMonth):"today"}, including 2025.</p>`
    :`<div class="empty-state panel-pad">${esc(savingStatus||"No savings recorded.")}</div>`;
  renderSavingsTable();
}
function savingsByMonth(){return monthlySummary().map(([m,x])=>({month:m,net:x.income-x.expense,income:x.income,expense:x.expense}))}
function renderSavingsTable(){
  const shown=savingsByMonth().filter(x=>selectedSavingsMonths.includes(x.month)),cur=currentPeriod();
  const movedBy=Object.fromEntries(shown.map(x=>[x.month,savingForMonths([x.month])]));
  const cell=(v,showZero)=>`<td class="num ${v<0?"negative":""}">${v||showZero?formatMoney(v):"—"}</td>`;
  $("savingsTableHead").innerHTML=`<tr><th>Row</th><th class="num">Target %</th>${shown.map(x=>`<th class="num">${formatMonthShort(x.month)}${x.month===cur?"*":""}</th>`).join("")}<th class="num">Selected Total</th></tr>`;
  const netRow=`<tr class="row-net"><td><strong>Income − Expense</strong></td><td class="num">—</td>${shown.map(x=>cell(x.net,true)).join("")}${cell(shown.reduce((a,x)=>a+x.net,0),true)}</tr>`;
  const bucketRows=savingBuckets.map(b=>`<tr><td>${esc(b.name)}</td><td class="num">${b.percent}%</td>${shown.map(x=>cell(movedBy[x.month].byBucket[b.name])).join("")}${cell(shown.reduce((a,x)=>a+movedBy[x.month].byBucket[b.name],0))}</tr>`).join("");
  const totalRow=`<tr class="row-total"><td><strong>Moved to savings</strong></td><td class="num">100%</td>${shown.map(x=>cell(movedBy[x.month].total)).join("")}${cell(shown.reduce((a,x)=>a+movedBy[x.month].total,0))}</tr>`;
  $("savingsTableBody").innerHTML=netRow+bucketRows+totalRow;
  $("savingsTableNote").textContent=(shown.some(x=>x.month===cur)?`* ${formatMonth(cur)} is still in progress. `:"")+"Negative numbers are withdrawals or months that spent more than they earned.";
}

function renderVisibleCharts(){
  if($("dashboardPage").classList.contains("active")){renderIncomeChart();renderExpenseChart();renderItemPie(selectedRows())}
  if($("savingsPage").classList.contains("active")){renderWaterfall()}
}
function renderIncomeChart(){const s=monthlySummary();barChart($("incomeChart"),s.map(([m])=>formatMonthShort(m)),[{name:"Albert",color:CONFIG.palette[0],data:s.map(([,x])=>x.Albert)},{name:"Annie",color:CONFIG.palette[2],data:s.map(([,x])=>x.Annie)}])}
function renderExpenseChart(){const s=monthlySummary();lineChart($("expenseChart"),s.map(([m])=>formatMonthShort(m)),s.map(([,x])=>x.expense),CONFIG.palette[1])}
function renderWaterfall(){const rows=rowsForSavingsSelection(),income=sum(rows,"Income"),expense=sum(rows,"Expense"),saving=income-expense;waterfallChart($("waterfallChart"),income,expense,saving)}

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
function formatTime(ts){return new Date(ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
function debounce(fn,ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}
