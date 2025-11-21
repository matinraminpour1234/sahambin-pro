// سهام‌بین PRO — نسخه آنلاین (دارک مود)
// توضیحات: این اسکریپت کل منطق UI، fetch داده، تولید سیگنال، و شبیه‌سازی را بر عهده دارد.
// برای اتصال به API واقعی: در CONFIG قسمت API_URL و API_KEY را تکمیل کن.
// اگر API واقعی در دسترس نباشد، از دادهٔ شبیه‌سازی استفاده خواهد شد.

(() => {
  // ====== CONFIG ======
  // اگر می‌خواهی به API واقعی متصل شوی:
  // 1) apiUrl: یک رشته با {symbol} که با نام نماد جایگزین می‌شود
  //    مثال: "https://api.example.com/v1/symbols/{symbol}/history?from={from}&to={to}"
  // 2) apiKey: در صورت نیاز به هدر Authorization یا ?api_key=...
  const CONFIG = {
    apiUrl: "", // مثلا: "https://api.example.com/stock/{symbol}/history?from={from}&to={to}"
    apiKey: "", // اگر داری وارد کن وگرنه خالی بگذار
    // فرمت تاریخی که API می‌پذیرد: yyyy-mm-dd فرض شده است
  };

  // ====== UTILS ======
  function $(id){ return document.getElementById(id); }
  function fmtDate(d){ // yyyy-mm-dd
    const yy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,"0");
    const dd = String(d.getDate()).padStart(2,"0");
    return `${yy}-${mm}-${dd}`;
  }

  function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

  // ====== UI elements ======
  const symbolsInput = $("symbolsInput");
  const fromDateInput = $("fromDate");
  const toDateInput = $("toDate");
  const apiUrlInput = $("apiUrl");
  const apiKeyInput = $("apiKey");
  const loadBtn = $("loadBtn");
  const simulateBtn = $("simulateBtn");
  const signalType = $("signalType");
  const priceLevelControls = $("priceLevelControls");
  const maControls = $("maControls");
  const buyLevelInput = $("buyLevel");
  const sellLevelInput = $("sellLevel");
  const maShortInput = $("maShort");
  const maLongInput = $("maLong");
  const statusTitle = $("statusTitle");
  const statusMsg = $("statusMsg");
  const resultsTableBody = document.querySelector("#resultsTable tbody");
  const symbolDetails = $("symbolDetails");
  const backtestResults = $("backtestResults");
  const downloadReport = $("downloadReport");
  const capitalPerSymbolInput = $("capitalPerSymbol");

  // set default dates (last 90 days)
  const today = new Date();
  const prior = new Date(); prior.setDate(today.getDate()-90);
  fromDateInput.value = fmtDate(prior);
  toDateInput.value = fmtDate(today);

  // chart
  let priceChart = null;

  // ====== SIGNAL UI logic ======
  signalType.addEventListener("change", ()=>{
    const v = signalType.value;
    if(v === "price-level"){ priceLevelControls.classList.remove("hidden"); maControls.classList.add("hidden"); }
    else { priceLevelControls.classList.add("hidden"); maControls.classList.remove("hidden"); }
  });

  // ====== FETCH / DATA ======
  // فرض می‌کنیم API هر نماد را به صورت آرایه‌ای از داخل JSON برمی‌گرداند:
  // [{date: "YYYY-MM-DD", open:..., high:..., low:..., close:..., volume:...}, ...]
  async function fetchHistorical(symbol, from, to){
    // اول، از ورودی‌های UI CONFIG استفاده کن
    const apiUrlUI = apiUrlInput.value.trim() || CONFIG.apiUrl;
    const apiKeyUI = apiKeyInput.value.trim() || CONFIG.apiKey;

    if(apiUrlUI){
      const url = apiUrlUI.replace("{symbol}", encodeURIComponent(symbol))
                          .replace("{from}", encodeURIComponent(from))
                          .replace("{to}", encodeURIComponent(to));
      try {
        const headers = {};
        if(apiKeyUI){
          // برخی APIها header Authorization می‌خواهند؛ اینجا یک مثال ساده است
          headers["Authorization"] = `Bearer ${apiKeyUI}`;
        }
        const res = await fetch(url, { headers });
        if(!res.ok) throw new Error(`خطا در دریافت داده (${res.status})`);
        const json = await res.json();

        // تلاش برای تشخیص فرمت رایج: اگر json.data یا json.historical وجود داشت از آن استفاده کن
        let arr = json;
        if(json.data) arr = json.data;
        if(json.historical) arr = json.historical;
        // فرض می‌کنیم هر آیتم فیلد date و close دارد
        return arr.map(r => ({
          date: r.date || r.time || r.t,
          open: Number(r.open || r.o || r[1] || 0),
          high: Number(r.high || r.h || r[2] || 0),
          low: Number(r.low || r.l || r[3] || 0),
          close: Number(r.close || r.c || r[4] || 0),
          volume: Number(r.volume || r.v || 0)
        })).sort((a,b)=> a.date.localeCompare(b.date));
      } catch(err){
        console.warn("fetchHistorical error:", err);
        throw err;
      }
    }

    // اگر apiUrl تنظیم نشده باشد: بازگرداندن دادهٔ شبیه‌سازی (نمونه)
    return generateMockHistory();
  }

  function generateMockHistory(days = 120, startPrice = 10000){
    const arr = [];
    let p = startPrice;
    for(let i=days-1;i>=0;i--){
      const d = new Date(); d.setDate(d.getDate()-i);
      const change = (Math.random()-0.5) * 0.04; // +/-4%
      const open = p;
      p = Math.max(100, p * (1+change));
      const close = Math.round(p);
      const high = Math.max(open, close) * (1 + Math.random()*0.02);
      const low = Math.min(open, close) * (1 - Math.random()*0.02);
      const vol = Math.round(1000 + Math.random()*5000);
      arr.push({
        date: fmtDate(d),
        open, high, low, close, volume: vol
      });
    }
    return arr;
  }

  // ====== INDICATORS / SIGNALS ======
  function computeSMA(arr, period, accessor = d => d.close){
    const sma = [];
    let sum = 0;
    for(let i=0;i<arr.length;i++){
      const v = accessor(arr[i]);
      sum += v;
      if(i >= period) sum -= accessor(arr[i-period]);
      sma.push(i >= period-1 ? sum / period : null);
    }
    return sma;
  }

  function latest(arr){ return arr[arr.length-1]; }

  // Generate signal per symbol: either price-level or MA crossover
  function generateSignalFor(symbol, history, opts){
    const last = latest(history);
    if(!last) return { signal: "no-data" };

    if(opts.type === "price-level"){
      const buyL = Number(opts.buyLevel);
      const sellL = Number(opts.sellLevel);
      let signal = "خنثی";
      if(last.close <= buyL) signal = "خرید پیشنهادی";
      else if(last.close >= sellL) signal = "فروش پیشنهادی";
      return { signal, lastPrice: last.close, buyLevel: buyL, sellLevel: sellL };
    } else if(opts.type === "ma-cross"){
      const s = Number(opts.maShort);
      const l = Number(opts.maLong);
      if(s >= l) return { signal: "پارامتر اشتباه (MA کوتاه باید کوچک‌تر باشد)" };
      const smaS = computeSMA(history, s);
      const smaL = computeSMA(history, l);
      const n = history.length;
      // بررسی تقاطع آخرین دو نقطه
      const prevIndex = n-2;
      const curIndex = n-1;
      if(prevIndex < 0) return { signal: "داده ناکافی" };
      const prevShort = smaS[prevIndex], prevLong = smaL[prevIndex];
      const curShort = smaS[curIndex], curLong = smaL[curIndex];
      let signal = "خنثی";
      if(prevShort != null && prevLong != null && curShort != null && curLong != null){
        if(prevShort <= prevLong && curShort > curLong) signal = "سیگنال خرید (Golden Cross)";
        else if(prevShort >= prevLong && curShort < curLong) signal = "سیگنال فروش (Death Cross)";
      } else {
        signal = "داده ناکافی برای MA";
      }
      return { signal, lastPrice: last.close, maShort: curShort, maLong: curLong };
    }
    return { signal: "نوع سیگنال نامشخص" };
  }

  // ====== BACKTEST / SIMULATION ======
  // یک شبیه‌سازی ساده با قوانین:
  // - بر اساس سیگنال ورود/خروج (قیمت سطح یا کراس MA)
  // - سرمایه اولیه برای هر نماد از ورودی گرفته می‌شود
  // - هنگام رخداد سیگنال خرید: تمام سرمایه تخصیص داده شده را در قیمت آن روز خرید می‌کنیم (بخش صحیح از سهم)
  // - فروش با اولین سیگنال فروش یا رسیدن به هدف قیمت فروخته می‌شود
  function backtest(history, strategyOpts, capitalPerSymbol = 10000000){
    // history: آرایه زمانی صعودی
    const results = {
      trades: [],
      summary: { invested: 0, realizedPL: 0, wins: 0, losses: 0, totalTrades: 0 }
    };

    let position = null; // {entryPrice, entryDate, qty}
    for(let i=0;i<history.length;i++){
      const row = history[i];
      // تصمیم‌گیری سیگنال در هر روز با داده تا آن روز
      const slice = history.slice(0, i+1);
      const sig = generateSignalFor("sym", slice, strategyOpts);

      if(!position && (sig.signal && sig.signal.toString().includes("خرید"))){
        // ورود
        const entryPrice = row.close;
        const qty = Math.floor(capitalPerSymbol / entryPrice);
        if(qty <= 0) continue;
        position = { entryPrice, entryDate: row.date, qty };
        results.trades.push({ entryDate: row.date, entryPrice, qty, exitDate: null, exitPrice: null, pnl: null });
        results.summary.invested += qty * entryPrice;
      } else if(position && (sig.signal && sig.signal.toString().includes("فروش"))){
        // خروج
        const exitPrice = row.close;
        const lastTrade = results.trades[results.trades.length-1];
        lastTrade.exitDate = row.date;
        lastTrade.exitPrice = exitPrice;
        lastTrade.pnl = (exitPrice - lastTrade.entryPrice) * lastTrade.qty;
        results.summary.realizedPL += lastTrade.pnl;
        results.summary.totalTrades += 1;
        if(lastTrade.pnl > 0) results.summary.wins += 1; else results.summary.losses += 1;
        position = null;
      }
    }

    // اگر هنوز پوزیشن باز بمونه، آن را با قیمت آخر تسویه کن
    if(position){
      const lastRow = latest(history);
      const lastTrade = results.trades[results.trades.length-1];
      lastTrade.exitDate = lastRow.date;
      lastTrade.exitPrice = lastRow.close;
      lastTrade.pnl = (lastTrade.exitPrice - lastTrade.entryPrice) * lastTrade.qty;
      results.summary.realizedPL += lastTrade.pnl;
      results.summary.totalTrades += 1;
      if(lastTrade.pnl > 0) results.summary.wins += 1; else results.summary.losses += 1;
    }

    return results;
  }

  // ====== UI RENDER ======
  function setStatus(title, msg){
    statusTitle.textContent = title;
    statusMsg.textContent = msg;
  }

  function clearTable(){ resultsTableBody.innerHTML = ""; }

  function appendRow(symbol, signalText, lastPrice, suggestion, backtestSummary){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${symbol}</td>
      <td>${signalText}</td>
      <td>${lastPrice != null ? lastPrice.toLocaleString() : "-"}</td>
      <td>${suggestion || "-"}</td>
      <td>${backtestSummary || "-"}</td>
    `;
    tr.addEventListener("click", ()=> showSymbolDetails(symbol));
    resultsTableBody.appendChild(tr);
  }

  function showSymbolDetails(symbol){
    // فقط نشان دادن عنوان؛ دادهٔ کامل هنگام بارگذاری وجود دارد
    symbolDetails.innerHTML = `<p>در حال نمایش جزئیات برای: <strong>${symbol}</strong></p>`;
  }

  // ====== CHART RENDER ======
  function renderChart(history, symbol){
    const labels = history.map(d=>d.date);
    const prices = history.map(d=>d.close);
    const ctx = document.getElementById("priceChart").getContext("2d");
    if(priceChart) priceChart.destroy();
    priceChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: symbol || "قیمت",
          data: prices,
          tension: 0.15,
          pointRadius: 0
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { display: true, ticks: { color: '#9aa6b2' }, grid: { color: 'rgba(255,255,255,0.02)' } },
          y: { display: true, ticks: { color: '#9aa6b2' }, grid: { color: 'rgba(255,255,255,0.02)' } }
        },
        maintainAspectRatio: false
      }
    });
  }

  // ====== CSV EXPORT ======
  function toCSV(rows){
    const lines = rows.map(r => r.map(c => `"${(c ?? "").toString().replace(/"/g,'""')}"`).join(","));
    return lines.join("\n");
  }

  // ====== MAIN ACTIONS ======
  loadBtn.addEventListener("click", async ()=>{
    const rawSymbols = symbolsInput.value.trim();
    if(!rawSymbols){ setStatus("خطا","لطفاً حداقل یک نماد وارد کن"); return; }
    const symbols = rawSymbols.split(",").map(s => s.trim()).filter(Boolean);
    const from = fromDateInput.value;
    const to = toDateInput.value;
    if(!from || !to){ setStatus("خطا","تاریخ شروع و پایان را انتخاب کن"); return; }

    // update config from UI
    if(apiUrlInput.value.trim()) CONFIG.apiUrl = apiUrlInput.value.trim();
    if(apiKeyInput.value.trim()) CONFIG.apiKey = apiKeyInput.value.trim();

    setStatus("در حال دریافت داده‌ها...", `در حال بارگذاری ${symbols.length} نماد...`);
    clearTable();
    backtestResults.innerHTML = `<p>در حال پردازش...</p>`;

    const strategyOpts = {
      type: signalType.value,
      buyLevel: buyLevelInput.value,
      sellLevel: sellLevelInput.value,
      maShort: maShortInput.value,
      maLong: maLongInput.value
    };

    const reportRows = [
      ["نماد","سیگنال","قیمت آخر","پیشنهاد","تعداد معاملات","سود/زیان (تومان)"]
    ];

    for(let i=0;i<symbols.length;i++){
      const sym = symbols[i];
      setStatus("در حال بارگیری", `بارگذاری ${sym} (${i+1}/${symbols.length})`);
      try{
        const history = await fetchHistorical(sym, from, to);
        // اگر API داده متنوعی بازگرداند، ممکن است قیمت‌ها پراکنده باشند — فرض بسته به API
        const signal = generateSignalFor(sym, history, strategyOpts);

        // اجرای شبیه‌سازی ساده
        const capitalPerSymbol = Number(capitalPerSymbolInput.value) || 10000000;
        const bt = backtest(history, strategyOpts, capitalPerSymbol);

        appendRow(sym, signal.signal || "-", signal.lastPrice || "-", (signal.buyLevel ? `خرید ≤ ${signal.buyLevel.toLocaleString()}` : (signal.maShort ? `MA_SHORT:${signal.maShort?.toFixed?.(2) || ""}` : "-")), `${bt.summary.totalTrades} / ${bt.summary.realizedPL.toLocaleString()}`);

        // برای گزارش CSV
        reportRows.push([sym, signal.signal || "-", signal.lastPrice || "-", JSON.stringify(signal), bt.summary.totalTrades, bt.summary.realizedPL]);

        // برای اولین نماد، نمایش جزییات و نمودار
        if(i === 0){
          renderChart(history, sym);
          symbolDetails.innerHTML = `
            <p><strong>${sym}</strong></p>
            <p>آخرین قیمت: ${ (latest(history)?.close ?? "-") }</p>
            <p>حجم آخر: ${ (latest(history)?.volume ?? "-") }</p>
          `;
        }

        // کمی تاخیر کوچک برای جلوگیری از پرشدن درخواست‌ها (در صورت API محدود)
        await sleep(200);
      } catch(err){
        console.error(err);
        appendRow(sym, "خطا در دریافت/پردازش", "-", "-", "-");
      }
    }

    setStatus("بارگذاری کامل", `بارگذاری ${symbols.length} نماد کامل شد.`);
    backtestResults.innerHTML = `<pre style="white-space:pre-wrap;color:#cfeadf">گزارش آماده است — برای دانلود روی «دانلود گزارش CSV» کلیک کن.</pre>`;

    // prepare CSV data for download
    const csv = toCSV(reportRows);
    downloadReport.onclick = () => {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sahambin_report_${fmtDate(new Date())}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    };
  });

  simulateBtn.addEventListener("click", async ()=>{
    // شبیه‌سازی بصری سریع فقط برای نماد اول جدول (یا نماد نمونه)
    const rawSymbols = symbolsInput.value.trim();
    if(!rawSymbols){ setStatus("خطا","لطفاً حداقل یک نماد وارد کن"); return; }
    const sym = rawSymbols.split(",").map(s=>s.trim())[0];
    if(!sym) return;
    setStatus("شبیه‌سازی", `شبیه‌سازی برای ${sym} در حال اجرا...`);
    try{
      const history = await fetchHistorical(sym, fromDateInput.value, toDateInput.value);
      const strategyOpts = {
        type: signalType.value,
        buyLevel: buyLevelInput.value,
        sellLevel: sellLevelInput.value,
        maShort: maShortInput.value,
        maLong: maLongInput.value
      };
      const bt = backtest(history, strategyOpts, Number(capitalPerSymbolInput.value) || 10000000);
      backtestResults.innerHTML = `
        <p>نتایج کلی:</p>
        <ul>
          <li>تعداد معاملات: ${bt.summary.totalTrades}</li>
          <li>سود/زیان خالص: ${bt.summary.realizedPL.toLocaleString()}</li>
          <li>بردها: ${bt.summary.wins} — باخت‌ها: ${bt.summary.losses}</li>
          <li>سرمایه مصرفی تقریبی: ${bt.summary.invested.toLocaleString()}</li>
        </ul>
      `;
      setStatus("شبیه‌سازی کامل", `نتایج شبیه‌سازی آماده است.`);
    } catch(err){
      setStatus("خطا در شبیه‌سازی", err.message || "خطای نامشخص");
    }
  });

  // آیکون دانلود خاموش تا دیتا آماده شود
  downloadReport.onclick = () => { alert("ابتدا داده‌ها را بارگذاری کن، سپس می‌تونی گزارش را دانلود کنی."); };

  // یکبار آماده‌سازی اولیه
  setStatus("آماده", "برای شروع نمادها را وارد کن و روی «بارگذاری داده‌ها» کلیک کن.");
})();