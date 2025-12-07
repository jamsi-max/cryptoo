/**
 * CryptoOracle Pro - Stable Version
 * Fixed: Price flickering, proper data merging, stable WebSocket
 */

(function() {
    'use strict';

    // ==========================================
    // CONFIGURATION
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
            { label: '1 MIN', seconds: 60, key: '1m', bybit: '1' },
            { label: '5 MIN', seconds: 300, key: '5m', bybit: '5' },
            { label: '15 MIN', seconds: 900, key: '15m', bybit: '15' },
            { label: '1 HOUR', seconds: 3600, key: '1h', bybit: '60' },
            { label: '4 HOURS', seconds: 14400, key: '4h', bybit: '240' },
            { label: '1 DAY', seconds: 86400, key: '1d', bybit: 'D' },
            { label: '1 WEEK', seconds: 604800, key: '1w', bybit: 'W' }
        ],
        investment: 100,
        api: 'https://api.bybit.com',
        wsUrl: 'wss://stream.bybit.com/v5/public/linear'
    };

    // ==========================================
    // STATE - Single source of truth
    // ==========================================
    const state = {
        currentCrypto: 'BTCUSDT',
        currentInterval: 0,
        chartRange: '1d',
        
        // Price data - NEVER reset to null once populated
        prices: {},
        klines: {},
        openInterest: {},
        
        // Predictions - locked until expiry
        predictions: {},
        
        // Indicators
        indicators: {},
        
        // Trade history
        trades: [],
        
        // Stats
        stats: { total: 0, wins: 0, losses: 0, totalPL: 0 },
        
        // Fear & Greed
        fearGreed: { value: 50, label: 'Neutral' },
        
        // Countdown
        countdown: 60,
        
        // WebSocket
        ws: null,
        wsReady: false,
        
        // Chart instance
        chart: null,
        
        // Initialization flag
        initialized: false
    };

    // ==========================================
    // SAFE DOM ACCESS
    // ==========================================
    function $(id) {
        return document.getElementById(id);
    }

    function setText(id, text) {
        const el = $(id);
        if (el && text !== undefined && text !== null) {
            el.textContent = text;
        }
    }

    function setHtml(id, html) {
        const el = $(id);
        if (el && html !== undefined) {
            el.innerHTML = html;
        }
    }

    function setClass(id, className) {
        const el = $(id);
        if (el) {
            el.className = className;
        }
    }

    function setStyle(id, prop, value) {
        const el = $(id);
        if (el) {
            el.style[prop] = value;
        }
    }

    // ==========================================
    // NUMBER FORMATTING
    // ==========================================
    function formatPrice(price) {
        if (price === null || price === undefined || isNaN(price)) return '--';
        if (price >= 10000) return '$' + price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
        if (price >= 1000) return '$' + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (price >= 1) return '$' + price.toFixed(2);
        if (price >= 0.01) return '$' + price.toFixed(4);
        return '$' + price.toFixed(6);
    }

    function formatVolume(vol) {
        if (!vol || isNaN(vol)) return '--';
        if (vol >= 1e12) return '$' + (vol / 1e12).toFixed(2) + 'T';
        if (vol >= 1e9) return '$' + (vol / 1e9).toFixed(2) + 'B';
        if (vol >= 1e6) return '$' + (vol / 1e6).toFixed(2) + 'M';
        if (vol >= 1e3) return '$' + (vol / 1e3).toFixed(2) + 'K';
        return '$' + vol.toFixed(0);
    }

    function formatPercent(pct) {
        if (pct === null || pct === undefined || isNaN(pct)) return '0.00%';
        return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
    }

    function formatTimeLeft(ms) {
        if (ms <= 0) return 'Expired';
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const h = Math.floor(m / 60);
        if (h > 0) return h + 'h ' + (m % 60) + 'm';
        if (m > 0) return m + 'm ' + (s % 60) + 's';
        return s + 's';
    }

    // ==========================================
    // API FUNCTIONS
    // ==========================================
    async function fetchTicker(symbol) {
        try {
            const res = await fetch(`${CONFIG.api}/v5/market/tickers?category=linear&symbol=${symbol}`);
            const json = await res.json();
            
            if (json.retCode === 0 && json.result?.list?.[0]) {
                const t = json.result.list[0];
                return {
                    price: parseFloat(t.lastPrice) || 0,
                    change24h: (parseFloat(t.price24hPcnt) || 0) * 100,
                    high24h: parseFloat(t.highPrice24h) || 0,
                    low24h: parseFloat(t.lowPrice24h) || 0,
                    volume24h: parseFloat(t.turnover24h) || 0,
                    fundingRate: (parseFloat(t.fundingRate) || 0) * 100
                };
            }
        } catch (e) {
            console.error('fetchTicker error:', symbol, e);
        }
        return null;
    }

    async function fetchKlines(symbol, interval, limit = 100) {
        try {
            const res = await fetch(
                `${CONFIG.api}/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`
            );
            const json = await res.json();
            
            if (json.retCode === 0 && json.result?.list) {
                return json.result.list.reverse().map(k => ({
                    time: parseInt(k[0]),
                    open: parseFloat(k[1]),
                    high: parseFloat(k[2]),
                    low: parseFloat(k[3]),
                    close: parseFloat(k[4]),
                    volume: parseFloat(k[5])
                }));
            }
        } catch (e) {
            console.error('fetchKlines error:', symbol, e);
        }
        return [];
    }

    async function fetchOpenInterest(symbol) {
        try {
            const res = await fetch(
                `${CONFIG.api}/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=1h&limit=1`
            );
            const json = await res.json();
            
            if (json.retCode === 0 && json.result?.list?.[0]) {
                return parseFloat(json.result.list[0].openInterest) || 0;
            }
        } catch (e) {
            console.error('fetchOpenInterest error:', e);
        }
        return 0;
    }

    async function fetchOrderbook(symbol) {
        try {
            const res = await fetch(
                `${CONFIG.api}/v5/market/orderbook?category=linear&symbol=${symbol}&limit=25`
            );
            const json = await res.json();
            
            if (json.retCode === 0 && json.result) {
                const bids = json.result.b.reduce((s, b) => s + parseFloat(b[1]), 0);
                const asks = json.result.a.reduce((s, a) => s + parseFloat(a[1]), 0);
                const total = bids + asks;
                return total > 0 ? (bids - asks) / total : 0;
            }
        } catch (e) {
            console.error('fetchOrderbook error:', e);
        }
        return 0;
    }

    async function fetchFearGreed() {
        try {
            const res = await fetch('https://api.alternative.me/fng/?limit=1');
            const json = await res.json();
            
            if (json.data?.[0]) {
                return {
                    value: parseInt(json.data[0].value) || 50,
                    label: json.data[0].value_classification || 'Neutral'
                };
            }
        } catch (e) {
            console.error('fetchFearGreed error:', e);
        }
        return { value: 50, label: 'Neutral' };
    }

    // ==========================================
    // WEBSOCKET - Stable connection
    // ==========================================
    function connectWebSocket() {
        if (state.ws) {
            try { state.ws.close(); } catch(e) {}
        }

        updateConnectionStatus('connecting');

        try {
            state.ws = new WebSocket(CONFIG.wsUrl);
        } catch (e) {
            console.error('WebSocket creation failed:', e);
            setTimeout(connectWebSocket, 5000);
            return;
        }

        state.ws.onopen = function() {
            console.log('✅ WebSocket connected');
            state.wsReady = true;
            updateConnectionStatus('connected');
            
            // Subscribe to all tickers
            const args = CONFIG.cryptos.map(c => 'tickers.' + c.id);
            state.ws.send(JSON.stringify({ op: 'subscribe', args: args }));
        };

        state.ws.onmessage = function(event) {
            try {
                const msg = JSON.parse(event.data);
                
                // Handle ticker updates
                if (msg.topic && msg.topic.startsWith('tickers.') && msg.data) {
                    handleTickerMessage(msg.topic.replace('tickers.', ''), msg.data);
                }
            } catch (e) {
                // Ignore parse errors (ping/pong)
            }
        };

        state.ws.onclose = function() {
            console.log('❌ WebSocket closed');
            state.wsReady = false;
            updateConnectionStatus('disconnected');
            setTimeout(connectWebSocket, 3000);
        };

        state.ws.onerror = function() {
            console.error('WebSocket error');
            state.wsReady = false;
            updateConnectionStatus('disconnected');
        };
    }

    function handleTickerMessage(symbol, data) {
        // Get existing price data or create new object
        const existing = state.prices[symbol] || {};
        
        // MERGE data - only update fields that are present and valid
        const newPrice = parseFloat(data.lastPrice);
        const newChange = parseFloat(data.price24hPcnt);
        const newHigh = parseFloat(data.highPrice24h);
        const newLow = parseFloat(data.lowPrice24h);
        const newVolume = parseFloat(data.turnover24h);
        const newFunding = parseFloat(data.fundingRate);
        
        // Only update if value is valid (not NaN)
        state.prices[symbol] = {
            price: !isNaN(newPrice) ? newPrice : existing.price,
            change24h: !isNaN(newChange) ? newChange * 100 : existing.change24h,
            high24h: !isNaN(newHigh) ? newHigh : existing.high24h,
            low24h: !isNaN(newLow) ? newLow : existing.low24h,
            volume24h: !isNaN(newVolume) ? newVolume : existing.volume24h,
            fundingRate: !isNaN(newFunding) ? newFunding * 100 : existing.fundingRate,
            lastUpdate: Date.now()
        };
        
        // Update UI
        if (symbol === state.currentCrypto) {
            updatePriceDisplay();
        }
        updateTabPrice(symbol);
    }

    function updateConnectionStatus(status) {
        const el = $('wsStatus');
        if (!el) return;
        
        const configs = {
            connected: { cls: 'connection-status connected', text: 'Live' },
            disconnected: { cls: 'connection-status disconnected', text: 'Offline' },
            connecting: { cls: 'connection-status connecting', text: 'Connecting...' }
        };
        
        const cfg = configs[status] || configs.connecting;
        el.className = cfg.cls;
        el.innerHTML = '<div class="status-dot"></div><span>' + cfg.text + '</span>';
    }

    // ==========================================
    // INDICATORS
    // ==========================================
    function calcRSI(prices, period) {
        period = period || 14;
        if (prices.length < period + 1) return 50;
        
        let gains = 0, losses = 0;
        for (let i = prices.length - period; i < prices.length; i++) {
            const diff = prices[i] - prices[i - 1];
            if (diff > 0) gains += diff;
            else losses -= diff;
        }
        
        if (losses === 0) return 100;
        const rs = (gains / period) / (losses / period);
        return 100 - (100 / (1 + rs));
    }

    function calcMACD(prices) {
        if (prices.length < 26) return 0;
        
        function ema(data, period) {
            const k = 2 / (period + 1);
            let result = 0;
            for (let i = 0; i < period && i < data.length; i++) {
                result += data[i];
            }
            result /= Math.min(period, data.length);
            
            for (let i = period; i < data.length; i++) {
                result = data[i] * k + result * (1 - k);
            }
            return result;
        }
        
        return ema(prices, 12) - ema(prices, 26);
    }

    function calcBollinger(prices, period) {
        period = period || 20;
        if (prices.length < period) return 0.5;
        
        const slice = prices.slice(-period);
        let sum = 0;
        for (let i = 0; i < slice.length; i++) sum += slice[i];
        const avg = sum / period;
        
        let variance = 0;
        for (let i = 0; i < slice.length; i++) {
            variance += (slice[i] - avg) * (slice[i] - avg);
        }
        const std = Math.sqrt(variance / period);
        
        if (std === 0) return 0.5;
        const current = prices[prices.length - 1];
        const lower = avg - 2 * std;
        const upper = avg + 2 * std;
        return (current - lower) / (upper - lower);
    }

    function calcMomentum(prices, period) {
        period = period || 10;
        if (prices.length < period + 1) return 0;
        const current = prices[prices.length - 1];
        const past = prices[prices.length - period - 1];
        if (past === 0) return 0;
        return ((current - past) / past) * 100;
    }

    async function calculateAllIndicators(symbol) {
        const klines = state.klines[symbol];
        if (!klines || klines.length < 30) return null;
        
        const closes = klines.map(function(k) { return k.close; });
        const priceData = state.prices[symbol];
        
        // Fetch additional data
        const orderbook = await fetchOrderbook(symbol);
        const oi = await fetchOpenInterest(symbol);
        state.openInterest[symbol] = oi;
        
        // Calculate indicators
        const rsi = calcRSI(closes);
        const macd = calcMACD(closes);
        const bb = calcBollinger(closes);
        const mom = calcMomentum(closes);
        
        // Normalize to -1 to 1
        const currentPrice = priceData?.price || closes[closes.length - 1];
        
        state.indicators[symbol] = {
            rsi: (50 - rsi) / 50,
            macd: Math.max(-1, Math.min(1, macd / currentPrice * 100)),
            bollinger: (0.5 - bb) * 2,
            momentum: Math.max(-1, Math.min(1, mom / 5)),
            orderbook: orderbook,
            funding: priceData?.fundingRate ? -Math.max(-1, Math.min(1, priceData.fundingRate * 10)) : 0,
            fearGreed: (50 - state.fearGreed.value) / 50
        };
        
        return state.indicators[symbol];
    }

    // ==========================================
    // CPS CALCULATION
    // ==========================================
    function calculateCPS(indicators) {
        if (!indicators) return 0;
        
        const weights = {
            rsi: 0.18,
            macd: 0.15,
            bollinger: 0.12,
            momentum: 0.15,
            orderbook: 0.15,
            funding: 0.13,
            fearGreed: 0.12
        };
        
        let cps = 0;
        for (const key in weights) {
            if (indicators[key] !== undefined) {
                cps += (indicators[key] || 0) * weights[key];
            }
        }
        
        return Math.max(-1, Math.min(1, cps));
    }

    function getCPSInfo(cps) {
        if (cps >= 0.4) return { label: 'STRONG BUY', color: '#00ff88', dir: 'LONG' };
        if (cps >= 0.1) return { label: 'BUY', color: '#00dd66', dir: 'LONG' };
        if (cps >= -0.1) return { label: 'NEUTRAL', color: '#9945ff', dir: 'LONG' };
        if (cps >= -0.4) return { label: 'SELL', color: '#ff6644', dir: 'SHORT' };
        return { label: 'STRONG SELL', color: '#ff3366', dir: 'SHORT' };
    }

    // ==========================================
    // PREDICTIONS
    // ==========================================
    function createPrediction(symbol, intervalCfg) {
        const priceData = state.prices[symbol];
        const indicators = state.indicators[symbol];
        
        if (!priceData || !priceData.price || !indicators) return null;
        
        const cps = calculateCPS(indicators);
        const info = getCPSInfo(cps);
        
        // Calculate target
        const volatility = 0.008;
        const timeFactor = Math.sqrt(intervalCfg.seconds / 60);
        const direction = info.dir === 'LONG' ? 1 : -1;
        const magnitude = Math.abs(cps);
        
        const move = priceData.price * volatility * timeFactor * magnitude * direction;
        const target = priceData.price + move;
        
        return {
            id: symbol + '-' + intervalCfg.key + '-' + Date.now(),
            symbol: symbol,
            interval: intervalCfg.key,
            intervalLabel: intervalCfg.label,
            entryPrice: priceData.price,
            targetPrice: target,
            direction: info.dir,
            cps: cps,
            confidence: Math.round(50 + magnitude * 40),
            createdAt: Date.now(),
            expiresAt: Date.now() + intervalCfg.seconds * 1000,
            status: 'ACTIVE',
            exitPrice: null,
            pl: null,
            accuracy: null
        };
    }

    function generatePredictions(symbol) {
        if (!state.predictions[symbol]) {
            state.predictions[symbol] = {};
        }
        
        for (let i = 0; i < CONFIG.intervals.length; i++) {
            const interval = CONFIG.intervals[i];
            const existing = state.predictions[symbol][interval.key];
            
            // Only create if no active prediction exists
            if (!existing || existing.status !== 'ACTIVE') {
                const pred = createPrediction(symbol, interval);
                if (pred) {
                    state.predictions[symbol][interval.key] = pred;
                    console.log('📊 New prediction:', symbol, interval.label, pred.direction);
                }
            }
        }
    }

    function checkExpiredPredictions() {
        const now = Date.now();
        
        for (const symbol in state.predictions) {
            for (const intervalKey in state.predictions[symbol]) {
                const pred = state.predictions[symbol][intervalKey];
                if (pred && pred.status === 'ACTIVE' && now >= pred.expiresAt) {
                    evaluatePrediction(pred);
                }
            }
        }
    }

    function evaluatePrediction(pred) {
        const priceData = state.prices[pred.symbol];
        if (!priceData || !priceData.price) return;
        
        const exitPrice = priceData.price;
        const entryPrice = pred.entryPrice;
        const change = (exitPrice - entryPrice) / entryPrice;
        
        // Calculate P/L
        let pl;
        if (pred.direction === 'LONG') {
            pl = change * CONFIG.investment;
        } else {
            pl = -change * CONFIG.investment;
        }
        
        // Calculate accuracy
        const predictedChange = (pred.targetPrice - entryPrice) / entryPrice;
        const actualDir = change > 0 ? 'LONG' : 'SHORT';
        const correct = pred.direction === actualDir;
        
        let accuracy;
        if (correct) {
            accuracy = Math.min(100, 50 + Math.abs(change / predictedChange) * 30);
        } else {
            accuracy = Math.max(0, 50 - Math.abs(change) * 500);
        }
        
        // Update prediction
        pred.exitPrice = exitPrice;
        pred.pl = pl;
        pred.accuracy = accuracy;
        pred.status = pl >= 0 ? 'WON' : 'LOST';
        
        // Add to history
        state.trades.unshift(Object.assign({}, pred));
        if (state.trades.length > 50) state.trades.pop();
        
        // Update stats
        state.stats.total++;
        if (pl >= 0) state.stats.wins++;
        else state.stats.losses++;
        state.stats.totalPL += pl;
        
        console.log('✅ Trade closed:', pred.symbol, pred.direction, 'P/L: $' + pl.toFixed(2));
        
        // Create new prediction
        const interval = CONFIG.intervals.find(function(i) { return i.key === pred.interval; });
        if (interval) {
            const newPred = createPrediction(pred.symbol, interval);
            if (newPred) {
                state.predictions[pred.symbol][pred.interval] = newPred;
            }
        }
        
        // Update UI
        renderTradeHistory();
        updateStatsDisplay();
    }

    // ==========================================
    // UI UPDATES
    // ==========================================
    function updatePriceDisplay() {
        const data = state.prices[state.currentCrypto];
        if (!data || !data.price) return;
        
        setText('livePrice', formatPrice(data.price));
        
        const change = data.change24h || 0;
        setText('priceChange', formatPercent(change));
        setClass('priceChange', 'text-lg ' + (change >= 0 ? 'text-green-400' : 'text-red-400'));
        
        setText('high24h', formatPrice(data.high24h));
        setText('low24h', formatPrice(data.low24h));
        setText('volume24h', formatVolume(data.volume24h));
        
        // Funding rate
        const fr = data.fundingRate || 0;
        setText('fundingRate', 'Funding: ' + formatPercent(fr));
        setClass('fundingRate', 'funding-rate ' + (fr > 0 ? 'positive' : fr < 0 ? 'negative' : 'neutral'));
        
        // Open interest
        const oi = state.openInterest[state.currentCrypto];
        if (oi && data.price) {
            setText('openInterest', formatVolume(oi * data.price));
        }
    }

    function updateTabPrice(symbol) {
        const data = state.prices[symbol];
        if (!data || !data.price) return;
        
        setText('tab-price-' + symbol, formatPrice(data.price));
        
        const change = data.change24h || 0;
        const el = $('tab-change-' + symbol);
        if (el) {
            el.textContent = formatPercent(change);
            el.className = 'text-xs ' + (change >= 0 ? 'text-green-400' : 'text-red-400');
        }
    }

    function updateCPSDisplay() {
        const indicators = state.indicators[state.currentCrypto];
        const cps = calculateCPS(indicators);
        const info = getCPSInfo(cps);
        
        // Gauge needle rotation
        const angle = cps * 90;
        setStyle('gaugeNeedle', 'transform', 'translateX(-50%) rotate(' + angle + 'deg)');
        
        setText('cpsValue', Math.round(cps * 100));
        setStyle('cpsValue', 'color', info.color);
        setText('cpsLabel', info.label);
        setStyle('cpsLabel', 'color', info.color);
    }

    function updateFearGreedDisplay() {
        const fg = state.fearGreed;
        setText('fgValue', fg.value);
        setText('fgLabel', fg.label.toUpperCase());
        
        const offset = 283 - (fg.value / 100) * 283;
        setStyle('fgCircle', 'strokeDashoffset', offset);
        
        let color = '#9945ff';
        if (fg.value < 25) color = '#ff3366';
        else if (fg.value < 45) color = '#ff6644';
        else if (fg.value >= 75) color = '#00ff88';
        else if (fg.value >= 55) color = '#00dd66';
        
        setStyle('fgCircle', 'stroke', color);
    }

    function updateStatsDisplay() {
        const s = state.stats;
        const winRate = s.total > 0 ? (s.wins / s.total * 100) : 0;
        
        setText('winRate', winRate.toFixed(1) + '%');
        setText('totalTrades', s.total);
        setText('winningTrades', s.wins);
        setText('losingTrades', s.losses);
        
        const plEl = $('totalPL');
        if (plEl) {
            plEl.textContent = (s.totalPL >= 0 ? '+' : '') + '$' + s.totalPL.toFixed(2);
            plEl.className = 'title-font ' + (s.totalPL >= 0 ? 'text-green-400' : 'text-red-400');
        }
        
        // Calculate averages
        const wins = state.trades.filter(function(t) { return t.pl > 0; });
        const losses = state.trades.filter(function(t) { return t.pl < 0; });
        
        let avgWin = 0, avgLoss = 0;
        if (wins.length > 0) {
            let sum = 0;
            for (let i = 0; i < wins.length; i++) sum += wins[i].pl;
            avgWin = sum / wins.length;
        }
        if (losses.length > 0) {
            let sum = 0;
            for (let i = 0; i < losses.length; i++) sum += Math.abs(losses[i].pl);
            avgLoss = sum / losses.length;
        }
        
        setText('avgProfit', '+$' + avgWin.toFixed(2));
        setText('avgLoss', '-$' + avgLoss.toFixed(2));
        
        if (state.trades.length > 0) {
            let best = state.trades[0].pl, worst = state.trades[0].pl;
            for (let i = 1; i < state.trades.length; i++) {
                if (state.trades[i].pl > best) best = state.trades[i].pl;
                if (state.trades[i].pl < worst) worst = state.trades[i].pl;
            }
            setText('bestTrade', '+$' + Math.max(0, best).toFixed(2));
            setText('worstTrade', '-$' + Math.abs(Math.min(0, worst)).toFixed(2));
        }
    }

    function updateCountdownDisplay() {
        state.countdown--;
        
        if (state.countdown <= 0) {
            state.countdown = CONFIG.intervals[state.currentInterval].seconds;
            refreshData();
        }
        
        const mins = Math.floor(state.countdown / 60);
        const secs = state.countdown % 60;
        setText('countdownText', String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0'));
        
        const total = CONFIG.intervals[state.currentInterval].seconds;
        const progress = state.countdown / total;
        setStyle('countdownRing', 'strokeDashoffset', (283 * (1 - progress)).toString());
    }

    function updateTimeDisplay() {
        const now = new Date();
        setText('currentTime', now.toLocaleTimeString('en-US', { hour12: false }));
    }

    // ==========================================
    // RENDER FUNCTIONS
    // ==========================================
    function renderCryptoTabs() {
        let html = '';
        for (let i = 0; i < CONFIG.cryptos.length; i++) {
            const c = CONFIG.cryptos[i];
            const isActive = c.id === state.currentCrypto;
            html += '<div class="crypto-tab glass-panel px-4 py-3 flex items-center gap-3 ' + (isActive ? 'active' : '') + '" onclick="App.selectCrypto(\'' + c.id + '\')">' +
                '<div class="w-8 h-8 rounded-full flex items-center justify-center" style="background:' + c.color + '30">' +
                '<span class="title-font font-bold" style="color:' + c.color + '">' + c.symbol[0] + '</span>' +
                '</div>' +
                '<div>' +
                '<div class="font-semibold">' + c.symbol + '</div>' +
                '<div class="text-xs text-gray-500">' + c.name + '</div>' +
                '</div>' +
                '<div class="ml-auto text-right">' +
                '<div id="tab-price-' + c.id + '" class="font-mono text-sm">--</div>' +
                '<div id="tab-change-' + c.id + '" class="text-xs text-gray-400">--%</div>' +
                '</div>' +
                '</div>';
        }
        setHtml('cryptoTabs', html);
    }

    function renderPredictionCards() {
        const preds = state.predictions[state.currentCrypto] || {};
        let html = '';
        
        for (let i = 0; i < CONFIG.intervals.length; i++) {
            const interval = CONFIG.intervals[i];
            const pred = preds[interval.key];
            const isActive = pred && pred.status === 'ACTIVE';
            const isCurrent = i === state.currentInterval;
            
            let progress = 0;
            let timeLeft = '';
            
            if (pred && isActive) {
                const elapsed = Date.now() - pred.createdAt;
                const total = pred.expiresAt - pred.createdAt;
                progress = Math.min(100, (elapsed / total) * 100);
                timeLeft = formatTimeLeft(pred.expiresAt - Date.now());
            }
            
            const dirClass = pred?.direction === 'LONG' ? 'text-green-400' : 'text-red-400';
            
            html += '<div class="prediction-card glass-panel p-4 ' + (isCurrent ? 'active' : '') + ' ' + (isActive ? 'locked' : '') + '" onclick="App.selectInterval(' + i + ')">' +
                '<div class="flex items-center justify-between mb-2">' +
                '<span class="title-font text-xs text-gray-400">' + interval.label + '</span>' +
                (isActive ? '<span class="text-xs">🔒</span>' : '') +
                '</div>' +
                '<div class="title-font text-lg font-bold">' + (pred ? formatPrice(pred.targetPrice) : '--') + '</div>' +
                '<div class="text-xs mb-1 ' + dirClass + '">' + (pred ? pred.direction + ' (' + pred.confidence + '%)' : '--') + '</div>' +
                '<div class="text-xs text-gray-500">' + (isActive ? timeLeft : 'Waiting...') + '</div>' +
                '<div class="progress-bar"><div class="progress-fill" style="width:' + progress + '%"></div></div>' +
                '</div>';
        }
        
        setHtml('predictionCards', html);
    }

    function renderParamHeatmap() {
        const indicators = state.indicators[state.currentCrypto];
        if (!indicators) return;
        
        const names = {
            rsi: ['RSI', '📊'],
            macd: ['MACD', '📈'],
            bollinger: ['BB', '📉'],
            momentum: ['MOM', '🚀'],
            orderbook: ['ORDERS', '📕'],
            funding: ['FUND', '💰'],
            fearGreed: ['F&G', '😱']
        };
        
        let html = '';
        for (const key in indicators) {
            const val = indicators[key];
            const info = names[key] || [key, '❓'];
            const cls = val > 0.1 ? 'bullish' : val < -0.1 ? 'bearish' : 'neutral';
            const colorClass = val >= 0 ? 'text-green-400' : 'text-red-400';
            
            html += '<div class="param-block ' + cls + '">' +
                '<div class="flex items-center justify-between mb-1">' +
                '<span class="text-lg">' + info[1] + '</span>' +
                '<span class="text-xs font-mono ' + colorClass + '">' + (val >= 0 ? '+' : '') + Math.round(val * 100) + '%</span>' +
                '</div>' +
                '<div class="text-xs text-gray-400">' + info[0] + '</div>' +
                '</div>';
        }
        
        setHtml('paramHeatmap', html);
    }

    function renderTradeHistory() {
        if (state.trades.length === 0) {
            setHtml('tradeHistory', '<div class="text-center text-gray-500 py-8">Waiting for predictions to complete...</div>');
            return;
        }
        
        let html = '';
        const trades = state.trades.slice(0, 20);
        
        for (let i = 0; i < trades.length; i++) {
            const t = trades[i];
            const crypto = CONFIG.cryptos.find(function(c) { return c.id === t.symbol; });
            const accClass = t.accuracy >= 60 ? 'high' : t.accuracy >= 40 ? 'medium' : 'low';
            const plClass = t.pl >= 0 ? 'text-green-400' : 'text-red-400';
            const dirClass = t.direction === 'LONG' ? 'long' : 'short';
            const statusClass = 'status-' + t.status.toLowerCase();
            
            html += '<div class="trade-row">' +
                '<div class="text-gray-400">' + new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</div>' +
                '<div style="color:' + (crypto?.color || '#fff') + '">' + (crypto?.symbol || t.symbol) + '</div>' +
                '<div><span class="direction-badge ' + dirClass + '">' + t.direction + '</span></div>' +
                '<div class="text-gray-400">' + t.intervalLabel + '</div>' +
                '<div class="font-mono text-xs">' + formatPrice(t.entryPrice) + ' → ' + formatPrice(t.exitPrice) + '</div>' +
                '<div class="font-mono text-xs text-gray-400">' + formatPrice(t.targetPrice) + '</div>' +
                '<div><span class="accuracy-badge ' + accClass + '">' + (t.accuracy?.toFixed(0) || 0) + '%</span></div>' +
                '<div class="font-mono font-bold ' + plClass + '">' + (t.pl >= 0 ? '+' : '') + '$' + (t.pl?.toFixed(2) || '0.00') + '</div>' +
                '<div class="' + statusClass + '">' + t.status + '</div>' +
                '</div>';
        }
        
        setHtml('tradeHistory', html);
    }

    // ==========================================
    // CHART
    // ==========================================
    function initChart() {
        const canvas = $('priceChart');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        
        state.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Price',
                        data: [],
                        borderColor: '#00d4ff',
                        backgroundColor: 'rgba(0, 212, 255, 0.1)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        borderWidth: 2
                    },
                    {
                        label: 'Target',
                        data: [],
                        borderColor: '#00ff88',
                        borderDash: [5, 5],
                        pointRadius: 8,
                        pointBackgroundColor: '#00ff88',
                        fill: false,
                        borderWidth: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 0 },
                plugins: { legend: { display: false } },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: 'rgba(255,255,255,0.5)', maxTicksLimit: 8, font: { size: 10 } }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: {
                            color: 'rgba(255,255,255,0.5)',
                            font: { size: 10 },
                            callback: function(v) { return formatPrice(v); }
                        }
                    }
                }
            }
        });
    }

    function updateChart() {
        if (!state.chart) return;
        
        const klines = state.klines[state.currentCrypto];
        if (!klines || klines.length === 0) return;
        
        const limits = { '1h': 60, '4h': 48, '1d': 96 };
        const limit = limits[state.chartRange] || 96;
        
        const data = klines.slice(-limit);
        const labels = [];
        const prices = [];
        
        for (let i = 0; i < data.length; i++) {
            labels.push(new Date(data[i].time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            prices.push(data[i].close);
        }
        
        // Prediction point
        const predData = new Array(prices.length).fill(null);
        const preds = state.predictions[state.currentCrypto];
        if (preds) {
            const currentInterval = CONFIG.intervals[state.currentInterval];
            const activePred = preds[currentInterval.key];
            if (activePred && activePred.status === 'ACTIVE') {
                predData[predData.length - 1] = activePred.targetPrice;
            }
        }
        
        state.chart.data.labels = labels;
        state.chart.data.datasets[0].data = prices;
        state.chart.data.datasets[1].data = predData;
        state.chart.update('none');
    }

    // ==========================================
    // DATA REFRESH
    // ==========================================
    async function refreshData() {
        console.log('🔄 Refreshing data...');
        await calculateAllIndicators(state.currentCrypto);
        updateCPSDisplay();
        renderParamHeatmap();
        updateChart();
    }

    // ==========================================
    // PUBLIC API
    // ==========================================
    async function selectCrypto(symbol) {
        state.currentCrypto = symbol;
        renderCryptoTabs();
        
        // Load klines if needed
        if (!state.klines[symbol] || state.klines[symbol].length === 0) {
            const interval = CONFIG.intervals[state.currentInterval].bybit;
            state.klines[symbol] = await fetchKlines(symbol, interval);
        }
        
        await calculateAllIndicators(symbol);
        generatePredictions(symbol);
        
        updatePriceDisplay();
        updateCPSDisplay();
        renderParamHeatmap();
        renderPredictionCards();
        updateChart();
    }

    async function selectInterval(idx) {
        state.currentInterval = idx;
        state.countdown = CONFIG.intervals[idx].seconds;
        setText('activeInterval', CONFIG.intervals[idx].label + ' INTERVAL');
        
        const interval = CONFIG.intervals[idx].bybit;
        state.klines[state.currentCrypto] = await fetchKlines(state.currentCrypto, interval);
        
        await calculateAllIndicators(state.currentCrypto);
        renderPredictionCards();
        updateChart();
    }

    function setChartRange(range) {
        state.chartRange = range;
        
        const buttons = document.querySelectorAll('.chart-range-btn');
        for (let i = 0; i < buttons.length; i++) {
            const btn = buttons[i];
            if (btn.dataset.range === range) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
        
        updateChart();
    }

    // ==========================================
    // INITIALIZATION
    // ==========================================
    async function init() {
        console.log('🚀 CryptoOracle Pro starting...');
        
        renderCryptoTabs();
        renderPredictionCards();
        initChart();
        
        const loadingStatus = $('loadingStatus');
        
        try {
            // Load all crypto data
            for (let i = 0; i < CONFIG.cryptos.length; i++) {
                const crypto = CONFIG.cryptos[i];
                if (loadingStatus) loadingStatus.textContent = 'Loading ' + crypto.name + '...';
                
                // Fetch ticker
                const ticker = await fetchTicker(crypto.id);
                if (ticker) {
                    state.prices[crypto.id] = ticker;
                    updateTabPrice(crypto.id);
                }
                
                // Fetch klines for current crypto
                if (crypto.id === state.currentCrypto) {
                    const interval = CONFIG.intervals[state.currentInterval].bybit;
                    state.klines[crypto.id] = await fetchKlines(crypto.id, interval);
                }
            }
            
            // Fear & Greed
            if (loadingStatus) loadingStatus.textContent = 'Loading market sentiment...';
            state.fearGreed = await fetchFearGreed();
            updateFearGreedDisplay();
            
            // Calculate indicators
            if (loadingStatus) loadingStatus.textContent = 'Analyzing market...';
            await calculateAllIndicators(state.currentCrypto);
            
            // Generate predictions
            if (loadingStatus) loadingStatus.textContent = 'Generating predictions...';
            generatePredictions(state.currentCrypto);
            
            // Update all displays
            updatePriceDisplay();
            updateCPSDisplay();
            renderParamHeatmap();
            renderPredictionCards();
            updateChart();
            updateStatsDisplay();
            
            // Connect WebSocket
            if (loadingStatus) loadingStatus.textContent = 'Connecting to live feed...';
            connectWebSocket();
            
            // Hide loading
            const overlay = $('loadingOverlay');
            if (overlay) overlay.classList.add('hidden');
            
            state.initialized = true;
            
            // Start timers
            setInterval(updateTimeDisplay, 1000);
            setInterval(updateCountdownDisplay, 1000);
            setInterval(checkExpiredPredictions, 1000);
            setInterval(renderPredictionCards, 5000);
            
            // Periodic data refresh
            setInterval(async function() {
                state.fearGreed = await fetchFearGreed();
                updateFearGreedDisplay();
            }, 300000);
            
            setInterval(refreshData, 30000);
            
            console.log('✅ CryptoOracle Pro ready!');
            
        } catch (error) {
            console.error('❌ Initialization failed:', error);
            
            const overlay = $('loadingOverlay');
            if (overlay) {
                overlay.innerHTML = '<div class="loading-content">' +
                    '<div class="title-font text-xl text-red-400 mb-4">Connection Error</div>' +
                    '<div class="text-gray-400 mb-4">' + error.message + '</div>' +
                    '<button onclick="location.reload()" class="px-6 py-2 bg-purple-600 rounded-lg hover:bg-purple-700">Retry</button>' +
                    '</div>';
            }
        }
    }

    // Start on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose public API
    window.App = {
        selectCrypto: selectCrypto,
        selectInterval: selectInterval,
        setChartRange: setChartRange
    };

})();
