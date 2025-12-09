/**
 * CryptoOracle Pro - Enhanced Compliance Edition
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
        // Expanded Timeframes per ToR
        intervals: [
            { label: '1M', seconds: 60, key: '1m', bybit: '1' },
            { label: '5M', seconds: 300, key: '5m', bybit: '5' },
            { label: '15M', seconds: 900, key: '15m', bybit: '15' },
            { label: '1H', seconds: 3600, key: '1h', bybit: '60' },
            { label: '4H', seconds: 14400, key: '4h', bybit: '240' },
            { label: '6H', seconds: 21600, key: '6h', bybit: '360' },
            { label: '1D', seconds: 86400, key: '1d', bybit: 'D' },
            { label: '1W', seconds: 604800, key: '1w', bybit: 'W' }
        ],
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
        baseInvestment: 100 // Fixed per ToR
    };

    // ==========================================
    // 2. STATE
    // ==========================================
    const state = {
        activeCrypto: 'BTCUSDT',
        activeInterval: 0,
        currentLeverage: 20,
        prices: {},
        klines: {},     // Stores open, high, low, close, vol
        indicators: {}, 
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

        let totalScore = 0;
        let count = 0;

        CONFIG.params.forEach((p, i) => {
            const val = ind[p.key] || 0;
            totalScore += val;
            count++;
            
            // Convert normalized -1 to 1 value to display percentage
            const displayVal = (val * 100).toFixed(0);
            setText(`hm-val-${i}`, displayVal + '%');
            const block = el(`hm-block-${i}`);
            
            let colorClass = 'border-l-2 border-gray-600';
            if (val > 0.2) colorClass = 'border-l-2 border-green-500 bg-green-500/10';
            else if (val < -0.2) colorClass = 'border-l-2 border-red-500 bg-red-500/10';
            else colorClass = 'border-l-2 border-purple-500 bg-purple-500/5';
            
            if (block) block.className = `glass-panel p-2 flex flex-col justify-center ${colorClass}`;
        });

        // CPS (Composite Prediction Score)
        const cps = totalScore / count; 
        const confidence = Math.round(Math.abs(cps) * 100);
        setText('cpsValue', confidence);
        
        let label = 'NEUTRAL';
        if (cps > 0.15) label = 'BUY';
        if (cps > 0.45) label = 'STRONG BUY';
        if (cps < -0.15) label = 'SELL';
        if (cps < -0.45) label = 'STRONG SELL';
        
        setText('cpsLabel', label);
        setClass('cpsLabel', `text-sm px-3 py-1 rounded border ${cps > 0 ? 'border-green-500 bg-green-900/50' : cps < 0 ? 'border-red-500 bg-red-900/50' : 'border-gray-500'}`);
        el('cpsValue').className = `text-4xl font-bold mb-2 ${cps > 0 ? 'text-green-400' : cps < 0 ? 'text-red-400' : 'text-white'}`;
    }

    function updatePredictionsUI() {
        const preds = state.predictions[state.activeCrypto];
        if (!preds) return;
        
        CONFIG.intervals.forEach((inv, i) => {
            const pred = preds[inv.key];
            if (pred && pred.status === 'ACTIVE') {
                setText(`pt-${i}`, fmtPrice(pred.target));
                setText(`pd-${i}`, pred.dir);
                setClass(`pd-${i}`, `text-xs font-bold ${pred.dir==='LONG'?'text-green-400':'text-red-400'}`);
                
                const timeLeft = Math.max(0, (pred.end - Date.now())/1000);
                setText(`ptime-${i}`, timeLeft > 60 ? (timeLeft/60).toFixed(0)+'m' : timeLeft.toFixed(0)+'s');
                
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
        
        // Update Leverage Display text
        setText('activeLeverageDisplay', `${state.currentLeverage}x LEV`);
    }

    function updateTradeHistoryUI() {
        const container = el('tradeHistory');
        // Render trades
        container.innerHTML = state.trades.map(t => `
            <div class="grid grid-cols-7 text-xs py-2 border-b border-white/5 hover:bg-white/5">
                <div class="text-gray-500">${new Date(t.end).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                <div>${t.symbol}</div>
                <div class="${t.dir==='LONG'?'text-green-400':'text-red-400'}">${t.dir}</div>
                <div class="text-purple-400">${t.leverage}x</div>
                <div>${fmtPrice(t.entry)}</div>
                <div>${fmtPrice(t.exit)}</div>
                <div class="${t.pl>=0?'text-green-400':'text-red-400'}">${t.pl>=0?'+':''}$${t.pl.toFixed(2)}</div>
            </div>
        `).join('');
        setText('totalPL', '$' + state.stats.pl.toFixed(2));
    }

    function updateChart() {
        if (!state.chart) return;
        const klineData = state.klines[state.activeCrypto];
        if (klineData && klineData.close) {
            state.chart.data.labels = klineData.close.map((_, i) => i);
            state.chart.data.datasets[0].data = klineData.close;
            state.chart.update();
        }
    }

    // ==========================================
    // 5. CORE LOGIC (REAL TECHNICAL ANALYSIS)
    // ==========================================
    async function fetchKlines(symbol) {
        try {
            const inv = CONFIG.intervals[state.activeInterval].bybit;
            // Fetching 200 candles for better indicator accuracy
            const res = await fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${inv}&limit=200`);
            const data = await res.json();
            
            if (data.retCode === 0) {
                const list = data.result.list.reverse();
                // Store separated arrays for technical indicators
                state.klines[symbol] = {
                    open: list.map(x => parseFloat(x[1])),
                    high: list.map(x => parseFloat(x[2])),
                    low: list.map(x => parseFloat(x[3])),
                    close: list.map(x => parseFloat(x[4])),
                    volume: list.map(x => parseFloat(x[5])),
                };
                
                calculateIndicators(symbol);
                updateChart();
            }
        } catch(e) { console.error("API Error:", e); }
    }

    function calculateIndicators(symbol) {
        const data = state.klines[symbol];
        if (!data || data.close.length < 50) return;

        const closes = data.close;
        const volumes = data.volume;
        const lastPrice = closes[closes.length - 1];

        // 1. RSI (Real Math)
        const rsiVals = window.RSI.calculate({values: closes, period: 14});
        const currentRSI = rsiVals[rsiVals.length - 1];
        // Normalize RSI (30 is buy, 70 is sell) -> -1 to 1
        // 30 -> 1 (Buy), 70 -> -1 (Sell), 50 -> 0
        const normRSI = (50 - currentRSI) / 25; 

        // 2. MACD (Real Math)
        const macdVals = window.MACD.calculate({
            values: closes,
            fastPeriod: 12,
            slowPeriod: 26,
            signalPeriod: 9,
            SimpleMAOscillator: false,
            SimpleMASignal: false
        });
        const currentMACD = macdVals[macdVals.length - 1];
        // Signal > Histogram usually indicates trend
        const normMACD = currentMACD.histogram > 0 ? 0.6 : -0.6;

        // 3. Bollinger Bands (Real Math)
        const bbVals = window.BollingerBands.calculate({period: 20, values: closes, stdDev: 2});
        const currBB = bbVals[bbVals.length - 1];
        // If price < lower band -> Buy (oversold)
        // If price > upper band -> Sell (overbought)
        let normBB = 0;
        if (lastPrice < currBB.lower) normBB = 0.8;
        else if (lastPrice > currBB.upper) normBB = -0.8;

        // 4. Momentum (ROC)
        const prev10 = closes[closes.length - 10];
        const mom = lastPrice - prev10;
        const normMom = Math.max(-1, Math.min(1, mom / lastPrice * 50));

        // 5. Volume Trend
        // Compare recent avg volume to historical avg
        const volSMA = volumes.slice(-10).reduce((a,b)=>a+b)/10;
        const volLongSMA = volumes.slice(-50).reduce((a,b)=>a+b)/50;
        const normVol = volSMA > volLongSMA ? 0.5 : -0.2; // High vol usually confirms trend

        // 6. Orderbook Proxy (Price Action)
        // If High - Close < Close - Low => Buying Pressure (Wick at bottom)
        const lastCandle = {h: data.high[data.high.length-1], l: data.low[data.low.length-1], c: lastPrice};
        const upperWick = lastCandle.h - lastCandle.c;
        const lowerWick = lastCandle.c - lastCandle.l;
        const normOB = lowerWick > upperWick ? 0.4 : -0.4;

        // 7. Funding (Derived from Trend)
        // In strong up trends, funding is usually positive (longs pay shorts)
        const normFund = normMom > 0.5 ? -0.2 : 0.2; // Contrarian indicator

        // 8. Fear & Greed (External)
        // 0 (Fear) -> Buy, 100 (Greed) -> Sell
        const normFG = (50 - state.fearGreedValue) / 50;

        // 9. Social Sentiment (Derived Algorithm)
        // High Volatility + High Volume = High Social Engagement (Viral)
        // If price is up AND volume is high = Positive Sentiment
        const volatility = (lastCandle.h - lastCandle.l) / lastPrice;
        let social = 0;
        if (volatility > 0.005 && normVol > 0) {
            social = normMom > 0 ? 0.8 : -0.8; 
        } else {
            social = normMom * 0.3;
        }

        // 10. News AI (Derived Algorithm)
        // Large sudden spikes often indicate news
        let news = 0;
        const priceChange = (lastPrice - prev10) / prev10;
        if (Math.abs(priceChange) > 0.01) {
            news = priceChange > 0 ? 0.9 : -0.9;
        }

        // Store Normalized Values (-1 to 1)
        state.indicators[symbol] = {
            rsi: Math.max(-1, Math.min(1, normRSI)),
            macd: normMACD,
            bb: normBB,
            mom: normMom,
            vol: normVol,
            ob: normOB,
            fund: normFund,
            fg: normFG,
            social: social,
            news: news
        };

        if (symbol === state.activeCrypto) updateHeatmapUI();
        checkPredictions(symbol, lastPrice);
    }

    function checkPredictions(symbol, currentPrice) {
        if (!state.predictions[symbol]) state.predictions[symbol] = {};
        const now = Date.now();
        const ind = state.indicators[symbol];

        CONFIG.intervals.forEach((inv, i) => {
            let pred = state.predictions[symbol][inv.key];

            // 1. Create New Prediction if slot is empty
            if (!pred) {
                let score = 0;
                // Sum up weighted indicators
                CONFIG.params.forEach(p => score += (ind[p.key] || 0));
                
                // Entry Threshold (Must be strong signal)
                if (Math.abs(score) > 2.0) { 
                    const dir = score > 0 ? 'LONG' : 'SHORT';
                    // Target calculation: proportional to timeframe
                    const volatilityMultiplier = (inv.seconds / 60) * 0.0005; 
                    const target = currentPrice * (1 + (dir==='LONG' ? volatilityMultiplier : -volatilityMultiplier));
                    
                    pred = {
                        entry: currentPrice,
                        target: target,
                        dir: dir,
                        leverage: parseInt(el('leverageSelect').value),
                        start: now,
                        end: now + (inv.seconds * 1000),
                        status: 'ACTIVE'
                    };
                    state.predictions[symbol][inv.key] = pred;
                }
            }

            // 2. Check Expired Prediction
            if (pred && pred.status === 'ACTIVE' && now >= pred.end) {
                const exitPrice = currentPrice;
                // P/L Math: (Exit - Entry) / Entry * Leverage * Investment
                let pctChange = (exitPrice - pred.entry) / pred.entry;
                if (pred.dir === 'SHORT') pctChange = -pctChange;
                
                const pl = pctChange * pred.leverage * CONFIG.baseInvestment;

                // Update State
                pred.exit = exitPrice;
                pred.pl = pl;
                pred.status = pl > 0 ? 'WIN' : 'LOSS';
                
                // Add to history
                state.trades.unshift({...pred, symbol, end: now});
                if (state.trades.length > 50) state.trades.pop(); // Keep last 50
                
                // Update Stats
                state.stats.total++;
                if (pl > 0) state.stats.wins++;
                state.stats.pl += pl;
                
                // Clear active slot
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
        // Handle Leverage Change
        el('leverageSelect').addEventListener('change', (e) => {
            state.currentLeverage = parseInt(e.target.value);
            updatePredictionsUI();
        });

        // Tabs
        el('cryptoTabs').innerHTML = CONFIG.cryptos.map(c => `
            <div id="tab-${c.id}" class="crypto-tab glass-panel px-4 py-2 flex items-center gap-3 shrink-0" data-id="${c.id}">
                <div class="font-bold" style="color:${c.color}">${c.symbol}</div>
                <div class="text-right"><div id="tp-${c.id}" class="text-sm font-mono">--</div><div id="tc-${c.id}" class="text-xs">--</div></div>
            </div>
        `).join('');
        
        document.querySelectorAll('.crypto-tab').forEach(t => t.addEventListener('click', () => {
            // Remove active class from old
            document.querySelectorAll('.crypto-tab').forEach(tab => tab.classList.remove('active'));
            // Add to new
            t.classList.add('active');
            
            state.activeCrypto = t.dataset.id;
            updateMainPrice(state.activeCrypto);
            fetchKlines(state.activeCrypto);
            updateHeatmapUI();
            updatePredictionsUI();
        }));

        // Cards Grid (Now handles dynamic number of intervals)
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
             document.querySelectorAll('.prediction-card').forEach(card => card.classList.remove('active'));
             c.classList.add('active');
            state.activeInterval = i;
            fetchKlines(state.activeCrypto);
        }));

        // Heatmap Grid
        el('paramHeatmap').innerHTML = CONFIG.params.map((p, i) => `
            <div id="hm-block-${i}" class="glass-panel p-2 flex flex-col justify-center items-center border-l-2 border-gray-600">
                <div class="text-xs text-gray-400 flex items-center gap-1"><span>${p.icon}</span> ${p.label}</div>
                <div id="hm-val-${i}" class="font-mono text-sm font-bold">--</div>
            </div>
        `).join('');

        // Chart Init
        const ctx = el('priceChart').getContext('2d');
        state.chart = new Chart(ctx, {
            type: 'line',
            data: { labels: [], datasets: [{ label: 'Price', data: [], borderColor: '#00d4ff', backgroundColor: 'rgba(0, 212, 255, 0.1)', borderWidth: 2, fill: true, tension: 0.4, pointRadius: 0 }] },
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                animation: false, 
                plugins: { legend: {display: false} },
                scales: { 
                    x: {display:false}, 
                    y: {grid:{color:'#ffffff05'}, ticks:{color:'#666', callback: (v)=>'$'+v}} 
                } 
            }
        });

        // Set initial active
        document.querySelector(`[data-id="${state.activeCrypto}"]`).classList.add('active');
        el(`card-${state.activeInterval}`).classList.add('active');
    }

    function initWS() {
        const ws = new WebSocket(CONFIG.wsUrl);
        ws.onopen = () => {
            el('wsStatus').innerHTML = '<span class="text-green-400">● AI ONLINE</span>';
            // Subscribe to all tickers
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
                    // Check predictions on every price update
                    checkPredictions(symbol, p.price);
                }
            }
        };
        ws.onclose = () => setTimeout(initWS, 3000); // Auto Reconnect
    }

    // ==========================================
    // 7. BOOTSTRAP
    // ==========================================
    initDOM();
    initWS();
    CONFIG.cryptos.forEach(c => fetchKlines(c.id));
    
    // Fetch Real External Fear & Greed Data
    fetch('https://api.alternative.me/fng/?limit=1')
        .then(r=>r.json())
        .then(d => {
            if(d.data && d.data[0]) {
                state.fearGreedValue = parseInt(d.data[0].value);
                setText('fgValue', state.fearGreedValue);
                setText('fgLabel', d.data[0].value_classification.toUpperCase());
            }
        }).catch(e => console.log('F&G Error', e));

    // Remove loader
    setTimeout(() => el('loadingOverlay').classList.add('hidden'), 1500);
    // UI Refresh Loop
    setInterval(updatePredictionsUI, 1000);
});
