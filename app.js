'use strict';

const CONFIG = {
  sheetCsvUrl: 'https://docs.google.com/spreadsheets/d/1gAr4O_sTA6L68ThUHqcrmiruMe2aP_Oh39khKwVcOt8/export?format=csv&gid=1116776327',
  totalBudget: 19_000_000,
  categoryBudgets: { Meal: 4_000_000, Unexpected: 1_000_000 },
  allocations: [
    ['Investment', 15],
    ['Kids', 10],
    ['Education', 25],
    ['Emergency', 20],
    ['Saving', 30],
  ],
  palette: ['#81B29A', '#E07A5F', '#3D405B', '#F2CC8F', '#6E809E', '#A7A79A'],
};

let transactions = [];
let selectedMonth = '';
let charts = {};

const $ = (id) => document.getElementById(id);

window.addEventListener('DOMContentLoaded', () => {
  bindNavigation();
  $('refreshButton').addEventListener('click', loadData);
  $('monthSelect').addEventListener('change', (event) => {
    selectedMonth = event.target.value;
    renderAll();
  });
  $('transactionSearch').addEventListener('input', renderAllTransactions);
  loadData();
});

function bindNavigation() {
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => showPage(button.dataset.page));
  });
  document.querySelectorAll('[data-go]').forEach((button) => {
    button.addEventListener('click', () => showPage(button.dataset.go));
  });
}

function showPage(page) {
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.page === page));
  document.querySelectorAll('.page').forEach((section) => section.classList.remove('active'));
  $(`${page}Page`).classList.add('active');
  $('pageTitle').textContent = page.charAt(0).toUpperCase() + page.slice(1);
  setTimeout(resizeCharts, 20);
}

async function loadData() {
  setStatus('Loading Google Sheets data…', false);
  try {
    const response = await fetch(`${CONFIG.sheetCsvUrl}&cache=${Date.now()}`);
    if (!response.ok) throw new Error(`Google Sheets returned ${response.status}`);
    const csv = await response.text();
    transactions = parseTransactions(csv);
    if (!transactions.length) throw new Error('No valid transaction rows were found.');
    populateMonthFilter();
    $('lastUpdated').textContent = `Last updated: ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`;
    setStatus('', true);
    renderAll();
  } catch (error) {
    console.error(error);
    setStatus('Could not load the Google Sheet. Confirm that “Anyone with the link” has Viewer access, then refresh.', false);
  }
}

function parseTransactions(csv) {
  const rows = Papa.parse(csv, { skipEmptyLines: false }).data;
  const headerIndex = rows.findIndex((row) => row.some((cell) => String(cell).trim().toLowerCase() === 'month') && row.some((cell) => String(cell).trim().toLowerCase() === 'amount'));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map((value) => String(value).trim().toLowerCase());
  return rows.slice(headerIndex + 1).map((row) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']));
    const amount = toNumber(record.amount);
    const date = parseDate(record.actual || record.date);
    const monthKey = normalizeMonth(record.month, date);
    return {
      month: monthKey,
      date,
      type: titleCase(record.type),
      category: titleCase(record.category === '0' ? 'Income' : record.category),
      item: String(record.items || '').trim(),
      amount,
      description: String(record.description || '').trim(),
    };
  }).filter((row) => row.amount > 0 && row.type);
}

function toNumber(value) {
  return Number(String(value ?? '').replace(/[^0-9.-]/g, '')) || 0;
}

function parseDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const parts = text.split(/[\/-]/).map(Number);
  if (parts.length === 3) {
    const [month, day, year] = parts;
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeMonth(monthCode, date) {
  const match = String(monthCode || '').match(/A?(\d{2})(\d{2})/i);
  if (match) return `20${match[1]}-${match[2]}`;
  if (date) return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  return 'Unknown';
}

function titleCase(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function populateMonthFilter() {
  const months = [...new Set(transactions.map((row) => row.month).filter((month) => month !== 'Unknown'))].sort();
  if (!months.length) return;
  if (!selectedMonth || !months.includes(selectedMonth)) selectedMonth = months[months.length - 1];
  $('monthSelect').innerHTML = months.slice().reverse().map((month) => `<option value="${month}" ${month === selectedMonth ? 'selected' : ''}>${formatMonth(month)}</option>`).join('');
}

function renderAll() {
  renderDashboard();
  renderAllTransactions();
  renderSavings();
  resizeCharts();
}

function getSelectedRows() { return transactions.filter((row) => row.month === selectedMonth); }
function sum(rows, type) { return rows.filter((row) => !type || row.type.toLowerCase() === type.toLowerCase()).reduce((total, row) => total + row.amount, 0); }

function renderDashboard() {
  const rows = getSelectedRows();
  const income = sum(rows, 'Income');
  const expense = sum(rows, 'Expense');
  const savings = income - expense;
  const budgetLeft = CONFIG.totalBudget - expense;
  $('totalIncome').textContent = formatMoney(income);
  $('totalExpense').textContent = formatMoney(expense);
  $('netSavings').textContent = formatMoney(savings);
  $('savingRate').textContent = income ? `${(savings / income * 100).toFixed(1)}% saving rate` : 'No income recorded';
  $('budgetLeft').textContent = formatMoney(budgetLeft);
  $('budgetLeft').className = budgetLeft < 0 ? 'negative' : 'positive';
  $('budgetUsage').textContent = `${expense ? (expense / CONFIG.totalBudget * 100).toFixed(1) : '0.0'}% of budget used`;
  $('incomeMeta').textContent = formatMonth(selectedMonth);
  $('expenseMeta').textContent = formatMonth(selectedMonth);
  renderIncomeChart();
  renderExpenseTrendChart();
  renderCategoryBars(rows);
  renderBudgetTable(rows);
  renderRecentTransactions(rows);
}

function monthlySummary() {
  const map = new Map();
  transactions.forEach((row) => {
    if (!map.has(row.month)) map.set(row.month, { income: 0, expense: 0, Albert: 0, Annie: 0, Other: 0 });
    const month = map.get(row.month);
    if (row.type === 'Income') {
      month.income += row.amount;
      const person = /albert/i.test(`${row.item} ${row.description}`) ? 'Albert' : /annie/i.test(`${row.item} ${row.description}`) ? 'Annie' : 'Other';
      month[person] += row.amount;
    } else if (row.type === 'Expense') month.expense += row.amount;
  });
  return [...map.entries()].filter(([month]) => month !== 'Unknown').sort(([a], [b]) => a.localeCompare(b));
}

function renderIncomeChart() {
  const summary = monthlySummary();
  const chart = getChart('incomeChart');
  chart.setOption({
    color: ['#81B29A', '#3D405B', '#F2CC8F'],
    tooltip: { trigger: 'axis', valueFormatter: formatMoney },
    legend: { top: 10, data: ['Albert', 'Annie', 'Other'] },
    grid: { left: 55, right: 25, top: 55, bottom: 45 },
    xAxis: { type: 'category', data: summary.map(([month]) => formatMonthShort(month)), axisTick: { show: false }, axisLine: { lineStyle: { color: '#D8D3C4' } } },
    yAxis: { type: 'value', axisLabel: { formatter: axisMoney }, splitLine: { lineStyle: { color: '#E4DFD3' } } },
    series: ['Albert', 'Annie', 'Other'].map((person) => ({ name: person, type: 'bar', stack: 'income', barMaxWidth: 46, data: summary.map(([, values]) => values[person]) })),
  });
}

function renderExpenseTrendChart() {
  const summary = monthlySummary();
  const chart = getChart('expenseTrendChart');
  chart.setOption({
    color: ['#E07A5F'],
    tooltip: { trigger: 'axis', valueFormatter: formatMoney },
    grid: { left: 52, right: 22, top: 30, bottom: 45 },
    xAxis: { type: 'category', data: summary.map(([month]) => formatMonthShort(month)), axisTick: { show: false }, axisLine: { lineStyle: { color: '#D8D3C4' } } },
    yAxis: { type: 'value', axisLabel: { formatter: axisMoney }, splitLine: { lineStyle: { color: '#E4DFD3' } } },
    series: [{ type: 'line', smooth: false, symbolSize: 7, lineStyle: { width: 2 }, data: summary.map(([, values]) => values.expense), areaStyle: { opacity: .08 } }],
  });
}

function categoryData(rows) {
  const expenseRows = rows.filter((row) => row.type === 'Expense');
  const total = sum(expenseRows);
  const map = new Map();
  expenseRows.forEach((row) => map.set(row.category || 'Other', (map.get(row.category || 'Other') || 0) + row.amount));
  return [...map.entries()].map(([category, amount]) => ({ category, amount, percent: total ? amount / total * 100 : 0 })).sort((a, b) => b.amount - a.amount);
}

function renderCategoryBars(rows) {
  const data = categoryData(rows);
  $('categoryTotal').textContent = formatMoney(data.reduce((total, row) => total + row.amount, 0));
  $('categoryBars').innerHTML = data.length ? data.map((row, index) => `
    <div class="category-row">
      <span>${escapeHtml(row.category)}</span>
      <div class="category-track"><div class="category-fill" style="width:${Math.max(row.percent, 1)}%;background:${CONFIG.palette[index % CONFIG.palette.length]}"></div></div>
      <span class="category-percent">${row.percent.toFixed(1)}%</span>
      <span class="category-amount">${formatMoney(row.amount)}</span>
    </div>`).join('') : '<p>No expenses recorded for this month.</p>';
}

function renderBudgetTable(rows) {
  const data = categoryData(rows);
  const allocatedKnown = Object.values(CONFIG.categoryBudgets).reduce((a, b) => a + b, 0);
  const unassignedBudget = CONFIG.totalBudget - allocatedKnown;
  const budgetFor = (category) => CONFIG.categoryBudgets[category] ?? (category === 'Fixed' ? unassignedBudget : null);
  $('budgetTableBody').innerHTML = data.map((row) => {
    const budget = budgetFor(row.category);
    const left = budget == null ? null : budget - row.amount;
    return `<tr>
      <td>${escapeHtml(row.category)}</td>
      <td>${budget == null ? '—' : formatMoney(budget)}</td>
      <td>${formatMoney(row.amount)}</td>
      <td><span class="budget-progress"><span style="width:${Math.min(row.percent, 100)}%"></span></span>${row.percent.toFixed(1)}%</td>
      <td class="${left != null && left < 0 ? 'negative' : left != null ? 'positive' : ''}">${left == null ? '—' : formatMoney(left)}</td>
    </tr>`;
  }).join('') + `<tr><td><strong>Total</strong></td><td><strong>${formatMoney(CONFIG.totalBudget)}</strong></td><td><strong>${formatMoney(sum(rows, 'Expense'))}</strong></td><td><strong>100%</strong></td><td class="${CONFIG.totalBudget - sum(rows, 'Expense') < 0 ? 'negative' : 'positive'}"><strong>${formatMoney(CONFIG.totalBudget - sum(rows, 'Expense'))}</strong></td></tr>`;
}

function renderRecentTransactions(rows) {
  const latest = rows.slice().sort(sortByDateDesc).slice(0, 8);
  $('recentTableBody').innerHTML = latest.map(transactionRow).join('') || '<tr><td colspan="6">No transactions recorded.</td></tr>';
}

function transactionRow(row) {
  return `<tr><td>${formatDate(row.date)}</td><td class="type-${row.type.toLowerCase()}">${escapeHtml(row.type)}</td><td>${escapeHtml(row.item)}</td><td>${escapeHtml(row.category)}</td><td>${formatMoney(row.amount)}</td><td>${escapeHtml(row.description || '—')}</td></tr>`;
}

function renderAllTransactions() {
  const query = $('transactionSearch').value.trim().toLowerCase();
  const rows = getSelectedRows().filter((row) => !query || [row.type, row.category, row.item, row.description].some((value) => value.toLowerCase().includes(query))).sort(sortByDateDesc);
  $('allTransactionsBody').innerHTML = rows.map((row) => `<tr><td>${formatDate(row.date)}</td><td>${formatMonthShort(row.month)}</td><td class="type-${row.type.toLowerCase()}">${escapeHtml(row.type)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.item)}</td><td>${formatMoney(row.amount)}</td><td>${escapeHtml(row.description || '—')}</td></tr>`).join('') || '<tr><td colspan="7">No matching transactions.</td></tr>';
}

function renderSavings() {
  const rows = getSelectedRows();
  const income = sum(rows, 'Income');
  const expense = sum(rows, 'Expense');
  const available = income - expense;
  $('savingIncome').textContent = formatMoney(income);
  $('savingExpense').textContent = formatMoney(expense);
  $('savingAvailable').textContent = formatMoney(available);
  $('allocationList').innerHTML = CONFIG.allocations.map(([name, percent]) => `<div class="allocation-row"><span class="allocation-name">${name}</span><span class="allocation-percent">${percent}%</span><strong class="allocation-value">${formatMoney(Math.max(available, 0) * percent / 100)}</strong></div>`).join('');
  renderWaterfall(income, expense, available);
  renderSavingsTrend();
}

function renderWaterfall(income, expense, available) {
  const chart = getChart('waterfallChart');
  const labels = ['Income', 'Expense', 'Net Savings'];
  const base = [0, Math.max(income - expense, 0), 0];
  const positive = [income, '-', Math.max(available, 0)];
  const negative = ['-', Math.min(expense, income), available < 0 ? Math.abs(available) : '-'];
  chart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: formatMoney },
    grid: { left: 65, right: 25, top: 35, bottom: 45 },
    xAxis: { type: 'category', data: labels, axisTick: { show: false }, axisLine: { lineStyle: { color: '#D8D3C4' } } },
    yAxis: { type: 'value', axisLabel: { formatter: axisMoney }, splitLine: { lineStyle: { color: '#E4DFD3' } } },
    series: [
      { type: 'bar', stack: 'waterfall', itemStyle: { color: 'transparent' }, emphasis: { itemStyle: { color: 'transparent' } }, data: base },
      { name: 'Increase', type: 'bar', stack: 'waterfall', color: '#81B29A', data: positive },
      { name: 'Decrease', type: 'bar', stack: 'waterfall', color: '#E07A5F', data: negative },
    ],
  });
}

