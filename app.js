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
  goal:{amount:500000000,years:5,annualReturn:5}   // savings goal; editable on the Goal plan page
};

// Calm navy / slate palette, one tone family. Slot order keeps neighbours apart for color-blind
// readers (checked: adjacent ΔE ≥ 22.7). Greys are low-chroma by design, so every chart also has a
// legend, labels and hover values. Money going out / negatives use Slate Grey and sit below zero.
const COLORS={s1:"#0353A4",s2:"#979DAC",s3:"#002855",s4:"#5C677D",neg:"#7D8597",other:"#D3D8E0",ref:"#979DAC"};
const CATEGORICAL=[COLORS.s1,COLORS.s2,COLORS.s3,COLORS.s4];
const ENTITY={Albert:COLORS.s1,Annie:COLORS.s2,Fixed:COLORS.s1,Meal:COLORS.s2,Unexpected:COLORS.s3,Uncategorized:COLORS.other,Other:COLORS.other};
function entityColor(name,i=0){return ENTITY[name]||CATEGORICAL[i%CATEGORICAL.length]}

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
  bindPlanControls();
  const startPage=location.hash.slice(1);   // e.g. …/#plan opens the Goal plan page
  if(startPage&&$(`${startPage}Page`)) showPage(startPage);
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
  try{history.replaceState(null,"",page==="dashboard"?location.pathname:`#${page}`)}catch(e){}
  if(page==="transactions") renderAllTransactions();
  if(page==="savings") renderSavings();
  if(page==="check") renderIssues();
  if(page==="plan") renderPlan();
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
  if(data.length>5){const top=data.slice(0,4),rest=data.slice(4),amount=rest.reduce((a,x)=>a+x.amount,0);data=[...top,{item:"Others",amount,percent:total?amount/total*100:0}]}
  return data;
}
function renderCategoryBars(rows){const d=categoryData(rows);$("categoryTotal").textContent=formatMoney(d.reduce((a,x)=>a+x.amount,0));$("categoryBars").innerHTML=d.length?d.map((x,i)=>`<div class="category-row"><span class="category-name">${esc(x.category)}</span><div class="category-track"><div class="category-fill" style="width:${Math.max(x.percent,1)}%;background:${entityColor(x.category,i)}"></div></div><span class="category-percent">${x.percent.toFixed(1)}%</span><span class="category-amount">${formatMoney(x.amount)}</span></div>`).join(""):`<div class="empty-state">No expenses recorded for this month.</div>`}
function renderItemPie(rows){
  const data=itemData(rows);pieChart($("itemPieChart"),data);
  $("itemPieLegend").innerHTML=data.length?data.map((x,i)=>`<div class="pie-legend-row"><i class="swatch" style="background:${pieColor(x,i)}"></i><span class="pie-legend-name" title="${esc(x.item)}">${esc(x.item)}</span><span class="num">${x.percent.toFixed(1)}%</span><strong>${formatMoney(x.amount)}</strong></div>`).join(""):`<div class="empty-state">No expenses recorded.</div>`;
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
  renderTransactionSummary(list);
  $("allTransactionsBody").innerHTML=list.map(r=>`<tr><td>${formatDate(r.date)}</td><td>${formatMonth(r.month)}</td><td class="type-${r.type.toLowerCase()}">${esc(r.type)}</td><td>${esc(r.category)}</td><td>${esc(r.item)}</td><td class="num"><strong>${formatMoney(r.amount)}</strong></td><td>${esc(r.description)}</td></tr>`).join("")||`<tr><td colspan="7">No transactions match this filter.</td></tr>`;
}

// ---------------------------------------------------------------- transactions page: totals for the current filter

