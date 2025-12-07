/**
 * CryptoOracle Pro - Bybit Real-Time Trading Predictions
 * Version: 2.0 (Fixed & Stable)
 */

const App = (function() {
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
        bybitApi: 'https://api.bybit.com',
        bybitWs: 'wss://stream.bybit.com/v5/public/linear'
    };

    // ==========================================
    // STATE
    // ==========================================
    const state = {
        currentCrypto: 'BTCUSDT',
        currentInterval: 0,
        chartRange: '1d',
        
        // Price data (only from API, no mock data)
        prices: {},
        klines: {},
        
        // Locked predictions
        predictions: {},
        
        // Calculated indicators
        indicators: {},
        
        // Trade history
        trades: [],
        
        // Stats
        stats: {
            total: 0,
            wins: 0,
            losses: 0,
            totalPL: 0
        },
        
        // Fear & Greed
        fearGreed: { value: 50, label: 'Neutral' },
        
        // Countdown
        countdown: 60,
        
        // WebSocket
        ws: null,
        wsConnected: false,
        
        // Chart
        chart: null,
        
        // DOM cache
        dom: {}
    };

    // ==========================================
    // DOM CACHE
    // ==========================================
    function cacheDom() {
        state.dom = {
            // Price display
            livePrice: document.getElementById('livePrice'),
            priceChange: document.getElementById('priceChange'),
            high24h: document.getElementById('high24h'),
            low24h: document.getElementById('low24h'),
            volume24h: document.getElementById('volume24h'),
            openInterest: document.getElementById('openInterest'),
            fundingRate: document.getElementById('fundingRate'),
            
            // CPS Gauge
            gaugeNeedle: document.getElementById('gaugeNeedle'),
            cpsValue: document.getElementById('cpsValue'),
            cpsLabel: document.getElementById('cpsLabel'),
            
            // Countdown
            countdownText: document.getElementById('countdownText'),
            countdownRing: document.getElementById('countdownRing'),
            activeInterval: document.getElementById('activeInterval'),
            
            // Fear & Greed
            fgValue: document.getElementById('fgValue'),
            fgLabel: document.getElementById('fgLabel'),
            fgCircle: document.getElementById('fgCircle'),
            
            // Stats
            winRate: document.getElementById('winRate'),
            totalTrades: document.getElementById('totalTrades'),
            totalPL: document.getElementById('totalPL'),
            winningTrades: document.getElementById('winningTrades'),
            losingTrades: document.getElementById('losingTrades'),
            avgProfit: document.getElementById('avgProfit'),
            avgLoss: document.getElementById('avgLoss'),
            bestTrade: document.getElementById('bestTrade'),
            worstTrade: document.getElementById('worstTrade'),
            
            // Containers
            cryptoTabs: document.getElementById('cryptoTabs'),
            predictionCards: document.getElementById('predictionCards'),
            paramHeatmap: document.getElementById('paramHeatmap'),
            tradeHistory: document.getElementById('tradeHistory'),
            
            // Other
            wsStatus: document.getElementById('wsStatus'),
            currentTime: document.getElementById('currentTime'),
            loadingOverlay: document.getElementById('loadingOverlay'),
            loadingStatus: document.getElementById('loadingStatus')
        };
    }

    // ==========================================
    // BYBIT API
    // ==========================================
    async function fetchTicker(symbol) {
        try {
            const res = await fetch(`${CONFIG.bybitApi}/v5/market/tickers?category=linear&symbol=${symbol}`);
            const data = await res.json();
            
            if (data.retCode === 0 && data.result.list[0]) {
                const t = data.result.list[0];
                return {
                    price: parseFloat(t.lastPrice),
                    change24h: parseFloat(t.price24hPcnt) * 100,
                    high24h: parseFloat(t.highPrice24h),
                    low24h: parseFloat(t.lowPrice24h),
                    volume24h: parseFloat(t.turnover24h),
                    fundingRate: parseFloat(t.fundingRate) * 100,
                    timestamp: Date.now()
                };
            }
        } catch (e) {
            console.error('Ticker fetch error:', e);
        }
        return null;
    }

    async function fetchKlines(symbol, interval, limit = 100) {
        try {
            const res = await fetch(
                `${CONFIG.bybitApi}/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`
            );
            const data = await res.json();
            
            if (data.retCode === 0 && data.result.list) {
                return data.result.list.reverse().map(k => ({
                    time: parseInt(k[0]),
                    open: parseFloat(k[1]),
                    high: parseFloat(k[2]),
                    low: parseFloat(k[3]),
                    close: parseFloat(k[4]),
                    volume: parseFloat(k[5])
                }));
            }
        } catch (e) {
            console.error('Klines fetch error:', e);
        }
        return [];
    }

    async function fetchOpenInterest(symbol) {
        try {
            const res = await fetch(
                `${CONFIG.bybitApi}/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=1h&limit=1`
            );
            const data = await res.json();
            
            if (data.retCode === 0 && data.result.list[0]) {
                return parseFloat(data.result.list[0].openInterest);
            }
        } catch (e) {
            console.error('OI fetch error:', e);
        }
        return 0;
    }

    async function fetchOrderbook(symbol) {
        try {
            const res = await fetch(
                `${CONFIG.bybitApi}/v5/market/orderbook?category=linear&symbol=${symbol}&limit=25`
            );
            const data = await res.json();
            
            if (data.retCode === 0) {
                const bids = data.result.b.reduce((s, b) => s + parseFloat(b[1]), 0);
                const asks = data.result.a.reduce((s, a) => s + parseFloat(a[1]), 0);
                return { imbalance: (bids - asks) / (bids + asks) };
            }
        } catch (e) {
            console.error('Orderbook fetch error:', e);
        }
        return { imbalance: 0 };
    }

    async function fetchFearGreed() {
        try {
            const res = await fetch('https://api.alternative.me/fng/?limit=1');
            const data = await res.json();
            
            if (data.data && data.data[0]) {
                return {
                    value: parseInt(data.data[0].value),
                    label: data.data[0].value_classification
                };
            }
        } catch (e) {
            console.error('F&G fetch error:', e);
        }
        return { value: 50, label: 'Neutral' };
    }

    // ==========================================
    // WEBSOCKET
    // ==========================================
    function connectWebSocket() {
        if (state.ws) {
            state.ws.close();
        }

        updateWsStatus('connecting');
        state.ws = new WebSocket(CONFIG.bybitWs);

        state.ws.onopen = () => {
            console.log('WebSocket connected');
            state.wsConnected = true;
            updateWsStatus('connected');
            
            // Subscribe to tickers
            const args = CONFIG.cryptos.map(c => `tickers.${c.id}`);
            state.ws.send(JSON.stringify({ op: 'subscribe', args }));
        };

        state.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                
                if (msg.topic && msg.topic.startsWith('tickers.') && msg.data) {
                    const symbol = msg.topic.replace('tickers.', '');
                    const t = msg.data;
                    
                    state.prices[symbol] = {
                        price: parseFloat(t.lastPrice),
                        change24h: parseFloat(t.price24hPcnt) * 100,
                        high24h: parseFloat(t.highPrice24h),
                        low24h: parseFloat(t.lowPrice24h),
                        volume24h: parseFloat(t.turnover24h),
                        fundingRate: parseFloat(t.fundingRate) * 100,
                        timestamp: Date.now()
                    };
                    
                    // Update UI only for current crypto
                    if (symbol === state.currentCrypto) {
                        updatePriceDisplay();
                    }
                    updateTabPrice(symbol);
                }
            } catch (e) {
                // Ignore parse errors (ping/pong messages)
            }
        };

        state.ws.onclose = () => {
            console.log('WebSocket closed');
            state.wsConnected = false;
            updateWsStatus('disconnected');
            
            // Reconnect after 3 seconds
            setTimeout(connectWebSocket, 3000);
        };

        state.ws.onerror = () => {
            console.error('WebSocket error');
            updateWsStatus('disconnected');
        };
    }

    function updateWsStatus(status) {
        const el = state.dom.wsStatus;
        if (!el) return;
        
        el.className = `connection-status ${status}`;
        
        const labels = {
            connected: 'Live',
            disconnected: 'Offline',
            connecting: 'Connecting...'
        };
        
        el.innerHTML = `<div class="status-dot"></div><span>${labels[status]}</span>`;
    }

    // ==========================================
    // INDICATORS CALCULATION
    // ==========================================
    function calculateRSI(prices, period = 14) {
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

    function calculateMACD(prices) {
        if (prices.length < 26) return 0;
        
        const ema = (data, period) => {
            const k = 2 / (period + 1);
            let result = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
            for (let i = period; i < data.length; i++) {
                result = data[i] * k + result * (1 - k);
            }
            return result;
        };
        
        return ema(prices, 12) - ema(prices, 26);
    }

    function calculateBollinger(prices, period = 20) {
        if (prices.length < period) return 0.5;
        
        const slice = prices.slice(-period);
        const avg = slice.reduce((a, b) => a + b, 0) / period;
        const std = Math.sqrt(slice.reduce((s, p) => s + (p - avg) ** 2, 0) / period);
        
        if (std === 0) return 0.5;
        const current = prices[prices.length - 1];
        return (current - (avg - 2 * std)) / (4 * std);
    }

    function calculateMomentum(prices, period = 10) {
        if (prices.length < period + 1) return 0;
        const current = prices[prices.length - 1];
        const past = prices[prices.length - period - 1];
        return ((current - past) / past) * 100;
    }

    async function calculateIndicators(symbol) {
        const klines = state.klines[symbol];
        if (!klines || klines.length < 30) return null;
        
        const closes = klines.map(k => k.close);
        const price = state.prices[symbol];
        const orderbook = await fetchOrderbook(symbol);
        const oi = await fetchOpenInterest(symbol);
        
        // Calculate all indicators
        const rsi = calculateRSI(closes);
        const macd = calculateMACD(closes);
        const bb = calculateBollinger(closes);
        const mom = calculateMomentum(closes);
        
        // Normalize to -1 to 1
        const indicators = {
            rsi: (50 - rsi) / 50,
            macd: Math.max(-1, Math.min(1, macd / (price?.price || 1) * 100)),
            bollinger: (0.5 - bb) * 2,
            momentum: Math.max(-1, Math.min(1, mom / 5)),
            orderbook: orderbook.imbalance,
            funding: price?.fundingRate ? -Math.max(-1, Math.min(1, price.fundingRate * 10)) : 0,
            fearGreed: (50 - state.fearGreed.value) / 50
        };
        
        state.indicators[symbol] = indicators;
        state.openInterest = oi * (price?.price || 0);
        
        return indicators;
    }

    // ==========================================
    // CPS (Composite Predictive Score)
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
        for (const [key, weight] of Object.entries(weights)) {
            cps += (indicators[key] || 0) * weight;
        }
        
        return Math.max(-1, Math.min(1, cps));
    }

    function getCPSInfo(cps) {
        if (cps >= 0.4) return { label: 'STRONG BUY', color: '#00ff88', direction: 'LONG' };
        if (cps >= 0.1) return { label: 'BUY', color: '#00dd66', direction: 'LONG' };
        if (cps >= -0.1) return { label: 'NEUTRAL', color: '#9945ff', direction: 'LONG' };
        if (cps >= -0.4) return { label: 'SELL', color: '#ff6644', direction: 'SHORT' };
        return { label: 'STRONG SELL', color: '#ff3366', direction: 'SHORT' };
    }

    // ==========================================
    // PREDICTIONS
    // ==========================================
    function createPrediction(symbol, intervalConfig) {
        const price = state.prices[symbol];
        const indicators = state.indicators[symbol];
        
        if (!price || !indicators) return null;
        
        const cps = calculateCPS(indicators);
        const info = getCPSInfo(cps);
        
        // Calculate target price
        const volatility = 0.008;
        const timeFactor = Math.sqrt(intervalConfig.seconds / 60);
        const direction = info.direction === 'LONG' ? 1 : -1;
        const magnitude = Math.abs(cps);
        
        const move = price.price * volatility * timeFactor * magnitude * direction;
        const target = price.price + move;
        
        return {
            id: `${symbol}-${intervalConfig.key}-${Date.now()}`,
            symbol,
            interval: intervalConfig.key,
            intervalLabel: intervalConfig.label,
            entryPrice: price.price,
            targetPrice: target,
            direction: info.direction,
            cps,
            confidence: Math.round((50 + magnitude * 40)),
            createdAt: Date.now(),
            expiresAt: Date.now() + intervalConfig.seconds * 1000,
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
        
        CONFIG.intervals.forEach(interval => {
            const existing = state.predictions[symbol][interval.key];
            
            // Only create if no active prediction
            if (!existing || existing.status !== 'ACTIVE') {
                const pred = createPrediction(symbol, interval);
                if (pred) {
                    state.predictions[symbol][interval.key] = pred;
                    console.log(`📊 New prediction: ${symbol} ${interval.label} ${pred.direction}`);
                }
            }
        });
    }

    function checkPredictions() {
        const now = Date.now();
        
        Object.keys(state.predictions).forEach(symbol => {
            Object.keys(state.predictions[symbol]).forEach(intervalKey => {
                const pred = state.predictions[symbol][intervalKey];
                
                if (pred.status === 'ACTIVE' && now >= pred.expiresAt) {
                    evaluatePrediction(pred);
                }
            });
        });
    }

    function evaluatePrediction(pred) {
        const price = state.prices[pred.symbol];
        if (!price) return;
        
        const exitPrice = price.price;
        const entryPrice = pred.entryPrice;
        const change = (exitPrice - entryPrice) / entryPrice;
        
        // Calculate P/L based on direction
        let pl;
        if (pred.direction === 'LONG') {
            pl = change * CONFIG.investment;
        } else {
            pl = -change * CONFIG.investment;
        }
        
        // Calculate accuracy
        const predictedChange = (pred.targetPrice - entryPrice) / entryPrice;
        const actualDirection = change > 0 ? 'LONG' : 'SHORT';
        const correct = pred.direction === actualDirection;
        const accuracy = correct ? 
            Math.min(100, 50 + Math.abs(change) / Math.abs(predictedChange) * 50) : 
            Math.max(0, 50 - Math.abs(change) * 100);
        
        // Update prediction
        pred.exitPrice = exitPrice;
        pred.pl = pl;
        pred.accuracy = accuracy;
        pred.status = pl >= 0 ? 'WON' : 'LOST';
        
        // Add to history
        state.trades.unshift({ ...pred });
        if (state.trades.length > 50) state.trades.pop();
        
        // Update stats
        state.stats.total++;
        if (pl >= 0) state.stats.wins++;
        else state.stats.losses++;
        state.stats.totalPL += pl;
        
        console.log(`✅ Trade: ${pred.symbol} ${pred.direction} | P/L: $${pl.toFixed(2)}`);
        
        // Create new prediction
        const interval = CONFIG.intervals.find(i => i.key === pred.interval);
        if (interval) {
            const newPred = createPrediction(pred.symbol, interval);
            if (newPred) {
                state.predictions[pred.symbol][pred.interval] = newPred;
            }
        }
        
        // Update UI
        updateTradeHistory();
        updateStats();
    }

    // ==========================================
    // UI UPDATES
    // ==========================================
    function updatePriceDisplay() {
        const price = state.prices[state.currentCrypto];
        if (!price) return;
        
        // Only update if we have valid data
        state.dom.livePrice.textContent = formatPrice(price.price);
        
        const changeText = `${price.change24h >= 0 ? '+' : ''}${price.change24h.toFixed(2)}%`;
        state.dom.priceChange.textContent = changeText;
        state.dom.priceChange.className = `text-lg ${price.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`;
        
        state.dom.high24h.textContent = formatPrice(price.high24h);
        state.dom.low24h.textContent = formatPrice(price.low24h);
        state.dom.volume24h.textContent = formatVolume(price.volume24h);
        
        // Funding rate
        const fr = price.fundingRate;
        state.dom.fundingRate.textContent = `Funding: ${fr >= 0 ? '+' : ''}${fr.toFixed(4)}%`;
        state.dom.fundingRate.className = `funding-rate ${fr > 0 ? 'positive' : fr < 0 ? 'negative' : 'neutral'}`;
        
        // Open interest
        if (state.openInterest) {
            state.dom.openInterest.textContent = formatVolume(state.openInterest);
        }
    }

    function updateTabPrice(symbol) {
        const price = state.prices[symbol];
        if (!price) return;
        
        const priceEl = document.getElementById(`tab-price-${symbol}`);
        const changeEl = document.getElementById(`tab-change-${symbol}`);
        
        if (priceEl) priceEl.textContent = formatPrice(price.price);
        if (changeEl) {
            changeEl.textContent = `${price.change24h >= 0 ? '+' : ''}${price.change24h.toFixed(2)}%`;
            changeEl.className = `text-xs ${price.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`;
        }
    }

    function updateCPSGauge() {
        const indicators = state.indicators[state.currentCrypto];
        const cps = calculateCPS(indicators);
        const info = getCPSInfo(cps);
        
        // Rotate needle (-90 to 90 degrees)
        const angle = cps * 90;
        state.dom.gaugeNeedle.style.transform = `translateX(-50%) rotate(${angle}deg)`;
        
        state.dom.cpsValue.textContent = Math.round(cps * 100);
        state.dom.cpsValue.style.color = info.color;
        state.dom.cpsLabel.textContent = info.label;
        state.dom.cpsLabel.style.color = info.color;
    }

    function updateCountdown() {
        state.countdown--;
        
        if (state.countdown <= 0) {
            state.countdown = CONFIG.intervals[state.currentInterval].seconds;
            refreshAnalysis();
        }
        
        const mins = Math.floor(state.countdown / 60);
        const secs = state.countdown % 60;
        state.dom.countdownText.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        
        const total = CONFIG.intervals[state.currentInterval].seconds;
        const progress = state.countdown / total;
        state.dom.countdownRing.style.strokeDashoffset = 283 * (1 - progress);
    }

    function updateFearGreed() {
        const fg = state.fearGreed;
        state.dom.fgValue.textContent = fg.value;
        state.dom.fgLabel.textContent = fg.label.toUpperCase();
        
        const offset = 283 - (fg.value / 100) * 283;
        state.dom.fgCircle.style.strokeDashoffset = offset;
        
        const color = fg.value < 25 ? '#ff3366' : 
                     fg.value < 45 ? '#ff6644' :
                     fg.value < 55 ? '#9945ff' :
                     fg.value < 75 ? '#00dd66' : '#00ff88';
        state.dom.fgCircle.style.stroke = color;
    }

    function updateStats() {
        const s = state.stats;
        const winRate = s.total > 0 ? (s.wins / s.total * 100) : 0;
        
        state.dom.winRate.textContent = `${winRate.toFixed(1)}%`;
        state.dom.totalTrades.textContent = s.total;
        state.dom.winningTrades.textContent = s.wins;
        state.dom.losingTrades.textContent = s.losses;
        
        state.dom.totalPL.textContent = `${s.totalPL >= 0 ? '+' : ''}$${s.totalPL.toFixed(2)}`;
        state.dom.totalPL.className = `title-font ${s.totalPL >= 0 ? 'text-green-400' : 'text-red-400'}`;
        
        // Calculate averages
        const wins = state.trades.filter(t => t.pl > 0);
        const losses = state.trades.filter(t => t.pl < 0);
        
        const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pl, 0) / wins.length : 0;
        const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pl, 0)) / losses.length : 0;
        
        state.dom.avgProfit.textContent = `+$${avgWin.toFixed(2)}`;
        state.dom.avgLoss.textContent = `-$${avgLoss.toFixed(2)}`;
        
        if (state.trades.length > 0) {
            const best = Math.max(...state.trades.map(t => t.pl));
            const worst = Math.min(...state.trades.map(t => t.pl));
            state.dom.bestTrade.textContent = `+$${Math.max(0, best).toFixed(2)}`;
            state.dom.worstTrade.textContent = `-$${Math.abs(Math.min(0, worst)).toFixed(2)}`;
        }
    }

    function updateTime() {
        state.dom.currentTime.textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
    }

    // ==========================================
    // RENDER FUNCTIONS
    // ==========================================
    function renderCryptoTabs() {
        state.dom.cryptoTabs.innerHTML = CONFIG.cryptos.map(c => `
            <div class="crypto-tab glass-panel px-4 py-3 flex items-center gap-3 ${c.id === state.currentCrypto ? 'active' : ''}"
                 onclick="App.selectCrypto('${c.id}')">
                <div class="w-8 h-8 rounded-full flex items-center justify-center" style="background: ${c.color}30">
                    <span class="title-font font-bold" style="color: ${c.color}">${c.symbol[0]}</span>
                </div>
                <div>
                    <div class="font-semibold">${c.symbol}</div>
                    <div class="text-xs text-gray-500">${c.name}</div>
                </div>
                <div class="ml-auto text-right">
                    <div id="tab-price-${c.id}" class="font-mono text-sm">--</div>
                    <div id="tab-change-${c.id}" class="text-xs text-gray-400">--%</div>
                </div>
            </div>
        `).join('');
    }

    function renderPredictionCards() {
        const preds = state.predictions[state.currentCrypto] || {};
        
        state.dom.predictionCards.innerHTML = CONFIG.intervals.map((interval, idx) => {
            const pred = preds[interval.key];
            const isActive = pred && pred.status === 'ACTIVE';
            const progress = pred ? Math.min(100, (Date.now() - pred.createdAt) / (pred.expiresAt - pred.createdAt) * 100) : 0;
            const timeLeft = pred ? Math.max(0, pred.expiresAt - Date.now()) : 0;
            
            return `
                <div class="prediction-card glass-panel p-4 ${idx === state.currentInterval ? 'active' : ''} ${isActive ? 'locked' : ''}"
                     onclick="App.selectInterval(${idx})">
                    <div class="flex items-center justify-between mb-2">
                        <span class="title-font text-xs text-gray-400">${interval.label}</span>
                        ${isActive ? '<span class="text-xs">🔒</span>' : ''}
                    </div>
                    <div class="title-font text-lg font-bold">${pred ? formatPrice(pred.targetPrice) : '--'}</div>
                    <div class="text-xs mb-1 ${pred?.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}">
                        ${pred ? `${pred.direction} (${pred.confidence}%)` : '--'}
                    </div>
                    <div class="text-xs text-gray-500">${isActive ? formatTimeLeft(timeLeft) : 'Waiting...'}</div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${progress}%"></div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderParamHeatmap() {
        const indicators = state.indicators[state.currentCrypto];
        if (!indicators) return;
        
        const names = {
            rsi: { name: 'RSI', icon: '📊' },
            macd: { name: 'MACD', icon: '📈' },
            bollinger: { name: 'BB', icon: '📉' },
            momentum: { name: 'MOM', icon: '🚀' },
            orderbook: { name: 'ORDERS', icon: '📕' },
            funding: { name: 'FUND', icon: '💰' },
            fearGreed: { name: 'F&G', icon: '😱' }
        };
        
        state.dom.paramHeatmap.innerHTML = Object.entries(indicators).map(([key, val]) => {
            const info = names[key] || { name: key, icon: '❓' };
            const cls = val > 0.1 ? 'bullish' : val < -0.1 ? 'bearish' : 'neutral';
            
            return `
                <div class="param-block ${cls}">
                    <div class="flex items-center justify-between mb-1">
                        <span class="text-lg">${info.icon}</span>
                        <span class="text-xs font-mono ${val >= 0 ? 'text-green-400' : 'text-red-400'}">
                            ${val >= 0 ? '+' : ''}${(val * 100).toFixed(0)}%
                        </span>
                    </div>
                    <div class="text-xs text-gray-400">${info.name}</div>
                </div>
            `;
        }).join('');
    }

    function updateTradeHistory() {
        if (state.trades.length === 0) {
            state.dom.tradeHistory.innerHTML = '<div class="text-center text-gray-500 py-8">Waiting for predictions to complete...</div>';
            return;
        }
        
        state.dom.tradeHistory.innerHTML = state.trades.slice(0, 20).map(t => {
            const crypto = CONFIG.cryptos.find(c => c.id === t.symbol);
            const accClass = t.accuracy >= 60 ? 'high' : t.accuracy >= 40 ? 'medium' : 'low';
            
            return `
                <div class="trade-row">
                    <div class="text-gray-400">${new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    <div style="color: ${crypto?.color || '#fff'}">${crypto?.symbol || t.symbol}</div>
                    <div><span class="direction-badge ${t.direction.toLowerCase()}">${t.direction}</span></div>
                    <div class="text-gray-400">${t.intervalLabel}</div>
                    <div class="font-mono text-xs">${formatPrice(t.entryPrice)} → ${formatPrice(t.exitPrice)}</div>
                    <div class="font-mono text-xs text-gray-400">${formatPrice(t.targetPrice)}</div>
                    <div><span class="accuracy-badge ${accClass}">${t.accuracy?.toFixed(0) || 0}%</span></div>
                    <div class="font-mono font-bold ${t.pl >= 0 ? 'text-green-400' : 'text-red-400'}">
                        ${t.pl >= 0 ? '+' : ''}$${t.pl?.toFixed(2) || '0.00'}
                    </div>
                    <div class="status-${t.status.toLowerCase()}">${t.status}</div>
                </div>
            `;
        }).join('');
    }

    // ==========================================
    // CHART
    // ==========================================
    function initChart() {
        const ctx = document.getElementById('priceChart')?.getContext('2d');
        if (!ctx) return;
        
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
                        pointRadius: 0
                    },
                    {
                        label: 'Prediction',
                        data: [],
                        borderColor: '#00ff88',
                        borderDash: [5, 5],
                        pointRadius: 8,
                        pointBackgroundColor: '#00ff88',
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: 'rgba(255,255,255,0.5)', maxTicksLimit: 8 }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: {
                            color: 'rgba(255,255,255,0.5)',
                            callback: v => '$' + formatNumber(v)
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
        const labels = data.map(k => new Date(k.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        const prices = data.map(k => k.close);
        
        // Add prediction point
        const predData = new Array(prices.length).fill(null);
        const preds = state.predictions[state.currentCrypto];
        if (preds) {
            const activePred = preds[CONFIG.intervals[state.currentInterval].key];
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
    // USER ACTIONS
    // ==========================================
    async function selectCrypto(symbol) {
        state.currentCrypto = symbol;
        renderCryptoTabs();
        
        // Load klines if needed
        if (!state.klines[symbol] || state.klines[symbol].length === 0) {
            const interval = CONFIG.intervals[state.currentInterval].bybit;
            state.klines[symbol] = await fetchKlines(symbol, interval);
        }
        
        // Calculate indicators
        await calculateIndicators(symbol);
        
        // Generate predictions
        generatePredictions(symbol);
        
        // Update UI
        updatePriceDisplay();
        updateCPSGauge();
        renderParamHeatmap();
        renderPredictionCards();
        updateChart();
    }

    async function selectInterval(idx) {
        state.currentInterval = idx;
        state.countdown = CONFIG.intervals[idx].seconds;
        state.dom.activeInterval.textContent = CONFIG.intervals[idx].label + ' INTERVAL';
        
        // Fetch new klines
        const interval = CONFIG.intervals[idx].bybit;
        state.klines[state.currentCrypto] = await fetchKlines(state.currentCrypto, interval);
        
        // Recalculate
        await calculateIndicators(state.currentCrypto);
        
        renderPredictionCards();
        updateChart();
    }

    function setChartRange(range) {
        state.chartRange = range;
        
        document.querySelectorAll('.chart-range-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.range === range);
        });
        
        updateChart();
    }

    async function refreshAnalysis() {
        await calculateIndicators(state.currentCrypto);
        updateCPSGauge();
        renderParamHeatmap();
        updateChart();
    }

    // ==========================================
    // UTILITIES
    // ==========================================
    function formatPrice(p) {
        if (!p && p !== 0) return '--';
        if (p >= 1000) return '$' + p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (p >= 1) return '$' + p.toFixed(2);
        return '$' + p.toFixed(4);
    }

    function formatVolume(v) {
        if (!v) return '--';
        if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
        if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
        if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
        if (v >= 1e3) return '$' + (v / 1e3).toFixed(2) + 'K';
        return '$' + v.toFixed(2);
    }

    function formatNumber(n) {
        if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
        return n.toFixed(2);
    }

    function formatTimeLeft(ms) {
        if (ms <= 0) return 'Expired';
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const h = Math.floor(m / 60);
        if (h > 0) return `${h}h ${m % 60}m`;
        if (m > 0) return `${m}m ${s % 60}s`;
        return `${s}s`;
    }

    // ==========================================
    // INITIALIZATION
    // ==========================================
    async function init() {
        console.log('🚀 Starting CryptoOracle Pro...');
        
        cacheDom();
        renderCryptoTabs();
        renderPredictionCards();
        initChart();
        
        try {
            // Load initial data
            for (const crypto of CONFIG.cryptos) {
                state.dom.loadingStatus.textContent = `Loading ${crypto.name}...`;
                
                const ticker = await fetchTicker(crypto.id);
                if (ticker) {
                    state.prices[crypto.id] = ticker;
                }
                
                if (crypto.id === state.currentCrypto) {
                    const interval = CONFIG.intervals[state.currentInterval].bybit;
                    state.klines[crypto.id] = await fetchKlines(crypto.id, interval);
                }
            }
            
            // Fear & Greed
            state.dom.loadingStatus.textContent = 'Loading Fear & Greed...';
            state.fearGreed = await fetchFearGreed();
            updateFearGreed();
            
            // Calculate indicators
            state.dom.loadingStatus.textContent = 'Calculating indicators...';
            await calculateIndicators(state.currentCrypto);
            
            // Generate predictions
            state.dom.loadingStatus.textContent = 'Generating predictions...';
            generatePredictions(state.currentCrypto);
            
            // Update all UI
            updatePriceDisplay();
            updateCPSGauge();
            renderParamHeatmap();
            renderPredictionCards();
            updateChart();
            updateStats();
            
            // Connect WebSocket
            state.dom.loadingStatus.textContent = 'Connecting...';
            connectWebSocket();
            
            // Hide loading
            state.dom.loadingOverlay.classList.add('hidden');
            
            // Start timers
            setInterval(updateTime, 1000);
            setInterval(updateCountdown, 1000);
            setInterval(checkPredictions, 1000);
            setInterval(renderPredictionCards, 5000);
            
            // Periodic updates
            setInterval(async () => {
                state.fearGreed = await fetchFearGreed();
                updateFearGreed();
            }, 300000);
            
            setInterval(async () => {
                await calculateIndicators(state.currentCrypto);
                updateCPSGauge();
                renderParamHeatmap();
                updateChart();
            }, 30000);
            
            console.log('✅ CryptoOracle Pro ready!');
            
        } catch (error) {
            console.error('❌ Init error:', error);
            state.dom.loadingOverlay.innerHTML = `
                <div class="loading-content">
                    <div class="title-font text-xl text-red-400 mb-4">Connection Error</div>
                    <div class="text-gray-400 mb-4">${error.message}</div>
                    <button onclick="location.reload()" 
                            class="px-6 py-2 bg-purple-600 rounded-lg hover:bg-purple-700">
                        Retry
                    </button>
                </div>
            `;
        }
    }

    // Start on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Public API
    return {
        selectCrypto,
        selectInterval,
        setChartRange
    };
})();
