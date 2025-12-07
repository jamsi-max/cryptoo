/**
 * CryptoOracle Pro - 10 Parameter Edition
 */

document.addEventListener('DOMContentLoaded', () => {
    
    // ==========================================
    // 1. CONFIGURATION
    // ==========================================
    const CONFIG = {
        cryptos: [
            { id: 'BTCUSDT', symbol: 'BTC', name: 'Bitcoin', color: '#f7931a' },
            { id: 'ETHUSDT', symbol: 'ETH', name: 'Ethereum', color: '#627eea' },
            { id: 'SOLUSDT', symbol: 'SOL', name: 'Solana', color: '#00ffa3' },
            { id: 'BNBUSDT', symbol: 'BNB', name: 'BNB', color: '#f3ba2f' },
            { id: 'XRPUSDT', symbol: 'XRP', name: 'XRP', color: '#00aae4' }
        ],
        intervals: [
            { label: '1M', seconds: 60, key: '1m', bybit: '1' },
            { label: '5M', seconds: 300, key: '5m', bybit: '5' },
            { label: '15M', seconds: 900, key: '15m', bybit: '15' },
            { label: '1H', seconds: 3600, key: '1h', bybit: '60' },
            { label: '4H', seconds: 14400, key: '4h', bybit: '240' }
        ],
        // 10 Parameters Definition
        params: [
            { key: 'rsi', label: 'RSI (14)', icon: '📊' },
            { key: 'macd', label: 'MACD', icon: '📈' },
            { key: 'bb', label: 'B-BANDS', icon: '📉' },
            { key: 'mom', label: 'MOMENTUM', icon: '🚀' },
            { key: 'vol', label: 'VOLUME', icon: '🔊' },
            { key: 'ob', label: 'ORDERBOOK', icon: '📕' },
            { key: 'fund', label: 'FUNDING', icon: '💰' },
            { key: 'fg', label: 'SENTIMENT', icon: '😱' },
            { key: 'social', label: 'SOCIAL', icon: '🐦' },
            { key: 'news', label: 'NEWS AI', icon: '📰' }
        ],
        wsUrl: 'wss://stream.bybit.com/v5/public/linear',
        investment: 100
    };

    // ==========================================
    // 2. STATE
    // ==========================================
    const state = {
        activeCrypto: 'BTCUSDT',
        activeInterval: 0,
        prices: {},
        klines: {},
        indicators: {}, // Now holds all 10 params
        predictions: {},
        trades: [],
        stats: { wins: 0, total: 0, pl: 0 },
        chart: null,
        fearGreedValue: 50
    };

    // ==========================================
    // 3. HELPERS
    // ==========================================
    function el(id) { return document.getElementById(id); }
    function setText(id, txt) { const e = el(id); if (e && e.textContent !== String(txt)) e.textContent = txt; }
    function setClass(id, cls) { const e = el(id); if (e && e.className !== cls) e.className = cls; }
    function setStyle(id, prop, val) { const e = el(id); if (e) e.style[prop] = val; }
    function fmtPrice(p) { return !p ? '--' : p >= 1000 ? '$' + p.toLocaleString('en-US', {maximumFractionDigits:2}) : '$' + p.toFixed(4); }
    function fmtPct(p) { return !p && p!==0 ? '0.00%' : (p>=0?'+':'') + p.toFixed(2) + '%'; }

    // ==========================================
    // 4. UI UPDATES
    // ==========================================
    function updateTabPrice(symbol) {
        const p = state.prices[symbol];
        if (!p) return;
        setText(`tp-${symbol}`, fmtPrice(p.price));
        setText(`tc-${symbol}`, fmtPct(p.change));
        setClass(`tc-${symbol}`, `text-xs ${p.change >= 0 ? 'text-green-400' : 'text-red-400'}`);
    }

    function updateMainPrice(symbol) {
        const p = state.prices[symbol];
        if (!p) return;
        setText('livePrice', fmtPrice(p.price));
        setText('priceChange', fmtPct(p.change));
        setClass('priceChange', `text-lg ${p.change >= 0 ? 'text-green-400' : 'text-red-400'}`);
        setText('high24h', fmtPrice(p.high));
        setText('low24h', fmtPrice(p.low));
    }

    function updateHeatmapUI() {
        const ind = state.indicators[state.activeCrypto];
        if (!ind) return;

        // Calculate Composite Score (CPS) based on all 10 params
        let totalScore = 0;
        let count = 0;

        CONFIG.params.forEach((p, i) => {
            const val = ind[p.key] || 0;
            totalScore += val;
            count++;
            
            setText(`hm-val-${i}`, (val * 100).toFixed(0) + '%');
            const block = el(`hm-block-${i}`);
            
            // Visual logic
            let colorClass = 'border-l-2 border-gray-600';
            if (val > 0.2) colorClass = 'border-l-2 border-green-500 bg-green-500/10';
            else if (val < -0.2) colorClass = 'border-l-2 border-red-500 bg-red-500/10';
            
            if (block) block.className = `glass-panel p-2 flex flex-col justify-center ${colorClass}`;
        });

        // Update Big CPS Display
        const cps = totalScore / count; // -1 to 1
        const confidence = Math.round(Math.abs(cps) * 100);
        setText('cpsValue', confidence);
        
        let label = 'NEUTRAL';
        let color = 'text-gray-400';
        if (cps > 0.2) { label = 'BUY'; color = 'text-green-400'; }
        if (cps > 0.5) { label = 'STRONG BUY'; color = 'text-green-400 font-bold'; }
        if (cps < -0.2) { label = 'SELL'; color = 'text-red-400'; }
        if (cps < -0.5) { label = 'STRONG SELL'; color = 'text-red-400 font-bold'; }
        
        setText('cpsLabel', label);
        setClass('cpsLabel', `text-sm px-3 py-1 rounded border ${cps > 0 ? 'border-green-500 bg-green-900/50' : cps < 0 ? 'border-red-500 bg-red-900/50' : 'border-gray-500'}`);
        el('cpsValue').className = `text-4xl font-bold mb-2 ${cps > 0 ? 'text-green-400' : cps < 0 ? 'text-red-400' : 'text-white'}`;
    }

    function updatePredictionsUI() {
        const preds = state.predictions[state.activeCrypto];
        if (!preds) return;
        CONFIG.intervals.forEach((inv, i) => {
            const pred = preds[inv.key];
            if (pred) {
                setText(`pt-${i}`, fmtPrice(pred.target));
                setText(`pd-${i}`, pred.dir);
                setClass(`pd-${i}`, `text-xs font-bold ${pred.dir==='LONG'?'text-green-400':'text-red-400'}`);
                
                const timeLeft = Math.max(0, (pred.end - Date.now())/1000);
                setText(`ptime-${i}`, timeLeft.toFixed(0) + 's');
                const total = pred.end - pred.start;
                const elapsed = Date.now() - pred.start;
                setStyle(`pprog-${i}`, 'width', `${Math.min(100, (elapsed/total)*100)}%`);
                el(`card-${i}`).classList.add('locked');
            } else {
                setText(`pt-${i}`, '--');
                setText(`pd-${i}`, '--');
                setText(`ptime-${i}`, 'Scanning...');
                setStyle(`pprog-${i}`, 'width', '0%');
                el(`card-${i}`).classList.remove('locked');
            }
        });
    }

    function updateTradeHistoryUI() {
        const container = el('tradeHistory');
        container.innerHTML = state.trades.map(t => `
            <div class="grid grid-cols-7 text-xs py-2 border-b border-white/5 hover:bg-white/5">
                <div class="text-gray-500">${new Date(t.end).toLocaleTimeString()}</div>
                <div>${t.symbol}</div>
                <div class="${t.dir==='LONG'?'text-green-400':'text-red-400'}">${t.dir}</div>
                <div>${fmtPrice(t.entry)}</div>
                <div>${fmtPrice(t.exit)}</div>
                <div class="${t.pl>=0?'text-green-400':'text-red-400'}">${t.pl>=0?'+':''}$${t.pl.toFixed(2)}</div>
                <div>${t.status}</div>
            </div>
        `).join('');
        setText('totalPL', '$' + state.stats.pl.toFixed(2));
    }

    function updateChart() {
        if (!state.chart) return;
        const prices = state.klines[state.activeCrypto];
        if (prices) {
            state.chart.data.labels = prices.map((_, i) => i);
            state.chart.data.datasets[0].data = prices;
            state.chart.update();
        }
    }

    function updateSelectionUI() {
        CONFIG.cryptos.forEach(c => {
            const tab = el(`tab-${c.id}`);
            if (c.id === state.activeCrypto) tab.classList.add('active');
            else tab.classList.remove('active');
        });
        CONFIG.intervals.forEach((inv, i) => {
            const card = el(`card-${i}`);
            if (i === state.activeInterval) card.classList.add('active');
            else card.classList.remove('active');
        });
    }

    // ==========================================
    // 5. CORE LOGIC (10 PARAMS)
    // ==========================================
    async function fetchKlines(symbol) {
        try {
            const inv = CONFIG.intervals[state.activeInterval].bybit;
            const res = await fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${inv}&limit=50`);
            const data = await res.json();
            if (data.retCode === 0) {
                state.klines[symbol] = data.result.list.reverse().map(x => parseFloat(x[4]));
                calculateIndicators(symbol);
                updateChart();
            }
        } catch(e) { console.error(e); }
    }

    function calculateIndicators(symbol) {
        const prices = state.klines[symbol];
        if (!prices || prices.length < 20) return;
        
        const last = prices[prices.length-1];
        const prev = prices[prices.length-2];
        const prev10 = prices[prices.length-10];
        
        // 1. RSI (Simplified)
        let rsi = 50 + (Math.random()*10 - 5); 
        if (last > prev) rsi += 5; else rsi -= 5;
        
        // 2. MACD (Simulated convergence)
        const macd = (last - prev) * 100 / last;

        // 3. Bollinger %B
        const bb = 0.5 + ((last - prev) / last) * 10;

        // 4. Momentum
        const mom = (last - prev10);

        // 5. Volume (Simulated normalized)
        const vol = Math.random() > 0.5 ? 0.6 : -0.4;

        // 6. Orderbook (Derived from price direction)
        const ob = (last > prev) ? 0.7 : -0.7;

        // 7. Funding (Derived)
        const fund = (rsi > 70) ? 0.01 : -0.01;

        // 8. Fear & Greed (Normalized -1 to 1)
        const fg = (state.fearGreedValue - 50) / 50;

        // 9. Social Sentiment (Derived from Momentum + Vol)
        // Strong move + Volume = High Social chatter
        let social = (mom > 0 ? 0.5 : -0.5);
        if (Math.abs(mom) > (last*0.01)) social *= 1.5; // High viral potential

        // 10. News AI (Simulated External Factor)
        // Adds randomness representing external news events
        const news = (Math.random() - 0.5) * 2; 

        // Normalize all to -1 to 1 range for CPS calculation
        state.indicators[symbol] = {
            rsi: (rsi - 50) / 50,
            macd: Math.max(-1, Math.min(1, macd * 10)),
            bb: Math.max(-1, Math.min(1, (bb - 0.5) * 2)),
            mom: Math.max(-1, Math.min(1, mom / last * 100)),
            vol: vol,
            ob: ob,
            fund: fund * 100,
            fg: fg,
            social: Math.max(-1, Math.min(1, social)),
            news: news
        };

        if (symbol === state.activeCrypto) updateHeatmapUI();
        checkPredictions(symbol, last);
    }

    function checkPredictions(symbol, currentPrice) {
        if (!state.predictions[symbol]) state.predictions[symbol] = {};
        const now = Date.now();
        const ind = state.indicators[symbol];

        CONFIG.intervals.forEach((inv, i) => {
            let pred = state.predictions[symbol][inv.key];

            // Generate New Prediction
            if (!pred) {
                // Combine all 10 params
                let score = 0;
                CONFIG.params.forEach(p => score += (ind[p.key] || 0));
                
                // Threshold to enter trade
                if (Math.abs(score) > 2.5) { 
                    const dir = score > 0 ? 'LONG' : 'SHORT';
                    pred = {
                        entry: currentPrice,
                        target: currentPrice * (1 + (score * 0.001)), // Target based on score strength
                        dir: dir,
                        start: now,
                        end: now + (inv.seconds * 1000),
                        status: 'ACTIVE'
                    };
                    state.predictions[symbol][inv.key] = pred;
                }
            }

            // Evaluate Expired
            if (pred && pred.status === 'ACTIVE' && now >= pred.end) {
                const change = (currentPrice - pred.entry) / pred.entry;
                const pl = (pred.dir === 'LONG' ? change : -change) * CONFIG.investment;
                pred.exit = currentPrice;
                pred.pl = pl;
                pred.status = pl > 0 ? 'WIN' : 'LOSS';
                state.trades.unshift({...pred, symbol, end: now});
                if (state.trades.length > 20) state.trades.pop();
                state.stats.total++;
                if (pl > 0) state.stats.wins++;
                state.stats.pl += pl;
                state.predictions[symbol][inv.key] = null;
                updateTradeHistoryUI();
            }
        });
        if (symbol === state.activeCrypto) updatePredictionsUI();
    }

    // ==========================================
    // 6. INITIALIZATION
    // ==========================================
    function initDOM() {
        // Tabs
        el('cryptoTabs').innerHTML = CONFIG.cryptos.map(c => `
            <div id="tab-${c.id}" class="crypto-tab glass-panel px-4 py-2 flex items-center gap-3 shrink-0" data-id="${c.id}">
                <div class="font-bold" style="color:${c.color}">${c.symbol}</div>
                <div class="text-right"><div id="tp-${c.id}" class="text-sm font-mono">--</div><div id="tc-${c.id}" class="text-xs">--</div></div>
            </div>
        `).join('');
        document.querySelectorAll('.crypto-tab').forEach(t => t.addEventListener('click', () => {
            state.activeCrypto = t.dataset.id;
            updateSelectionUI();
            updateMainPrice(state.activeCrypto);
            fetchKlines(state.activeCrypto);
            updateHeatmapUI();
            updatePredictionsUI();
        }));

        // Cards
        el('predictionCards').innerHTML = CONFIG.intervals.map((inv, i) => `
            <div id="card-${i}" class="prediction-card glass-panel p-3">
                <div class="flex justify-between text-xs text-gray-400 mb-2"><span>${inv.label}</span></div>
                <div id="pt-${i}" class="font-bold mb-1">--</div>
                <div id="pd-${i}" class="text-xs">--</div>
                <div class="h-1 bg-gray-700 mt-2 rounded overflow-hidden"><div id="pprog-${i}" class="h-full bg-purple-500" style="width:0%"></div></div>
                <div class="text-xs text-gray-500 mt-1 text-right" id="ptime-${i}">Ready</div>
            </div>
        `).join('');
        document.querySelectorAll('.prediction-card').forEach((c, i) => c.addEventListener('click', () => {
            state.activeInterval = i;
            updateSelectionUI();
            fetchKlines(state.activeCrypto);
        }));

        // 10-Param Heatmap Structure
        el('paramHeatmap').innerHTML = CONFIG.params.map((p, i) => `
            <div id="hm-block-${i}" class="glass-panel p-2 flex flex-col justify-center items-center border-l-2 border-gray-600">
                <div class="text-xs text-gray-400 flex items-center gap-1"><span>${p.icon}</span> ${p.label}</div>
                <div id="hm-val-${i}" class="font-mono text-sm font-bold">--</div>
            </div>
        `).join('');

        // Chart
        const ctx = el('priceChart').getContext('2d');
        state.chart = new Chart(ctx, {
            type: 'line',
            data: { labels: [], datasets: [{ label: 'Price', data: [], borderColor: '#00d4ff', tension: 0.1, pointRadius: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, animation: false, scales: { x: {display:false}, y: {grid:{color:'#ffffff10'}} } }
        });

        updateSelectionUI();
    }

    function initWS() {
        const ws = new WebSocket(CONFIG.wsUrl);
        ws.onopen = () => {
            el('wsStatus').innerHTML = '<span class="text-green-400">● AI ONLINE</span>';
            ws.send(JSON.stringify({ op: 'subscribe', args: CONFIG.cryptos.map(c => `tickers.${c.id}`) }));
        };
        ws.onmessage = (e) => {
            const msg = JSON.parse(e.data);
            if (msg.topic?.startsWith('tickers.')) {
                const symbol = msg.topic.split('.')[1];
                const d = msg.data;
                if (!state.prices[symbol]) state.prices[symbol] = {};
                const p = state.prices[symbol];
                if (d.lastPrice) p.price = parseFloat(d.lastPrice);
                if (d.price24hPcnt) p.change = parseFloat(d.price24hPcnt) * 100;
                if (d.highPrice24h) p.high = parseFloat(d.highPrice24h);
                if (d.lowPrice24h) p.low = parseFloat(d.lowPrice24h);
                updateTabPrice(symbol);
                if (symbol === state.activeCrypto) {
                    updateMainPrice(symbol);
                    checkPredictions(symbol, p.price);
                }
            }
        };
        ws.onclose = () => setTimeout(initWS, 3000);
    }

    // Start
    initDOM();
    initWS();
    CONFIG.cryptos.forEach(c => fetchKlines(c.id));
    
    fetch('https://api.alternative.me/fng/?limit=1').then(r=>r.json()).then(d => {
        if(d.data && d.data[0]) {
            state.fearGreedValue = parseInt(d.data[0].value);
            setText('fgValue', state.fearGreedValue);
            setText('fgLabel', d.data[0].value_classification);
        }
    });

    setTimeout(() => el('loadingOverlay').classList.add('hidden'), 1000);
    setInterval(updatePredictionsUI, 1000);
});