function renderSavingsTrend() {
  const summary = monthlySummary();
  const chart = getChart('savingsTrendChart');
  chart.setOption({
    color: ['#3D405B'], tooltip: { trigger: 'axis', valueFormatter: formatMoney },
    grid: { left: 60, right: 25, top: 30, bottom: 45 },
    xAxis: { type: 'category', data: summary.map(([month]) => formatMonthShort(month)), axisTick: { show: false }, axisLine: { lineStyle: { color: '#D8D3C4' } } },
    yAxis: { type: 'value', axisLabel: { formatter: axisMoney }, splitLine: { lineStyle: { color: '#E4DFD3' } } },
    series: [{ type: 'bar', barMaxWidth: 48, data: summary.map(([, values]) => ({ value: values.income - values.expense, itemStyle: { color: values.income - values.expense >= 0 ? '#81B29A' : '#E07A5F' } })) }],
  });
}

function getChart(id) {
  if (!charts[id]) charts[id] = echarts.init($(id), null, { renderer: 'canvas' });
  return charts[id];
}
function resizeCharts() { Object.values(charts).forEach((chart) => chart.resize()); }
window.addEventListener('resize', resizeCharts);

function formatMoney(value) {
  const sign = value < 0 ? '-' : '';
  const amount = Math.abs(value);
  if (amount >= 1_000_000) return `${sign}${trimZero(amount / 1_000_000)}M`;
  if (amount >= 1_000) return `${sign}${trimZero(amount / 1_000)}K`;
  return `${sign}${Math.round(amount)}`;
}
function axisMoney(value) { return value >= 1_000_000 ? `${trimZero(value / 1_000_000)}M` : value >= 1_000 ? `${trimZero(value / 1_000)}K` : value; }
function trimZero(value) { return value.toFixed(1).replace(/\.0$/, ''); }
function formatMonth(month) { if (!/^\d{4}-\d{2}$/.test(month)) return month; const [year, number] = month.split('-'); return new Date(Number(year), Number(number) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); }
function formatMonthShort(month) { if (!/^\d{4}-\d{2}$/.test(month)) return month; const [year, number] = month.split('-'); return new Date(Number(year), Number(number) - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }); }
function formatDate(date) { return date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; }
function sortByDateDesc(a, b) { return (b.date?.getTime() || 0) - (a.date?.getTime() || 0); }
function setStatus(message, hidden) { $('statusMessage').textContent = message; $('statusMessage').hidden = hidden; }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char])); }