function renderTransactionSummary(list){
  const income=sum(list,"Income"),expense=sum(list,"Expense"),net=income-expense,exp=list.filter(r=>r.type==="Expense");
  const biggest=exp.reduce((a,r)=>!a||r.amount>a.amount?r:a,null);
  $("txIncome").textContent=formatMoney(income);
  $("txExpense").textContent=formatMoney(expense);
  $("txNet").textContent=formatMoney(net);$("txNet").className=net<0?"negative":"positive";
  $("txNetMeta").textContent=income?`${(net/income*100).toFixed(1)}% of income kept`:"No income in this view";
  $("txCount").textContent=list.length.toLocaleString("en-US");
  $("txCountMeta").textContent=`${list.length-exp.length} income · ${exp.length} expense`;
  $("txAvg").textContent=exp.length?formatMoney(expense/exp.length):"—";
  $("txBiggest").textContent=biggest?formatMoney(biggest.amount):"—";
  $("txBiggestMeta").textContent=biggest?`${biggest.item||"—"} · ${formatDate(biggest.date)}`:"No expenses";
  const cats=categoryData(list);
  $("txCategorySplit").innerHTML=cats.length?cats.map(c=>`<span class="split-chip"><i class="swatch" style="background:${entityColor(c.category)}"></i>${esc(c.category)} <strong>${formatMoney(c.amount)}</strong> <small>${c.percent.toFixed(1)}%</small></span>`).join(""):"";
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
  $("allocationList").innerHTML=savingBuckets.length?head+savingBuckets.map(b=>`<div class="allocation-row"><span class="allocation-name">${esc(b.name)}${b.bank?` <small class="muted">${esc(b.bank)}</small>`:""}</span><span class="allocation-percent">${b.percent}%</span><strong class="allocation-value ${moved.byBucket[b.name]<0?"negative":""}">${formatMoney(moved.byBucket[b.name])}</strong><strong class="allocation-value">${formatMoney(balance.byBucket[b.name])}</strong></div>`).join("")+
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

// Fluctuation charts on the savings page
function renderSavingsCharts(){
  const months=selectedSavingsMonths.slice().sort(),labels=months.map(formatMonthShort);
  const net=new Map(savingsByMonth().map(x=>[x.month,x.net]));
  const netVals=months.map(m=>net.get(m)||0),done=months.filter(m=>m<currentPeriod());
  const avg=done.length?done.reduce((a,m)=>a+(net.get(m)||0),0)/done.length:null;
  divergingBarChart($("netChart"),labels,netVals,{avg,avgLabel:"avg (full months)",tipLabel:"Income − Expense"});
  areaLineChart($("balanceChart"),labels,months.map(m=>savingBalanceUpTo(m).total),{color:COLORS.s1,tipLabel:"Savings balance"});
  const ups=months.map(m=>savingRows.filter(r=>r.month===m&&r.total>0).reduce((a,r)=>a+r.total,0));
  const downs=months.map(m=>savingRows.filter(r=>r.month===m&&r.total<0).reduce((a,r)=>a+r.total,0));
  divergingBarChart($("flowChart"),labels,ups,{down:downs,upName:"Deposits",downName:"Withdrawals"});
  renderBucketMultiples(months);
}
function renderBucketMultiples(months){
  const box=$("bucketMultiples");
  if(!savingBuckets.length||!months.length){box.innerHTML=`<div class="empty-state panel-pad">${esc(savingStatus||"No savings recorded.")}</div>`;return}
  box.innerHTML=savingBuckets.map((b,i)=>`<div class="multiple"><div class="multiple-head"><span>${esc(b.name)}${b.bank?` <small class="muted">${esc(b.bank)}</small>`:""}</span><strong id="multVal${i}"></strong></div><div id="mult${i}" class="chart chart-xs"></div></div>`).join("");
  const series=savingBuckets.map(b=>months.map(m=>savingBalanceUpTo(m).byBucket[b.name]));
  const lo=Math.min(0,...series.flat()),hi=Math.max(1,...series.flat());   // shared scale so buckets compare fairly
  savingBuckets.forEach((b,i)=>{
    const vals=series[i];$(`multVal${i}`).textContent=formatMoney(vals[vals.length-1]);
    sparkArea($(`mult${i}`),months.map(formatMonthShort),vals,{lo,hi,name:b.name});
  });
}

// ---------------------------------------------------------------- goal plan: statistical model + what-if

const PLAN_KEYS=[["unexpected","Unexpected",5,60],["meal","Meal",5,40],["fixed","Fixed",5,20]];
let planLevers={unexpected:0,meal:0,fixed:0,income:0};
let planSettings={goal:CONFIG.goal.amount,years:CONFIG.goal.years,ret:CONFIG.goal.annualReturn};
try{const s=JSON.parse(localStorage.getItem("financePlan")||"null");if(s){Object.assign(planLevers,s.levers||{});Object.assign(planSettings,s.settings||{})}}catch(e){}
function savePlan(){try{localStorage.setItem("financePlan",JSON.stringify({levers:planLevers,settings:planSettings}))}catch(e){}}

function completedMonths(){const cur=currentPeriod();return availableMonths().filter(m=>m<cur)}
function monthStats(){
  return completedMonths().map(m=>{
    const rows=rowsForMonth(m),o={month:m,income:sum(rows,"Income"),Fixed:0,Meal:0,Unexpected:0,Other:0};
    rows.filter(r=>r.type==="Expense").forEach(r=>{const k=["Fixed","Meal","Unexpected"].includes(r.category)?r.category:"Other";o[k]+=r.amount});
    o.expense=o.Fixed+o.Meal+o.Unexpected+o.Other;o.net=o.income-o.expense;return o;
  });
}
function monthNet(o,lev,t){
  const g=Math.pow(1+lev.income/100,Math.floor(t/12));
  return o.income*g-(o.Fixed*(1-lev.fixed/100)+o.Meal*(1-lev.meal/100)+o.Unexpected*(1-lev.unexpected/100)+o.Other);
}
function meanOf(stats){const keys=["income","Fixed","Meal","Unexpected","Other","expense","net"];return Object.fromEntries(keys.map(k=>[k,stats.reduce((a,o)=>a+o[k],0)/stats.length]))}
function project(mean,lev,set,b0){let b=b0;const i=set.ret/100/12,n=set.years*12;for(let t=0;t<n;t++)b=b*(1+i)+monthNet(mean,lev,t);return b}
function requiredMonthly(set,b0){const i=set.ret/100/12,n=set.years*12;if(!i)return(set.goal-b0)/n;const f=Math.pow(1+i,n);return(set.goal-b0*f)*i/(f-1)}
// Bootstrap simulation: each future month replays a random past month (income and all categories together),
// so the real ups and downs (surgery, phone, Tet) are kept. Fixed seed = same answer on every refresh.
function simulate(stats,lev,set,b0,sims=1000){
  const n=set.years*12,i=set.ret/100/12,paths=Array.from({length:n},()=>new Float64Array(sims));let hit=0,rnd=mulberry32(20261102);
  const nets=stats.map(o=>Array.from({length:n},(_,t)=>monthNet(o,lev,t)));
  for(let s=0;s<sims;s++){let b=b0;for(let t=0;t<n;t++){b=b*(1+i)+nets[Math.floor(rnd()*stats.length)][t];paths[t][s]=b}if(b>=set.goal)hit++}
  const pct=q=>paths.map(a=>{const x=Array.from(a).sort((p,r)=>p-r);return x[Math.min(sims-1,Math.floor(q*sims))]});
  return{p10:pct(.1),p50:pct(.5),p90:pct(.9),prob:hit/sims};
}
function mulberry32(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
// Smallest cuts (Unexpected first, then Meal, Fixed, then income growth) that give at least a 70% chance.
const PLAN_TARGET_PROB=.7;
function suggestPlan(stats,set,b0){
  const lev={unexpected:0,meal:0,fixed:0,income:0},ok=()=>simulate(stats,lev,set,b0,400).prob>=PLAN_TARGET_PROB;
  for(const[k,,step,max]of PLAN_KEYS.concat([["income","Income",1,15]])){while(!ok()&&lev[k]<max)lev[k]+=step}
  return{lev,reachable:ok()};
}
function startBalance(){return savingRows.length?savingBalanceUpTo(null).total:0}
function addMonths(m,k){const[y,mo]=m.split("-").map(Number);return monthKey(new Date(y,mo-1+k,1))}

function renderPlan(){
  const stats=monthStats();
  if(stats.length<3){$("planBody").hidden=true;$("planEmpty").hidden=false;return}
  $("planBody").hidden=false;$("planEmpty").hidden=true;
  const set=planSettings,b0=startBalance(),mean=meanOf(stats),need=requiredMonthly(set,b0),n=set.years*12,start=currentPeriod(),end=addMonths(start,n-1);
  const sugg=suggestPlan(stats,set,b0),base=simulate(stats,{unexpected:0,meal:0,fixed:0,income:0},set,b0),plan=simulate(stats,planLevers,set,b0);
  const planMean=PLAN_KEYS.reduce((a,[k,c])=>a+mean[c]*planLevers[k]/100,0);   // money freed per month by the cuts
  $("planGoalLabel").textContent=`${formatMoney(set.goal)} by ${formatMonth(end)}`;
  $("planStart").textContent=formatMoney(b0);
  $("planNeed").textContent=formatMoney(need);
  $("planNeedMeta").textContent=set.ret?`a month, if savings earn ${set.ret}% a year`:"a month, with no interest";
  $("planNow").textContent=formatMoney(mean.net);$("planNow").className=mean.net<need?"negative":"positive";
  $("planNowMeta").textContent=`average of ${stats.length} full months (typical month ${formatMoney(median(stats.map(o=>o.net)))})`;
  $("planGap").textContent=need>mean.net?formatMoney(need-mean.net):"On track";$("planGap").className=need>mean.net?"negative":"positive";
  $("planProbBase").textContent=`${Math.round(base.prob*100)}%`;
  $("planProbPlan").textContent=`${Math.round(plan.prob*100)}%`;$("planProbPlan").className=plan.prob>=PLAN_TARGET_PROB?"positive":"negative";
  $("planProbMeta").textContent=`with your plan · ${Math.round(base.prob*100)}% if nothing changes`;
  // levers
  PLAN_KEYS.forEach(([k,c])=>{$(`lev_${k}`).value=planLevers[k];$(`lev_${k}_val`).textContent=`−${planLevers[k]}%`;$(`lev_${k}_meta`).textContent=`${formatMoney(mean[c])} → ${formatMoney(mean[c]*(1-planLevers[k]/100))} a month (+${formatMoney(mean[c]*planLevers[k]/100)})`});
  $("lev_income").value=planLevers.income;$("lev_income_val").textContent=`+${planLevers.income}%/yr`;
  $("lev_income_meta").textContent=`${formatMoney(mean.income)} now → ${formatMoney(mean.income*Math.pow(1+planLevers.income/100,set.years-1))} a month in year ${set.years}`;
  $("planSuggestNote").textContent=sugg.reachable?`Suggested for a ${PLAN_TARGET_PROB*100}%+ chance: Unexpected −${sugg.lev.unexpected}%, Meal −${sugg.lev.meal}%, Fixed −${sugg.lev.fixed}%, income +${sugg.lev.income}%/yr.`:"Even the maximum cuts do not reach the goal; consider a longer timeline or a lower goal.";
  // chart: projected balance
  const labels=Array.from({length:n},(_,t)=>formatMonthShort(addMonths(start,t)));
  fanChart($("planChart"),labels,plan,base.p50,set.goal);
  // stats table
  const rowsDef=[["Income","income"],["Fixed","Fixed"],["Meal","Meal"],["Unexpected","Unexpected"],["Other / uncategorized","Other"],["Total expense","expense"],["Income − Expense","net"]];
  $("planStatsBody").innerHTML=rowsDef.filter(([,k])=>k!=="Other"||mean.Other>0).map(([label,k])=>{
    const v=stats.map(o=>o[k]),lev=PLAN_KEYS.find(([,c])=>c===k),budget=budgets[k];
    const target=lev?mean[k]*(1-planLevers[lev[0]]/100):k==="income"?mean.income*Math.pow(1+planLevers.income/100,1):k==="expense"?mean.expense-planMean:k==="net"?mean.net+planMean:mean[k];
    const worst=k==="income"||k==="net"?Math.min(...v):Math.max(...v),wm=stats[v.indexOf(worst)].month;
    return`<tr class="${k==="expense"||k==="net"?"row-total":""}"><td>${label}</td><td class="num">${formatMoney(mean[k])}</td><td class="num">${formatMoney(median(v))}</td><td class="num">±${formatMoney(sd(v))}</td><td class="num ${k==="net"&&worst<0?"negative":""}">${formatMoney(worst)} <small class="muted">${formatMonthShort(wm)}</small></td><td class="num">${budget?formatMoney(budget):"—"}</td><td class="num"><strong>${formatMoney(target)}</strong></td></tr>`;
  }).join("");
  $("planStatsNote").textContent=`Based on ${stats.length} full months (${formatMonthShort(stats[0].month)}–${formatMonthShort(stats[stats.length-1].month)}). "Swing" = standard deviation: how far a typical month moves from the average. "Worst month" = lowest income/result or highest spending.`;
  // where the swings come from
  barChart($("planSwingChart"),stats.map(o=>formatMonthShort(o.month)),["Fixed","Meal","Unexpected"].map(c=>({name:c,color:entityColor(c),data:stats.map(o=>o[c])})),{segmentLabels:false});
  renderPlanActions(stats,mean,need,plan,base,sugg,end);
}
function renderPlanActions(stats,mean,need,plan,base,sugg,end){
  const months=new Set(stats.map(o=>o.month)),byItem=new Map();
  transactions.filter(r=>r.type==="Expense"&&months.has(r.month)).forEach(r=>{const k=`${r.category}|${r.item||"—"}`;byItem.set(k,(byItem.get(k)||0)+r.amount)});
  const topItems=cat=>[...byItem.entries()].filter(([k])=>k.startsWith(cat+"|")).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${esc(k.split("|")[1])} ${formatMoney(v/stats.length)}`).join(", ");
  const items=[];
  items.push(`<strong>Pay yourself first:</strong> on salary day (the 23rd) move <strong>${formatMoney(need)}</strong> to savings before spending, split ${savingBuckets.map(b=>`${esc(b.name)} ${b.percent}%`).join(" · ")||"by your bucket targets"}.`);
  PLAN_KEYS.forEach(([k,c])=>{const p=planLevers[k];if(!p)return;
    items.push(`<strong>${c}: −${p}%</strong> — from ${formatMoney(mean[c])} to <strong>${formatMoney(mean[c]*(1-p/100))}</strong> a month (+${formatMoney(mean[c]*p/100)} saved). Biggest items now: ${topItems(c)}.`)});
  if(planLevers.income)items.push(`<strong>Income +${planLevers.income}% a year</strong> — raise, bonus or side income; about +${formatMoney(mean.income*planLevers.income/100)} a month from year 2.`);
  const spikes=stats.filter(o=>o.net<0);
  if(spikes.length)items.push(`<strong>Plan the big one-offs:</strong> ${spikes.map(o=>`${formatMonthShort(o.month)} (${formatMoney(o.net)})`).join(", ")} wiped out ${Math.round(-spikes.reduce((a,o)=>a+o.net,0)/Math.max(1,stats.filter(o=>o.net>0).reduce((a,o)=>a+o.net,0))*100)}% of the other months' savings. Keep the Emergency bucket for these instead of pausing savings.`);
  if(!PLAN_KEYS.some(([k])=>planLevers[k])&&!planLevers.income)items.push(`Move the sliders, or press <strong>Use suggested plan</strong>. ${esc($("planSuggestNote").textContent)}`);
  $("planActions").innerHTML=items.map(x=>`<li>${x}</li>`).join("");
  $("planVerdict").textContent=plan.prob>=PLAN_TARGET_PROB
    ?`With this plan, the typical outcome is ${formatMoney(plan.p50[plan.p50.length-1])} by ${formatMonth(end)} — a ${Math.round(plan.prob*100)}% chance of reaching ${formatMoney(planSettings.goal)}.`
    :`Not there yet: the typical outcome is ${formatMoney(plan.p50[plan.p50.length-1])} by ${formatMonth(end)} (${Math.round(plan.prob*100)}% chance). Increase the cuts or use the suggested plan.`;
  $("planVerdict").className=`plan-verdict ${plan.prob>=PLAN_TARGET_PROB?"ok":"bad"}`;
}
function median(v){const x=v.slice().sort((a,b)=>a-b),m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2}
function sd(v){const m=v.reduce((a,b)=>a+b,0)/v.length;return Math.sqrt(v.reduce((a,b)=>a+(b-m)**2,0)/v.length)}
function bindPlanControls(){
  PLAN_KEYS.concat([["income"]]).forEach(([k])=>$(`lev_${k}`).addEventListener("input",e=>{planLevers[k]=Number(e.target.value);savePlan();renderPlanDebounced()}));
  [["planGoalInput","goal",1e6],["planYearsInput","years",1],["planReturnInput","ret",1]].forEach(([id,k,mul])=>{
    $(id).value=planSettings[k]/mul;
    $(id).addEventListener("change",e=>{const v=Number(e.target.value);if(v>0||(k==="ret"&&v>=0)){planSettings[k]=v*mul;savePlan();renderPlan()}});
  });
  $("planSuggest").addEventListener("click",()=>{const stats=monthStats();if(stats.length<3)return;planLevers={...suggestPlan(stats,planSettings,startBalance()).lev};savePlan();renderPlan()});
  $("planReset").addEventListener("click",()=>{planLevers={unexpected:0,meal:0,fixed:0,income:0};savePlan();renderPlan()});
}
const renderPlanDebounced=debounce(()=>renderPlan(),60);

// ---------------------------------------------------------------- chart rendering

function renderVisibleCharts(){
  if($("dashboardPage").classList.contains("active")){renderIncomeChart();renderExpenseChart();renderItemPie(selectedRows())}
  if($("savingsPage").classList.contains("active")){renderWaterfall();renderSavingsCharts()}
  if($("planPage").classList.contains("active")){renderPlan()}
}
function renderIncomeChart(){const s=monthlySummary();barChart($("incomeChart"),s.map(([m])=>formatMonthShort(m)),[{name:"Albert",color:entityColor("Albert"),data:s.map(([,x])=>x.Albert)},{name:"Annie",color:entityColor("Annie"),data:s.map(([,x])=>x.Annie)}])}
function renderExpenseChart(){const s=monthlySummary();lineChart($("expenseChart"),s.map(([m])=>formatMonthShort(m)),s.map(([,x])=>x.expense),COLORS.neg)}
function renderWaterfall(){const rows=rowsForSavingsSelection(),income=sum(rows,"Income"),expense=sum(rows,"Expense"),saving=income-expense;waterfallChart($("waterfallChart"),income,expense,saving)}

// Tooltip: any SVG/HTML element with data-tip shows it on hover.
document.addEventListener("mousemove",e=>{
  const tip=$("tooltip");if(!tip)return;
  const el=e.target.closest?.("[data-tip]");
  if(!el){tip.style.display="none";return}
  tip.textContent=el.getAttribute("data-tip");tip.style.display="block";
  const x=Math.min(e.clientX+14,window.innerWidth-tip.offsetWidth-8),y=Math.min(e.clientY+14,window.innerHeight-tip.offsetHeight-8);
  tip.style.left=`${x}px`;tip.style.top=`${y}px`;
});

function svgEl(tag,attrs={}){const e=document.createElementNS("http://www.w3.org/2000/svg",tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e}
function setupSVG(el){el.innerHTML="";if(!el.clientWidth||!el.clientHeight)return null;const svg=svgEl("svg",{viewBox:`0 0 ${el.clientWidth} ${el.clientHeight}`,class:"svg-chart",preserveAspectRatio:"none"});el.appendChild(svg);return{svg,w:el.clientWidth,h:el.clientHeight}}
// Bar path with square corners (r=0). A radius can still be passed if ever wanted.
function barPath(x,y,w,h,up=true,r=0){if(h<=0)return"";r=Math.min(r,w/2,h);return up
  ?`M${x},${y+h}V${y+r}Q${x},${y} ${x+r},${y}H${x+w-r}Q${x+w},${y} ${x+w},${y+r}V${y+h}Z`
  :`M${x},${y}H${x+w}V${y+h-r}Q${x+w},${y+h} ${x+w-r},${y+h}H${x+r}Q${x},${y+h} ${x},${y+h-r}Z`}
// Round axis steps (1, 2, 2.5, 5 × 10ⁿ) so ticks read 0 / 10M / 20M instead of odd values.
function niceScale(lo,hi,count=4){if(hi<=lo)hi=lo+1;const raw=(hi-lo)/count,mag=Math.pow(10,Math.floor(Math.log10(raw))),f=raw/mag,step=(f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*mag;return{lo:Math.floor(lo/step)*step,hi:Math.ceil(hi/step)*step,step}}
function gridY(svg,L,R,w,T,ph,sc){const n=Math.max(1,Math.round((sc.hi-sc.lo)/sc.step));for(let k=0;k<=n;k++){const v=sc.hi-sc.step*k,y=T+ph*k/n;svg.appendChild(svgEl("line",{x1:L,y1:y,x2:w-R,y2:y,class:"grid-line"}));addText(svg,axisMoney(v),L-8,y+4,"axis-text","end")}}
function legend(svg,items,x,y){let lx=x;items.forEach(it=>{svg.appendChild(svgEl("rect",{x:lx,y:y-9,width:10,height:10,fill:it.color}));addText(svg,it.name,lx+15,y,"legend-text","start");lx+=it.name.length*7+34})}
// Month labels under the axis, thinned so they never overlap (about 42px per label).
function xLabels(svg,labels,xAt,h){
  const n=labels.length,span=n>1?Math.abs(xAt(n-1)-xAt(0)):0,fit=Math.max(2,Math.floor(span/42)+1),every=Math.max(1,Math.ceil(n/fit)),last=n-1;
  labels.forEach((lab,i)=>{if((i%every===0&&last-i>=every*.9)||i===last)addText(svg,lab,xAt(i),h-14,"axis-text",n>1&&i===last&&every>1?"end":"middle")});
}

function barChart(el,labels,series,opts={}){
  const s=setupSVG(el);if(!s)return;if(!labels.length)return empty(el);const{svg,w,h}=s,L=48,R=12,T=40,B=42,pw=w-L-R,ph=h-T-B;
  const totals=labels.map((_,i)=>series.reduce((a,x)=>a+(x.data[i]||0),0)),sc=niceScale(0,Math.max(...totals,1)*1.1),max=sc.hi;
  gridY(svg,L,R,w,T,ph,sc);
  const gw=pw/labels.length,bw=Math.min(40,gw*.58);
  labels.forEach((lab,i)=>{
    let base=0;
    series.forEach((ser,j)=>{const v=ser.data[i]||0;if(v<=0)return;const hh=v/max*ph,y=T+ph-(base+v)/max*ph,gap=base>0?2:0;
      svg.appendChild(svgEl("path",{d:barPath(L+i*gw+(gw-bw)/2,y,bw,Math.max(hh-gap,0),true),fill:ser.color,"data-tip":`${lab} · ${ser.name}: ${formatMoney(v)}`}));
      if(opts.segmentLabels!==false&&hh>20)addText(svg,formatMoney(v),L+i*gw+gw/2,y+hh/2+4,labelOn(ser.color),"middle");base+=v});
    if(totals[i]>0)addText(svg,formatMoney(totals[i]),L+i*gw+gw/2,T+ph-totals[i]/max*ph-8,"data-label","middle");
  });
  xLabels(svg,labels,i=>L+i*gw+gw/2,h);
  if(series.length>1)legend(svg,series,L,17);
}
function lineChart(el,labels,data,color){
  const s=setupSVG(el);if(!s)return;if(!labels.length)return empty(el);const{svg,w,h}=s,L=48,R=18,T=34,B=42,pw=w-L-R,ph=h-T-B,sc=niceScale(0,Math.max(...data,1)*1.1),max=sc.hi;
  gridY(svg,L,R,w,T,ph,sc);
  const xAt=i=>L+(labels.length===1?pw/2:i*pw/(labels.length-1)),pts=data.map((v,i)=>[xAt(i),T+ph-v/max*ph]);
  svg.appendChild(svgEl("polyline",{points:pts.map(p=>p.join(",")).join(" "),fill:"none",stroke:color,"stroke-width":2,"stroke-linejoin":"round"}));
  pts.forEach((p,i)=>{svg.appendChild(svgEl("circle",{cx:p[0],cy:p[1],r:4,fill:color,stroke:"#fff","stroke-width":2}));addText(svg,formatMoney(data[i]),p[0],p[1]-10,"data-label","middle");
    svg.appendChild(svgEl("circle",{cx:p[0],cy:p[1],r:14,fill:"transparent","data-tip":`${labels[i]}: ${formatMoney(data[i])}`}))});
  xLabels(svg,labels,xAt,h);
}
// Bars above/below zero. Single series colors by sign; with opts.down it draws two series (ups and downs).
function divergingBarChart(el,labels,values,opts={}){
  const s=setupSVG(el);if(!s)return;if(!labels.length)return empty(el);const{svg,w,h}=s,L=52,R=14,T=36,B=40,pw=w-L-R,ph=h-T-B;
  const down=opts.down||null,all=values.concat(down||[]),sc=niceScale(Math.min(...all,0)*1.12,Math.max(...all,0,1)*1.12),hi=sc.hi,lo=sc.lo,range=hi-lo,y=v=>T+(hi-v)/range*ph;
  gridY(svg,L,R,w,T,ph,sc);
  svg.appendChild(svgEl("line",{x1:L,y1:y(0),x2:w-R,y2:y(0),class:"axis-line"}));
  const gw=pw/labels.length,bw=Math.min(34,gw*.56),few=labels.length<=12;
  const draw=(v,i,color,name)=>{if(!v)return;const up=v>0,y0=y(0),y1=y(v),top=Math.min(y0,y1),hh=Math.abs(y1-y0),x=L+i*gw+(gw-bw)/2;
    svg.appendChild(svgEl("path",{d:barPath(x,top,bw,hh,up),fill:color,"data-tip":`${labels[i]} · ${name}: ${formatMoney(v)}`}));
    if(few||v===Math.max(...values)||v===Math.min(...values))addText(svg,formatMoney(v),x+bw/2,up?top-6:top+hh+13,"data-label","middle")};
  if(down){values.forEach((v,i)=>draw(v,i,COLORS.s1,opts.upName));down.forEach((v,i)=>draw(v,i,COLORS.neg,opts.downName));legend(svg,[{name:opts.upName,color:COLORS.s1},{name:opts.downName,color:COLORS.neg}],L,16)}
  else{values.forEach((v,i)=>draw(v,i,v<0?COLORS.neg:COLORS.s1,opts.tipLabel||""));legend(svg,[{name:"Saved",color:COLORS.s1},{name:"Overspent",color:COLORS.neg}],L,16)}
  if(opts.avg!=null){const ya=y(opts.avg);svg.appendChild(svgEl("line",{x1:L,y1:ya,x2:w-R,y2:ya,class:"ref-line"}));addText(svg,`── ${opts.avgLabel||"avg"}: ${formatMoney(opts.avg)}`,w-R,16,"ref-label","end")}
  xLabels(svg,labels,i=>L+i*gw+gw/2,h);
}
function areaLineChart(el,labels,values,opts={}){
  const s=setupSVG(el);if(!s)return;if(!labels.length)return empty(el);const{svg,w,h}=s,L=52,R=18,T=30,B=40,pw=w-L-R,ph=h-T-B;
  const sc=niceScale(Math.min(...values,0),Math.max(...values,1)*1.1),hi=sc.hi,lo=sc.lo,range=hi-lo,y=v=>T+(hi-v)/range*ph,xAt=i=>L+(labels.length===1?pw/2:i*pw/(labels.length-1));
  gridY(svg,L,R,w,T,ph,sc);
  const pts=values.map((v,i)=>[xAt(i),y(v)]);
  svg.appendChild(svgEl("path",{d:`M${pts[0][0]},${y(Math.max(lo,0))}`+pts.map(p=>`L${p[0]},${p[1]}`).join("")+`L${pts[pts.length-1][0]},${y(Math.max(lo,0))}Z`,fill:opts.color,"fill-opacity":.14}));
  svg.appendChild(svgEl("polyline",{points:pts.map(p=>p.join(",")).join(" "),fill:"none",stroke:opts.color,"stroke-width":2,"stroke-linejoin":"round"}));
  const iMax=values.indexOf(Math.max(...values)),iLast=values.length-1;
  pts.forEach((p,i)=>{svg.appendChild(svgEl("circle",{cx:p[0],cy:p[1],r:4,fill:opts.color,stroke:"#fff","stroke-width":2}));
    if(i===iMax||i===iLast)addText(svg,formatMoney(values[i]),p[0],p[1]-10,"data-label",i===iLast&&i>0?"end":"middle");
    const prev=i?values[i]-values[i-1]:null;
    svg.appendChild(svgEl("circle",{cx:p[0],cy:p[1],r:14,fill:"transparent","data-tip":`${labels[i]} · ${opts.tipLabel}: ${formatMoney(values[i])}${prev!=null?` (${prev>=0?"+":""}${formatMoney(prev)} vs month before)`:""}`}))});
  xLabels(svg,labels,xAt,h);
}
function sparkArea(el,labels,values,opts){
  const s=setupSVG(el);if(!s)return;const{svg,w,h}=s,L=4,R=4,T=8,B=18,pw=w-L-R,ph=h-T-B,range=(opts.hi-opts.lo)||1,y=v=>T+(opts.hi-v)/range*ph,xAt=i=>L+(values.length===1?pw/2:i*pw/(values.length-1));
  svg.appendChild(svgEl("line",{x1:L,y1:y(0),x2:w-R,y2:y(0),class:"axis-line"}));
  const pts=values.map((v,i)=>[xAt(i),y(v)]);
  svg.appendChild(svgEl("path",{d:`M${pts[0][0]},${y(0)}`+pts.map(p=>`L${p[0]},${p[1]}`).join("")+`L${pts[pts.length-1][0]},${y(0)}Z`,fill:COLORS.s3,"fill-opacity":.16}));
  svg.appendChild(svgEl("polyline",{points:pts.map(p=>p.join(",")).join(" "),fill:"none",stroke:COLORS.s3,"stroke-width":2,"stroke-linejoin":"round"}));
  pts.forEach((p,i)=>svg.appendChild(svgEl("circle",{cx:p[0],cy:p[1],r:10,fill:"transparent","data-tip":`${opts.name} · ${labels[i]}: ${formatMoney(values[i])}`})));
  addText(svg,labels[0],L,h-4,"axis-text","start");addText(svg,labels[labels.length-1],w-R,h-4,"axis-text","end");
}
// Projection fan: 80% range band, plan median, no-change median and the goal line.
function fanChart(el,labels,plan,base50,goal){
  const s=setupSVG(el);if(!s)return;const{svg,w,h}=s,L=56,R=18,T=40,B=40,pw=w-L-R,ph=h-T-B;
  const all=plan.p10.concat(plan.p90,base50,[goal,0]),sc=niceScale(Math.min(...all),Math.max(...all)*1.05),hi=sc.hi,lo=sc.lo,range=hi-lo,y=v=>T+(hi-v)/range*ph,xAt=i=>L+i*pw/(labels.length-1);
  gridY(svg,L,R,w,T,ph,sc);
  if(lo<0)svg.appendChild(svgEl("line",{x1:L,y1:y(0),x2:w-R,y2:y(0),class:"axis-line"}));
  const line=a=>a.map((v,i)=>`${xAt(i)},${y(v)}`).join(" ");
  svg.appendChild(svgEl("polygon",{points:line(plan.p90)+" "+plan.p10.map((v,i)=>`${xAt(i)},${y(v)}`).reverse().join(" "),fill:COLORS.s1,"fill-opacity":.14}));
  const gy=y(goal);svg.appendChild(svgEl("line",{x1:L,y1:gy,x2:w-R,y2:gy,class:"goal-line"}));addText(svg,`Goal ${formatMoney(goal)}`,L+6,gy-6,"ref-label","start");
  svg.appendChild(svgEl("polyline",{points:line(base50),fill:"none",stroke:COLORS.ref,"stroke-width":2}));
  svg.appendChild(svgEl("polyline",{points:line(plan.p50),fill:"none",stroke:COLORS.s1,"stroke-width":2.5}));
  const n=labels.length-1;
  addText(svg,formatMoney(plan.p50[n]),xAt(n),y(plan.p50[n])-8,"data-label","end");
  addText(svg,formatMoney(base50[n]),xAt(n),y(base50[n])+16,"axis-text","end");
  legend(svg,[{name:"With plan (typical)",color:COLORS.s1},{name:"80% of outcomes",color:"rgba(3,83,164,.25)"},{name:"No change (typical)",color:COLORS.ref}],L,16);
  xLabels(svg,labels,xAt,h);
  // crosshair hover
  const cross=svgEl("line",{y1:T,y2:T+ph,class:"crosshair",visibility:"hidden"});svg.appendChild(cross);
  const hit=svgEl("rect",{x:L,y:T,width:pw,height:ph,fill:"transparent"});svg.appendChild(hit);
  hit.addEventListener("mousemove",e=>{const r=svg.getBoundingClientRect(),px=(e.clientX-r.left)*(w/r.width),i=Math.max(0,Math.min(n,Math.round((px-L)/(pw/n))));
    cross.setAttribute("x1",xAt(i));cross.setAttribute("x2",xAt(i));cross.setAttribute("visibility","visible");
    hit.setAttribute("data-tip",`${labels[i]}\nWith plan: ${formatMoney(plan.p50[i])} (range ${formatMoney(plan.p10[i])} – ${formatMoney(plan.p90[i])})\nNo change: ${formatMoney(base50[i])}`)});
  hit.addEventListener("mouseleave",()=>cross.setAttribute("visibility","hidden"));
}
function pieChart(el,data){
  const s=setupSVG(el);if(!s)return;if(!data.length)return empty(el);const{svg,w,h}=s,cx=w/2,cy=h/2,r=Math.min(w,h)*.34,total=data.reduce((a,x)=>a+x.amount,0);let angle=-Math.PI/2;
  data.forEach((x,i)=>{const a=x.amount/total*Math.PI*2,end=angle+a-(data.length>1?0.0001:0),x1=cx+r*Math.cos(angle),y1=cy+r*Math.sin(angle),x2=cx+r*Math.cos(end),y2=cy+r*Math.sin(end),large=a>Math.PI?1:0;
    const d=data.length===1?`M ${cx-r} ${cy} A ${r} ${r} 0 1 1 ${cx+r} ${cy} A ${r} ${r} 0 1 1 ${cx-r} ${cy} Z`:`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
    svg.appendChild(svgEl("path",{d,fill:pieColor(x,i),stroke:"#fff","stroke-width":2,"data-tip":`${x.item}: ${formatMoney(x.amount)} (${x.percent.toFixed(1)}%)`}));
    const mid=angle+a/2,lr=r*.66;if(x.percent>=6)addText(svg,`${x.percent.toFixed(1)}%`,cx+lr*Math.cos(mid),cy+lr*Math.sin(mid)+4,labelOn(pieColor(x,i)),"middle");angle+=a;});
}
// Dark text on the light fills (Cool Steel, light grey), white text on the dark ones.
function labelOn(color){return[COLORS.s2,COLORS.other].includes(color)?"data-label":"data-label-light"}
function pieColor(x,i){return x.item==="Others"?COLORS.other:CATEGORICAL[i%CATEGORICAL.length]}
function waterfallChart(el,income,expense,saving){
  const s=setupSVG(el);if(!s)return;const{svg,w,h}=s,L=52,R=18,T=40,B=48,pw=w-L-R,ph=h-T-B;const sc=niceScale(Math.min(saving,0)*1.1,Math.max(income,saving,1)*1.1),max=sc.hi,min=sc.lo,range=max-min;
  gridY(svg,L,R,w,T,ph,sc);
  const labels=["Income","Expense","Net Savings"],gw=pw/3,bw=Math.min(90,gw*.45),x=i=>L+i*gw+(gw-bw)/2,y=v=>T+(max-v)/range*ph;
  const zeroY=y(0),incomeY=y(income),savingY=y(saving);
  svg.appendChild(svgEl("path",{d:barPath(x(0),incomeY,bw,Math.abs(zeroY-incomeY)),fill:COLORS.s1,"data-tip":`Income: ${formatMoney(income)}`}));
  const ey=Math.min(incomeY,savingY),eh=Math.abs(savingY-incomeY);svg.appendChild(svgEl("rect",{x:x(1),y:ey,width:bw,height:Math.max(eh,2),fill:COLORS.neg,"data-tip":`Expense: ${formatMoney(expense)}`}));
  const sy=Math.min(zeroY,savingY),sh=Math.abs(zeroY-savingY);svg.appendChild(svgEl("path",{d:barPath(x(2),sy,bw,Math.max(sh,2),saving>=0),fill:saving<0?COLORS.neg:COLORS.s3,"data-tip":`Net: ${formatMoney(saving)}`}));
  svg.appendChild(svgEl("line",{x1:L,y1:zeroY,x2:w-R,y2:zeroY,class:"axis-line"}));
  svg.appendChild(svgEl("line",{x1:x(0)+bw,y1:incomeY,x2:x(1),y2:incomeY,class:"connector-line"}));svg.appendChild(svgEl("line",{x1:x(1)+bw,y1:savingY,x2:x(2),y2:savingY,class:"connector-line"}));
  addText(svg,formatMoney(income),x(0)+bw/2,incomeY-9,"data-label","middle");addText(svg,`-${formatMoney(expense)}`,x(1)+bw/2,ey+eh/2+4,"data-label-light","middle");addText(svg,formatMoney(saving),x(2)+bw/2,saving>=0?savingY-9:savingY+16,"data-label","middle");
  labels.forEach((lab,i)=>addText(svg,lab,x(i)+bw/2,h-15,"axis-text","middle"));
}
function addText(svg,text,x,y,cls,anchor){const t=svgEl("text",{x,y,class:cls,"text-anchor":anchor});t.textContent=text;svg.appendChild(t)}
function empty(el){el.innerHTML=`<div class="empty-state">No data for this period.</div>`}
function formatMoney(n){const sign=n<0?"-":"",v=Math.abs(n);if(v>=1e9)return sign+(v/1e9).toFixed(v%1e9?2:0).replace(/\.?0+$/,"")+"B";if(v>=1e6)return sign+(v/1e6).toFixed(v%1e6?1:0)+"M";if(v>=1e3)return sign+(v/1e3).toFixed(v%1e3?1:0)+"K";return sign+Math.round(v).toLocaleString("en-US")}
function axisMoney(n){const v=Math.abs(n);return(n<0?"-":"")+(v>=1e9?(v/1e9).toFixed(1)+"B":v>=1e6?(v/1e6).toFixed(v>=1e7?0:1)+"M":v>=1e3?(v/1e3).toFixed(0)+"K":Math.round(v))}
function formatMonth(m){if(!/^\d{4}-\d{2}$/.test(m))return m;const[y,mo]=m.split("-").map(Number);return new Date(y,mo-1,1).toLocaleDateString("en-US",{month:"long",year:"numeric"})}
function formatMonthShort(m){if(!/^\d{4}-\d{2}$/.test(m))return m;const[y,mo]=m.split("-").map(Number);return new Date(y,mo-1,1).toLocaleDateString("en-US",{month:"short",year:"2-digit"})}
function formatDate(d){return d?d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):"—"}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function setDataStatus(text,cls){$("dataStatus").textContent=text;$("dataStatus").className=`data-status ${cls}`}
function showMessage(t){$("statusMessage").textContent=t;$("statusMessage").hidden=false}function hideMessage(){$("statusMessage").hidden=true}
function formatTime(ts){return new Date(ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
function debounce(fn,ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}
