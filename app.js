
/* @台操盤 V6：手機版儀表板功能程式 */
(() => {
"use strict";

const $ = id => document.getElementById(id);
const money = n => Number.isFinite(Number(n))
  ? "NT$" + Number(n).toLocaleString("zh-TW", {
      maximumFractionDigits: 2
    })
  : "未提供";

const num = x => {
  if (x === null || x === undefined || String(x).trim() === "") return null;
  const n = Number(String(x).replace(/[,元NT$％%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const esc = x => String(x ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;",
  '"': "&quot;", "'": "&#39;"
}[c]));

const titles = {
  overview: "市場總覽",
  scanner: "策略選股",
  goal: "獲利達標日期",
  backtest: "歷史回測",
  risk: "風險與資金",
  data: "資料中心"
};

let report = null;
let kline = [];

function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  const s = String(text || "").replace(/^\ufeff/, "");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];

    if (c === '"') {
      if (quoted && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\r" || c === "\n") && !quoted) {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some(v => v !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += c;
    }
  }

  if (quoted) throw Error("CSV 引號格式錯誤");

  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const headers = (rows.shift() || []).map(x => x.trim());

  return rows.slice(0, 50000).map(a =>
    Object.fromEntries(headers.map((h, i) => [h, a[i] ?? ""]))
  );
}

function readSummary(text) {
  const match = pattern => {
    const m = text.match(pattern);
    return m ? m[1] : "";
  };

  return {
    asof: match(/資料截至[：:]\s*(\d{4}-\d\d-\d\d)/),
    period: match(/檢索區間[：:]\s*([^\n；;]+)/),
    capital: num(match(/帳戶本金[：:]\s*([\d,.]+)/)) ?? 50000,
    goal: num(match(/達標總額[：:]\s*([\d,.]+)/)) ?? 52500,
    requested: num(match(/股票要求[：:]\s*(\d+)檔/)),
    loaded: num(match(/成功[：:]\s*(\d+)檔/)),
    errors: num(match(/資料錯誤[：:]\s*(\d+)檔/)),
    selected: num(match(/驗證入選[：:]\s*(\d+)檔/)),
    ending: num(match(/期末已實現帳戶資金[：:]\s*([-\d,.]+)/)),
    pnl: num(match(/已實現損益[：:]\s*([-\d,.]+)/)),
    dd: num(match(/估計最大回撤[：:]\s*([\d,.]+)/))
  };
}

function normalizeReport(summary, parts, filename) {
  const info = readSummary(summary);

  const trades = (parts.trades || []).map(r => ({
    symbol: r["股票"],
    rule: r["完整規則"],
    entry: r["進場日"],
    exit: r["出場日"],
    days: num(r["持有交易日"]),
    buy: num(r["買進成交假設價"]),
    sell: num(r["賣出成交假設價"]),
    qty: num(r["股數"]),
    event: r["事件"],
    pnl: num(r["交易淨損益元"]),
    before: num(r["進場前帳戶元"]),
    after: num(r["出場後帳戶元"])
  }))
  .filter(r => r.entry && r.exit && r.pnl !== null)
  .sort((a, b) => a.exit.localeCompare(b.exit));

  const equity = trades.length
    ? [
        {
          date: trades[0].entry,
          amount: trades[0].before ?? info.capital
        },
        ...trades.map(t => ({
          date: t.exit,
          amount: t.after
        }))
      ]
    : [];

  return {
    info,
    trades,
    equity,
    strategies: parts.strategies || [],
    horizons: parts.horizons || [],
    latest: parts.latest || [],
    errors: parts.errors || [],
    name: filename,
    summary
  };
}

/* ZIP 元件：需要時才載入，不上傳使用者的 ZIP */
let zipPromise = null;

function ensureZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (zipPromise) return zipPromise;

  zipPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");

    script.src =
      "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";

    script.onload = () => window.JSZip
      ? resolve(window.JSZip)
      : reject(Error("ZIP 元件載入失敗"));

    script.onerror = () =>
      reject(Error("無法載入 ZIP 元件，請檢查網路連線"));

    document.head.appendChild(script);
  }).catch(err => {
    zipPromise = null;
    throw err;
  });

  return zipPromise;
}

async function loadReport(file) {
  if (file.size > 24 * 1024 * 1024) {
    throw Error("檔案不可超過 24 MB");
  }

  if (/\.json$/i.test(file.name)) {
    const data = JSON.parse(await file.text());

    if (
      data?.type === "v54-artifact" &&
      data.info &&
      Array.isArray(data.trades)
    ) {
      return {
        info: data.info,
        trades: data.trades.map(t => ({
          ...t,
          symbol: t.symbol ?? t.ticker
        })),
        equity: (data.equity || []).map(e => ({
          date: e.date,
          amount: e.amount ?? e.equity
        })),
        strategies: data.strategies || [],
        horizons: data.horizons || [],
        latest: data.latest || [],
        errors: data.errors || [],
        name: file.name
      };
    }

    throw Error("JSON 不是 V5.4 報告格式");
  }

  if (!/\.zip$/i.test(file.name)) {
    throw Error("請選擇 V5.4 ZIP 或 JSON 報告");
  }

  const JSZip = await ensureZip();
  const zip = await JSZip.loadAsync(file, { checkCRC32: true });

  async function get(prefix, maxSize = 12 * 1024 * 1024) {
    const entry = Object.values(zip.files).find(f =>
      !f.dir && f.name.split("/").pop().startsWith(prefix)
    );

    if (!entry) return "";

    if (entry._data?.uncompressedSize > maxSize) {
      throw Error("解壓檔案過大：" + prefix);
    }

    const text = await entry.async("string");

    if (text.length > maxSize) throw Error("檔案過大");
    return text;
  }

  const summary = await get("08_", 300000);
  const strategies = await get("01_");

  if (!summary || !strategies) {
    throw Error("ZIP 缺少 V5.4 策略及摘要檔");
  }

  return normalizeReport(summary, {
    strategies: parseCSV(strategies),
    trades: parseCSV(await get("03_")),
    horizons: parseCSV(await get("04_")),
    latest: parseCSV(await get("05_")),
    errors: parseCSV(await get("06_"))
  }, file.name);
}

function makeTable(headers, rows) {
  if (!rows.length) {
    return '<div class="empty">沒有符合條件的資料</div>';
  }

  return "<table><thead><tr>" +
    headers.map(h => "<th>" + esc(h) + "</th>").join("") +
    "</tr></thead><tbody>" +
    rows.map(row =>
      "<tr>" +
      row.map(v => "<td>" + esc(v) + "</td>").join("") +
      "</tr>"
    ).join("") +
    "</tbody></table>";
}

function infoBox(label, value) {
  return '<div class="item"><div class="title">' +
    esc(label) + "</div><p>" + esc(value) + "</p></div>";
}

function showPage(page) {
  document.querySelectorAll(".view").forEach(el => {
    el.classList.toggle("active", el.id === "view-" + page);
  });

  document.querySelectorAll("[data-view]").forEach(el => {
    el.classList.toggle("selected", el.dataset.view === page);
  });

  $("viewTitle").textContent = titles[page] || page;
  window.scrollTo(0, 0);
}

function scenario() {
  const capital = num($("settingCapital").value);
  const pct = num($("settingTarget").value);

  if (!(capital > 0 && pct > 0)) return null;

  return {
    capital,
    pct,
    goal: capital * (1 + pct / 100)
  };
}

function firstHit() {
  if (!report) return null;

  const p = report.equity.find(x =>
    x.amount >= report.info.goal
  );

  return p?.date || null;
}

function equityChart() {
  const points = report?.equity || [];

  if (points.length < 2) {
    return '<div class="empty">尚無歷史帳戶資金曲線</div>';
  }

  const target = report.info.goal;
  const values = points.map(p => p.amount).concat(target);
  const low = Math.min(...values) - 300;
  const high = Math.max(...values) + 300;

  const x = i => 50 + i / (points.length - 1) * 650;
  const y = v => 180 - (v - low) / (high - low) * 155;

  const line = points.map((p, i) =>
    x(i) + "," + y(p.amount)
  ).join(" ");

  return `
  <svg viewBox="0 0 750 210" role="img"
       aria-label="歷史帳戶資金變化">
    <line x1="50" x2="700"
          y1="${y(target)}" y2="${y(target)}"
          stroke="#51ddba" stroke-dasharray="6 5"/>
    <polyline points="${line}"
              fill="none" stroke="#5bafff"
              stroke-width="3"/>
    <text x="690" y="${Math.max(12, y(target) - 8)}"
          fill="#51ddba" text-anchor="end"
          font-size="12">${target.toLocaleString("zh-TW")}</text>
  </svg>`;
}

function renderOverview() {
  const info = report?.info || {};
  const capital = info.capital ?? 50000;
  const target = info.goal ?? 52500;

  $("mInitial").textContent = money(capital);
  $("mGoal").textContent = money(target);
  $("mFinal").textContent =
    report ? money(info.ending) : "尚無資料";

  $("mPnl").textContent = report
    ? "已實現淨損益 " + money(info.pnl)
    : "尚無可驗證績效";

  $("mDate").textContent = firstHit() || "無法估計";
  $("mDateHint").textContent = firstHit()
    ? "歷史首次達標，非未來日期預測"
    : "未觀察到歷史達標或樣本不足";

  $("equityChart").innerHTML = equityChart();
  $("equityTag").textContent = report
    ? "歷史模擬資金"
    : "等待交易紀錄";

  const coverage = info.requested && info.loaded !== null
    ? info.loaded / info.requested * 100
    : null;

  $("coverageValue").textContent = coverage === null
    ? "未提供"
    : coverage.toFixed(1) + "%";

  $("coverageBar").style.width = (coverage ?? 0) + "%";

  $("coverageNote").textContent = report
    ? `要求 ${info.requested ?? "?"} 檔、成功 ${info.loaded ?? "?"} 檔`
    : "目前沒有掃描紀錄";

  $("tradesValue").textContent = report
    ? report.trades.length + " 筆"
    : "未提供";

  $("tradesNote").textContent =
    "歷史樣本外交易，不代表未來勝率";

  $("drawdownValue").textContent = report
    ? money(info.dd)
    : "未提供";

  $("drawdownNote").textContent =
    "歷史回測估計，非完整盤中回撤";

  $("decisionTag").textContent = report?.latest.length
    ? "研究候選"
    : "無可發布訊號";

  $("decisionBody").innerHTML = report?.latest.length
    ? report.latest.slice(0, 5).map(x =>
        infoBox(x["股票"], x["原因"] || "尚未確認成交價")
      ).join("")
    : '<div class="empty">目前沒有已驗證的最新進場訊號</div>';

  $("healthChecks").innerHTML =
    infoBox("資料狀態", report ? "已匯入歷史回測" : "尚未匯入") +
    infoBox("策略驗證",
      report?.trades.length >= 30
        ? "已有30筆以上交易，仍需驗證"
        : "交易不足30筆，不能證明穩定獲利") +
    infoBox("未來達標日期", "尚未建立經校準的預測模型");
}

function renderScanner() {
  const all = report?.strategies || [];
  const q = $("strategySearch").value.trim();
  const mode = $("strategyFilter").value;
  const sort = $("strategySort").value;

  let rows = all.filter(x => {
    const matches =
      ((x["股票"] || "") + " " + (x["進場策略"] || ""))
      .includes(q);

    if (!matches) return false;
    if (mode === "positive") {
      return num(x["驗證總淨損益元"]) > 0;
    }
    if (mode === "passing") {
      return x["研究門檻通過"] === "是";
    }
    return true;
  });

  const key = sort === "trades"
    ? "驗證筆數"
    : sort === "pnl"
      ? "驗證總淨損益元"
      : "驗證研究得分";

  rows.sort((a, b) =>
    (num(b[key]) ?? -Infinity) - (num(a[key]) ?? -Infinity)
  );

  $("scannerCount").textContent =
    rows.length + " / " + all.length + " 組";

  $("strategyTable").innerHTML = makeTable(
    ["股票", "進場策略", "驗證筆數", "驗證淨損益", "勝率", "初篩"],
    rows.slice(0, 60).map(x => [
      x["股票"],
      x["進場策略"],
      x["驗證筆數"],
      money(num(x["驗證總淨損益元"])),
      (x["驗證勝率%"] || "—") + "%",
      x["研究門檻通過"]
    ])
  );

  $("strategyFooter").textContent =
    "驗證期獲利不代表獨立樣本外也能獲利。";

  $("latestSignals").innerHTML = report?.latest.length
    ? report.latest.map(x =>
        infoBox(x["股票"], x["原因"] || "尚未確認成交價")
      ).join("")
    : '<div class="empty">沒有最新進場訊號</div>';
}

function renderGoal() {
  const s = scenario();
  if (!s) return;

  $("goalAmount").textContent = money(s.goal);
  $("goalProfit").textContent = money(s.goal - s.capital);

  const same = !!report &&
    Math.abs(s.capital - report.info.capital) < 0.01 &&
    Math.abs(s.goal - report.info.goal) < 0.01;

  $("goalFirst").textContent = same
    ? (firstHit() || "未達標")
    : "不可直接推算";

  $("goalSummary").textContent = same
    ? "僅為歷史回測結果，尚無可信未來達標日期。"
    : "更改本金或目標後，必須重新回測。";

  $("goalCriteria").innerHTML =
    infoBox("帳戶目標", money(s.capital) + " → " + money(s.goal)) +
    infoBox("未來達標機率", "尚無獨立校準數據，不提供假設機率");

  $("horizonTable").innerHTML = makeTable(
    ["期限（日）", "歷史區塊數", "達標次數", "可發布"],
    (report?.horizons || []).map(x => [
      x["期限交易日"],
      x["獨立觀測區塊數"],
      x["歷史達標區塊數"],
      x["可發布歷史頻率"]
    ])
  );
}

function renderBacktest() {
  const trades = report?.trades || [];

  $("btStrategies").textContent =
    report ? report.strategies.length : "—";

  $("btPositive").textContent = report
    ? report.strategies.filter(x =>
        num(x["驗證總淨損益元"]) > 0
      ).length
    : "—";

  $("btTrades").textContent = report
    ? trades.length
    : "—";

  $("btPnl").textContent = report
    ? money(report.info.pnl)
    : "—";

  $("tradeTable").innerHTML = makeTable(
    ["股票", "進場日", "出場日", "事件", "淨損益", "交易後帳戶"],
    trades.map(t => [
      t.symbol,
      t.entry,
      t.exit,
      t.event,
      money(t.pnl),
      money(t.after)
    ])
  );

  $("backtestWarnings").innerHTML =
    infoBox("樣本外驗證",
      trades.length < 30
        ? "有效交易少於30筆，尚不能證明穩定獲利"
        : "仍需跨年份與不同市場狀態驗證") +
    infoBox("交易成本與限制",
      "未完整還原除權息、停牌、漲跌停與分時成交限制") +
    infoBox("不同批次",
      "各批次5萬元不能直接相加為同一帳戶");
}

function renderRisk() {
  const s = scenario();
  if (!s) return;

  const risk = num($("riskPct").value) ?? 1;
  const dd = num($("maxDDPct").value) ?? 5;

  $("riskBudget").textContent =
    money(s.capital * risk / 100);

  $("riskDrawdown").textContent =
    money(s.capital * dd / 100);

  $("riskObservations").innerHTML =
    infoBox("歷史淨損益",
      report ? money(report.info.pnl) : "尚無資料") +
    infoBox("最大已實現回撤",
      report ? money(report.info.dd) : "尚無資料") +
    infoBox("回撤警戒",
      report && report.info.dd > s.capital * dd / 100
        ? "歷史回撤超過目前設定的警戒值"
        : "僅供研究，不保證實際損失上限");

  $("modules").innerHTML = [
    "即時行情", "法人籌碼", "逐筆成交",
    "VWAP / ORB", "融券券源", "未來達標機率"
  ].map(x =>
    '<div class="module"><strong>' + x +
    '</strong><small>尚未連接資料來源</small></div>'
  ).join("");
}

function renderData() {
  const info = report?.info || {};

  $("importStatus").textContent = report
    ? "已在本機匯入 " + report.name
    : "尚未匯入任何檔案";

  $("dataDetails").innerHTML =
    infoBox("資料來源", report?.name || "尚無資料") +
    infoBox("資料截至", info.asof || "未提供") +
    infoBox("成功讀取股票",
      report
        ? `${info.loaded ?? "?"} / ${info.requested ?? "?"} 檔`
        : "未提供") +
    infoBox("資訊安全",
      "公開網站勿輸入 API Key，私人報告勿上傳至公開儲存庫");
}

function plotKline() {
  $("klineTag").textContent = kline.length
    ? "歷史日 K " + kline.length + " 根"
    : "尚未載入 K 線";

  if (kline.length < 2) {
    $("klineChart").innerHTML =
      '<div class="empty">請匯入歷史日K CSV</div>';
    return;
  }

  const data = kline.slice(-60);
  const low = Math.min(...data.map(x => x.low));
  const high = Math.max(...data.map(x => x.high));
  const y = v => 180 - (v - low) / (high - low || 1) * 155;

  const lines = data.map((v, i) => {
    const x = 25 + i * 10.5;
    const color = v.close >= v.open ? "#ff798b" : "#51ddba";

    return `
    <line x1="${x}" x2="${x}"
          y1="${y(v.high)}" y2="${y(v.low)}"
          stroke="${color}"/>
    <rect x="${x - 3}"
          y="${Math.min(y(v.open), y(v.close))}"
          width="6"
          height="${Math.max(1, Math.abs(y(v.open) - y(v.close)))}"
          fill="${color}"/>`;
  }).join("");

  $("klineChart").innerHTML =
    '<svg viewBox="0 0 680 210" role="img" aria-label="歷史日K圖">' +
    lines + "</svg>";
}

function render() {
  const info = report?.info || {};

  $("statusText").textContent = report
    ? "歷史回測・" + (info.asof || "日期未提供")
    : "未連線・沒有行情";

  $("sideStatus").textContent = report
    ? "已匯入歷史報告"
    : "等待匯入報告";

  $("notice").textContent = report
    ? "這是歷史回測結果，並非即時行情或保證的未來獲利日期。"
    : "尚未匯入回測資料，請到「資料中心」選擇 V5.4 ZIP。";

  renderOverview();
  renderScanner();
  renderGoal();
  renderBacktest();
  renderRisk();
  renderData();

  $("footerTime").textContent = info.asof || "等待資料";
}

async function importReport(file) {
  if (!file) return;

  try {
    $("importStatus").textContent = "正在解析 " + file.name;

    report = await loadReport(file);

    $("settingCapital").value = report.info.capital;
    $("settingTarget").value =
      ((report.info.goal / report.info.capital - 1) * 100).toFixed(3);

    render();
    showPage("overview");

  } catch (err) {
    $("importStatus").textContent = "匯入失敗：" + err.message;
    alert("匯入失敗：" + err.message);
  }
}

function downloadSummary() {
  const s = scenario();

  const text = `@台操盤 V6 繁體中文摘要
研究本金：${money(s.capital)}
帳戶目標：${money(s.goal)}
歷史淨損益：${report ? money(report.info.pnl) : "尚無資料"}
歷史首次達標：${firstHit() || "未達標／無法估計"}
資料來源：${report?.name || "尚未匯入"}
本報告不代表即時行情或未來獲利保證。`;

  const blob = new Blob([text], {
    type: "text/plain;charset=utf-8"
  });

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "台操盤V6_中文摘要.txt";
  a.click();

  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

/* 啟用六個功能選單 */
document.querySelectorAll("[data-view]").forEach(el => {
  el.addEventListener("click", () => showPage(el.dataset.view));
});

/* 匯入報告 */
$("headerImport").addEventListener("click", () => {
  showPage("data");
  $("artifactFile").click();
});

$("artifactFile").addEventListener("change", e => {
  importReport(e.target.files[0]);
});

/* 選股搜尋 */
$("strategySearch").addEventListener("input", renderScanner);
$("strategySort").addEventListener("change", renderScanner);
$("strategyFilter").addEventListener("change", renderScanner);

/* 本金及獲利目標 */
["settingCapital", "settingTarget"].forEach(id => {
  $(id).addEventListener("input", () => {
    renderGoal();
    renderRisk();
  });
});

/* 資金風險 */
["riskPct", "maxDDPct"].forEach(id => {
  $(id).addEventListener("input", renderRisk);
});

/* K線資料 */
$("priceFile").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    if (file.size > 5 * 1024 * 1024) {
      throw Error("CSV 不可超過 5 MB");
    }

    const rows = parseCSV(await file.text());

    kline = rows.map(x => ({
      date: x.date || x["日期"],
      open: num(x.open || x["開盤價"]),
      high: num(x.high || x["最高價"]),
      low: num(x.low || x["最低價"]),
      close: num(x.close || x["收盤價"])
    }))
    .filter(x =>
      x.date && x.low > 0 &&
      x.high >= x.low &&
      x.open !== null &&
      x.close !== null
    )
    .slice(-300);

    plotKline();

  } catch (err) {
    alert("K線匯入錯誤：" + err.message);
  }
});

/* 清除資料 */
$("clearData").addEventListener("click", () => {
  report = null;
  kline = [];
  render();
  plotKline();
});

/* 中文摘要 */
$("exportSummary").addEventListener("click", downloadSummary);

/* 啟動 */
render();
plotKline();

})();
