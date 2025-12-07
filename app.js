/**
 * CryptoOracle Pro - STABLE VERSION
 * Проблема мигания полностью устранена
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
        apiUrl: 'https://api.bybit.com',
        wsUrl: 'wss://stream.bybit.com/v5/public/linear'
    };

    // ==========================================
    // GLOBAL STATE
    // ==========================================
    const state = {
        activeCrypto: 'BTCUSDT',
        activeInterval: 0,
        chartRange: '1d',
        countdown: 60,
        wsConnected: false,
        initialized: false,
        
        // Данные цен - НИКОГДА не сбрасываются после инициализации
        priceData: {},
        
        // Кэш klines
        klinesData: {},
        
        // Индикаторы
        indicatorsData: {},
        
        // Прогнозы - заблокированы до истечения
        predictionsData: {},
        
        // История сделок
        tradesHistory: [],
        
        // Статистика
        statsData: {
            total: 0,
            wins: 0,
            losses: 0,
            totalPL: 0
        },
        
        // Fear & Greed
        fgData: { value: 50, label: 'Neutral' },
        
        // Open Interest кэш
        oiData: {},
        
        // WebSocket instance
        wsInstance: null,
        
        // Chart instance
        chartInstance: null,
        
        // Флаг для предотвращения множественных обновлений
        updateScheduled: false
    };

    // ==========================================
    // ИНИЦИАЛИЗАЦИЯ НАЧАЛЬНЫХ ДАННЫХ ЦЕН
    // ==========================================
    function initPriceData() {
        CONFIG.cryptos.forEach(function(crypto) {
            state.priceData[crypto.id] = {
                price: 0,
                change24h: 0,
                high24h: 0,
                low24h: 0,
                volume24h: 0,
                fundingRate: 0,
                isLoaded: false
            };
        });
    }

    // ==========================================
    // БЕЗОПАСНЫЕ ФУНКЦИИ РАБОТЫ С DOM
    // ==========================================
    function getEl(id) {
        return document.getElementById(id);
    }

    function safeSetText(id, value) {
        var el = getEl(id);
        if (el) {
            var text = value !== undefined && value !== null ? String(value) : '';
            if (el.textContent !== text) {
                el.textContent = text;
            }
        }
    }

    function safeSetHtml(id, html) {
        var el = getEl(id);
        if (el) {
            el.innerHTML = html;
        }
    }

    function safeSetStyle(id, property, value) {
        var el = getEl(id);
        if (el) {
            el.style[property] = value;
        }
    }

    function safeSetClass(id, className) {
        var el = getEl(id);
        if (el && el.className !== className) {
            el.className = className;
        }
    }

    // ==========================================
    // ФОРМАТИРОВАНИЕ
    // ==========================================
    function fmtPrice(p) {
        if (p === undefined || p === null || p === 0 || isNaN(p)) {
            return '$0.00';
        }
        p = Number(p);
        if (p >= 10000) {
            return '$' + p.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0});
        }
        if (p >= 100) {
            return '$' + p.toFixed(2);
        }
        if (p >= 1) {
            return '$' + p.toFixed(2);
        }
        return '$' + p.toFixed(4);
    }

    function fmtVolume(v) {
        if (!v || isNaN(v)) return '$0';
        v = Number(v);
        if (v >= 1e12) return '$' + (v / 1e12).toFixed(1) + 'T';
        if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
        if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
        if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
        return '$' + v.toFixed(0);
    }

    function fmtPercent(p, showPlus) {
        if (p === undefined || p === null || isNaN(p)) return '0.00%';
        p = Number(p);
        var prefix = (showPlus !== false && p > 0) ? '+' : '';
        return prefix + p.toFixed(2) + '%';
    }

    function fmtTime(ms) {
        if (ms <= 0) return 'Expired';
        var s = Math.floor(ms / 1000);
        var m = Math.floor(s / 60);
        var h = Math.floor(m / 60);
        if (h > 0) return h + 'h ' + (m % 60) + 'm';
        if (m > 0) return m + 'm ' + (s % 60) + 's';
        return s + 's';
    }

    // ==========================================
    // API ЗАПРОСЫ
    // ==========================================
    function apiRequest(endpoint) {
        return fetch(CONFIG.apiUrl + endpoint)
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data.retCode === 0) {
                    return data.result;
                }
                throw new Error('API Error: ' + data.retMsg);
            });
    }

    function loadTickerData(symbol) {
        return apiRequest('/v5/market/tickers?category=linear&symbol=' + symbol)
            .then(function(result) {
                if (result && result.list && result.list[0]) {
                    var t = result.list[0];
                    return {
                        price: parseFloat(t.lastPrice) || 0,
                        change24h: (parseFloat(t.price24hPcnt) || 0) * 100,
                        high24h: parseFloat(t.highPrice24h) || 0,
                        low24h: parseFloat(t.lowPrice24h) || 0,
                        volume24h: parseFloat(t.turnover24h) || 0,
                        fundingRate: (parseFloat(t.fundingRate) || 0) * 100
                    };
                }
                return null;
            })
            .catch(function(err) {
                console.error('Ticker error:', symbol, err);
                return null;
            });
    }

    function loadKlinesData(symbol, interval, limit) {
        limit = limit || 100;
        return apiRequest('/v5/market/kline?category=linear&symbol=' + symbol + '&interval=' + interval + '&limit=' + limit)
            .then(function(result) {
                if (result && result.list) {
                    var klines = [];
                    for (var i = result.list.length - 1; i >= 0; i--) {
                        var k = result.list[i];
                        klines.push({
                            time: parseInt(k[0]),
                            open: parseFloat(k[1]),
                            high: parseFloat(k[2]),
                            low: parseFloat(k[3]),
                            close: parseFloat(k[4]),
                            volume: parseFloat(k[5])
                        });
                    }
                    return klines;
                }
                return [];
            })
            .catch(function(err) {
                console.error('Klines error:', err);
                return [];
            });
    }

    function loadOpenInterest(symbol) {
        return apiRequest('/v5/market/open-interest?category=linear&symbol=' + symbol + '&intervalTime=1h&limit=1')
            .then(function(result) {
                if (result && result.list && result.list[0]) {
                    return parseFloat(result.list[0].openInterest) || 0;
                }
                return 0;
            })
            .catch(function() { return 0; });
    }

    function loadOrderbook(symbol) {
        return apiRequest('/v5/market/orderbook?category=linear&symbol=' + symbol + '&limit=25')
            .then(function(result) {
                if (result && result.b && result.a) {
                    var bids = 0, asks = 0;
                    for (var i = 0; i < result.b.length; i++) {
                        bids += parseFloat(result.b[i][1]);
                    }
                    for (var j = 0; j < result.a.length; j++) {
                        asks += parseFloat(result.a[j][1]);
                    }
                    var total = bids + asks;
                    return total > 0 ? (bids - asks) / total : 0;
                }
                return 0;
            })
            .catch(function() { return 0; });
    }

    function loadFearGreed() {
        return fetch('https://api.alternative.me/fng/?limit=1')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data && data.data && data.data[0]) {
                    return {
                        value: parseInt(data.data[0].value) || 50,
                        label: data.data[0].value_classification || 'Neutral'
                    };
                }
                return { value: 50, label: 'Neutral' };
            })
            .catch(function() {
                return { value: 50, label: 'Neutral' };
            });
    }

    // ==========================================
    // WEBSOCKET - СТАБИЛЬНАЯ ВЕРСИЯ
    // ==========================================
    function startWebSocket() {
        if (state.wsInstance) {
            try {
                state.wsInstance.close();
            } catch(e) {}
            state.wsInstance = null;
        }

        showConnectionStatus('connecting');

        try {
            state.wsInstance = new WebSocket(CONFIG.wsUrl);
        } catch(e) {
            console.error('WS create error:', e);
            setTimeout(startWebSocket, 5000);
            return;
        }

        state.wsInstance.onopen = function() {
            console.log('WS: Connected');
            state.wsConnected = true;
            showConnectionStatus('connected');

            // Подписываемся на все тикеры
            var symbols = [];
            for (var i = 0; i < CONFIG.cryptos.length; i++) {
                symbols.push('tickers.' + CONFIG.cryptos[i].id);
            }
            
            state.wsInstance.send(JSON.stringify({
                op: 'subscribe',
                args: symbols
            }));
        };

        state.wsInstance.onmessage = function(evt) {
            handleWsMessage(evt.data);
        };

        state.wsInstance.onclose = function() {
            console.log('WS: Disconnected');
            state.wsConnected = false;
            showConnectionStatus('disconnected');
            
            // Переподключение через 3 секунды
            setTimeout(startWebSocket, 3000);
        };

        state.wsInstance.onerror = function() {
            state.wsConnected = false;
            showConnectionStatus('disconnected');
        };
    }

    function handleWsMessage(rawData) {
        var msg;
        try {
            msg = JSON.parse(rawData);
        } catch(e) {
            return; // Игнорируем невалидные сообщения
        }

        // Проверяем что это тикер
        if (!msg.topic || !msg.data) return;
        if (msg.topic.indexOf('tickers.') !== 0) return;

        var symbol = msg.topic.replace('tickers.', '');
        var tickerData = msg.data;

        // Получаем текущие данные
        var current = state.priceData[symbol];
        if (!current) return;

        // КЛЮЧЕВОЙ МОМЕНТ: Обновляем ТОЛЬКО если есть валидное значение
        var newPrice = parseFloat(tickerData.lastPrice);
        var newChange = parseFloat(tickerData.price24hPcnt);
        var newHigh = parseFloat(tickerData.highPrice24h);
        var newLow = parseFloat(tickerData.lowPrice24h);
        var newVolume = parseFloat(tickerData.turnover24h);
        var newFunding = parseFloat(tickerData.fundingRate);

        // Обновляем только валидные значения
        if (!isNaN(newPrice) && newPrice > 0) {
            current.price = newPrice;
        }
        if (!isNaN(newChange)) {
            current.change24h = newChange * 100;
        }
        if (!isNaN(newHigh) && newHigh > 0) {
            current.high24h = newHigh;
        }
        if (!isNaN(newLow) && newLow > 0) {
            current.low24h = newLow;
        }
        if (!isNaN(newVolume) && newVolume > 0) {
            current.volume24h = newVolume;
        }
        if (!isNaN(newFunding)) {
            current.fundingRate = newFunding * 100;
        }

        current.isLoaded = true;

        // Планируем обновление UI (debounce)
        scheduleUIUpdate();
    }

    function showConnectionStatus(status) {
        var el = getEl('wsStatus');
        if (!el) return;

        var html, cls;
        switch(status) {
            case 'connected':
                cls = 'connection-status connected';
                html = '<div class="status-dot"></div><span>Live</span>';
                break;
            case 'disconnected':
                cls = 'connection-status disconnected';
                html = '<div class="status-dot"></div><span>Offline</span>';
                break;
            default:
                cls = 'connection-status connecting';
                html = '<div class="status-dot"></div><span>Connecting...</span>';
        }

        el.className = cls;
        el.innerHTML = html;
    }

    // ==========================================
    // DEBOUNCED UI UPDATE
    // ==========================================
    function scheduleUIUpdate() {
        if (state.updateScheduled) return;
        state.updateScheduled = true;
        
        requestAnimationFrame(function() {
            state.updateScheduled = false;
            performUIUpdate();
        });
    }

    function performUIUpdate() {
        updateMainPrice();
        updateAllTabPrices();
    }

    // ==========================================
    // UI ОБНОВЛЕНИЯ
    // ==========================================
    function updateMainPrice() {
        var data = state.priceData[state.activeCrypto];
        if (!data || !data.isLoaded) return;

        // Основная цена
        safeSetText('livePrice', fmtPrice(data.price));

        // Изменение за 24ч
        var changeText = fmtPercent(data.change24h);
        var changeClass = 'text-lg ' + (data.change24h >= 0 ? 'text-green-400' : 'text-red-400');
        safeSetText('priceChange', changeText);
        safeSetClass('priceChange', changeClass);

        // Доп. данные
        safeSetText('high24h', fmtPrice(data.high24h));
        safeSetText('low24h', fmtPrice(data.low24h));
        safeSetText('volume24h', fmtVolume(data.volume24h));

        // Funding rate
        var fr = data.fundingRate;
        safeSetText('fundingRate', 'Funding: ' + fmtPercent(fr));
        var frClass = 'funding-rate ' + (fr > 0 ? 'positive' : fr < 0 ? 'negative' : 'neutral');
        safeSetClass('fundingRate', frClass);

        // Open Interest
        var oi = state.oiData[state.activeCrypto] || 0;
        if (oi > 0 && data.price > 0) {
            safeSetText('openInterest', fmtVolume(oi * data.price));
        }
    }

    function updateAllTabPrices() {
        for (var i = 0; i < CONFIG.cryptos.length; i++) {
            var crypto = CONFIG.cryptos[i];
            var data = state.priceData[crypto.id];
            
            if (data && data.isLoaded) {
                safeSetText('tab-price-' + crypto.id, fmtPrice(data.price));
                
                var changeEl = getEl('tab-change-' + crypto.id);
                if (changeEl) {
                    changeEl.textContent = fmtPercent(data.change24h);
                    changeEl.className = 'text-xs ' + (data.change24h >= 0 ? 'text-green-400' : 'text-red-400');
                }
            }
        }
    }

    function updateCPSGauge() {
        var indicators = state.indicatorsData[state.activeCrypto];
        if (!indicators) return;

        var cps = computeCPS(indicators);
        var info = getCPSLabel(cps);

        // Стрелка
        var angle = cps * 90;
        safeSetStyle('gaugeNeedle', 'transform', 'translateX(-50%) rotate(' + angle + 'deg)');

        // Значение
        safeSetText('cpsValue', Math.round(cps * 100));
        safeSetStyle('cpsValue', 'color', info.color);
        safeSetText('cpsLabel', info.label);
        safeSetStyle('cpsLabel', 'color', info.color);
    }

    function updateFearGreedGauge() {
        var fg = state.fgData;
        safeSetText('fgValue', fg.value);
        safeSetText('fgLabel', fg.label.toUpperCase());

        var offset = 283 - (fg.value / 100) * 283;
        safeSetStyle('fgCircle', 'strokeDashoffset', offset.toString());

        var color = '#9945ff';
        if (fg.value < 25) color = '#ff3366';
        else if (fg.value < 45) color = '#ff6644';
        else if (fg.value >= 75) color = '#00ff88';
        else if (fg.value >= 55) color = '#00dd66';

        safeSetStyle('fgCircle', 'stroke', color);
    }

    function updateCountdownDisplay() {
        state.countdown--;
        if (state.countdown <= 0) {
            state.countdown = CONFIG.intervals[state.activeInterval].seconds;
            doRefresh();
        }

        var m = Math.floor(state.countdown / 60);
        var s = state.countdown % 60;
        var text = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
        safeSetText('countdownText', text);

        var total = CONFIG.intervals[state.activeInterval].seconds;
        var pct = state.countdown / total;
        var offset = 283 * (1 - pct);
        safeSetStyle('countdownRing', 'strokeDashoffset', offset.toString());
    }

    function updateTimeDisplay() {
        var now = new Date();
        var h = now.getHours();
        var m = now.getMinutes();
        var s = now.getSeconds();
        var text = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
        safeSetText('currentTime', text);
    }

    function updateStatsDisplay() {
        var st = state.statsData;
        var winRate = st.total > 0 ? (st.wins / st.total * 100) : 0;

        safeSetText('winRate', winRate.toFixed(1) + '%');
        safeSetText('totalTrades', st.total);
        safeSetText('winningTrades', st.wins);
        safeSetText('losingTrades', st.losses);

        var plEl = getEl('totalPL');
        if (plEl) {
            plEl.textContent = (st.totalPL >= 0 ? '+' : '') + '$' + st.totalPL.toFixed(2);
            plEl.className = 'title-font ' + (st.totalPL >= 0 ? 'text-green-400' : 'text-red-400');
        }

        // Средние
        var wins = state.tradesHistory.filter(function(t) { return t.pl > 0; });
        var losses = state.tradesHistory.filter(function(t) { return t.pl < 0; });

        var avgW = 0, avgL = 0;
        if (wins.length > 0) {
            var sumW = 0;
            for (var i = 0; i < wins.length; i++) sumW += wins[i].pl;
            avgW = sumW / wins.length;
        }
        if (losses.length > 0) {
            var sumL = 0;
            for (var j = 0; j < losses.length; j++) sumL += Math.abs(losses[j].pl);
            avgL = sumL / losses.length;
        }

        safeSetText('avgProfit', '+$' + avgW.toFixed(2));
        safeSetText('avgLoss', '-$' + avgL.toFixed(2));

        if (state.tradesHistory.length > 0) {
            var best = -Infinity, worst = Infinity;
            for (var k = 0; k < state.tradesHistory.length; k++) {
                var pl = state.tradesHistory[k].pl || 0;
                if (pl > best) best = pl;
                if (pl < worst) worst = pl;
            }
            safeSetText('bestTrade', '+$' + Math.max(0, best).toFixed(2));
            safeSetText('worstTrade', '-$' + Math.abs(Math.min(0, worst)).toFixed(2));
        }
    }

    // ==========================================
    // RENDER ФУНКЦИИ
    // ==========================================
    function renderCryptoTabs() {
        var html = '';
        for (var i = 0; i < CONFIG.cryptos.length; i++) {
            var c = CONFIG.cryptos[i];
            var active = c.id === state.activeCrypto ? 'active' : '';
            
            html += '<div class="crypto-tab glass-panel px-4 py-3 flex items-center gap-3 ' + active + '" onclick="App.selectCrypto(\'' + c.id + '\')">';
            html += '<div class="w-8 h-8 rounded-full flex items-center justify-center" style="background:' + c.color + '30">';
            html += '<span class="title-font font-bold" style="color:' + c.color + '">' + c.symbol[0] + '</span>';
            html += '</div>';
            html += '<div><div class="font-semibold">' + c.symbol + '</div>';
            html += '<div class="text-xs text-gray-500">' + c.name + '</div></div>';
            html += '<div class="ml-auto text-right">';
            html += '<div id="tab-price-' + c.id + '" class="font-mono text-sm">Loading...</div>';
            html += '<div id="tab-change-' + c.id + '" class="text-xs text-gray-400">--%</div>';
            html += '</div></div>';
        }
        safeSetHtml('cryptoTabs', html);
    }

    function renderPredictionCards() {
        var preds = state.predictionsData[state.activeCrypto] || {};
        var html = '';

        for (var i = 0; i < CONFIG.intervals.length; i++) {
            var interval = CONFIG.intervals[i];
            var pred = preds[interval.key];
            var isActive = pred && pred.status === 'ACTIVE';
            var isCurrent = i === state.activeInterval;

            var progress = 0;
            var timeLeft = 'Waiting...';

            if (pred && isActive) {
                var elapsed = Date.now() - pred.createdAt;
                var total = pred.expiresAt - pred.createdAt;
                progress = Math.min(100, (elapsed / total) * 100);
                timeLeft = fmtTime(pred.expiresAt - Date.now());
            }

            var dirClass = '';
            var dirText = '--';
            if (pred) {
                dirClass = pred.direction === 'LONG' ? 'text-green-400' : 'text-red-400';
                dirText = pred.direction + ' (' + pred.confidence + '%)';
            }

            var cardClass = 'prediction-card glass-panel p-4';
            if (isCurrent) cardClass += ' active';
            if (isActive) cardClass += ' locked';

            html += '<div class="' + cardClass + '" onclick="App.selectInterval(' + i + ')">';
            html += '<div class="flex items-center justify-between mb-2">';
            html += '<span class="title-font text-xs text-gray-400">' + interval.label + '</span>';
            if (isActive) html += '<span class="text-xs">🔒</span>';
            html += '</div>';
            html += '<div class="title-font text-lg font-bold">' + (pred ? fmtPrice(pred.targetPrice) : '--') + '</div>';
            html += '<div class="text-xs mb-1 ' + dirClass + '">' + dirText + '</div>';
            html += '<div class="text-xs text-gray-500">' + timeLeft + '</div>';
            html += '<div class="progress-bar"><div class="progress-fill" style="width:' + progress + '%"></div></div>';
            html += '</div>';
        }

        safeSetHtml('predictionCards', html);
    }

    function renderIndicatorsHeatmap() {
        var ind = state.indicatorsData[state.activeCrypto];
        if (!ind) return;

        var params = [
            { key: 'rsi', name: 'RSI', icon: '📊' },
            { key: 'macd', name: 'MACD', icon: '📈' },
            { key: 'bollinger', name: 'BB', icon: '📉' },
            { key: 'momentum', name: 'MOM', icon: '🚀' },
            { key: 'orderbook', name: 'ORDERS', icon: '📕' },
            { key: 'funding', name: 'FUND', icon: '💰' },
            { key: 'fearGreed', name: 'F&G', icon: '😱' }
        ];

        var html = '';
        for (var i = 0; i < params.length; i++) {
            var p = params[i];
            var val = ind[p.key] || 0;
            var cls = val > 0.1 ? 'bullish' : val < -0.1 ? 'bearish' : 'neutral';
            var colorClass = val >= 0 ? 'text-green-400' : 'text-red-400';
            var pctText = (val >= 0 ? '+' : '') + Math.round(val * 100) + '%';

            html += '<div class="param-block ' + cls + '">';
            html += '<div class="flex items-center justify-between mb-1">';
            html += '<span class="text-lg">' + p.icon + '</span>';
            html += '<span class="text-xs font-mono ' + colorClass + '">' + pctText + '</span>';
            html += '</div>';
            html += '<div class="text-xs text-gray-400">' + p.name + '</div>';
            html += '</div>';
        }

        safeSetHtml('paramHeatmap', html);
    }

    function renderTradeHistory() {
        if (state.tradesHistory.length === 0) {
            safeSetHtml('tradeHistory', '<div class="text-center text-gray-500 py-8">Waiting for predictions to complete...</div>');
            return;
        }

        var html = '';
        var trades = state.tradesHistory.slice(0, 20);

        for (var i = 0; i < trades.length; i++) {
            var t = trades[i];
            var crypto = null;
            for (var j = 0; j < CONFIG.cryptos.length; j++) {
                if (CONFIG.cryptos[j].id === t.symbol) {
                    crypto = CONFIG.cryptos[j];
                    break;
                }
            }

            var accClass = t.accuracy >= 60 ? 'high' : t.accuracy >= 40 ? 'medium' : 'low';
            var plClass = t.pl >= 0 ? 'text-green-400' : 'text-red-400';
            var dirClass = t.direction === 'LONG' ? 'long' : 'short';
            var statusClass = 'status-' + t.status.toLowerCase();
            var timeStr = new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            html += '<div class="trade-row">';
            html += '<div class="text-gray-400">' + timeStr + '</div>';
            html += '<div style="color:' + (crypto ? crypto.color : '#fff') + '">' + (crypto ? crypto.symbol : t.symbol) + '</div>';
            html += '<div><span class="direction-badge ' + dirClass + '">' + t.direction + '</span></div>';
            html += '<div class="text-gray-400">' + t.intervalLabel + '</div>';
            html += '<div class="font-mono text-xs">' + fmtPrice(t.entryPrice) + ' → ' + fmtPrice(t.exitPrice) + '</div>';
            html += '<div class="font-mono text-xs text-gray-400">' + fmtPrice(t.targetPrice) + '</div>';
            html += '<div><span class="accuracy-badge ' + accClass + '">' + (t.accuracy || 0).toFixed(0) + '%</span></div>';
            html += '<div class="font-mono font-bold ' + plClass + '">' + (t.pl >= 0 ? '+' : '') + '$' + (t.pl || 0).toFixed(2) + '</div>';
            html += '<div class="' + statusClass + '">' + t.status + '</div>';
            html += '</div>';
        }

        safeSetHtml('tradeHistory', html);
    }

    // ==========================================
    // ИНДИКАТОРЫ
    // ==========================================
    function calcRSI(closes, period) {
        period = period || 14;
        if (closes.length < period + 1) return 50;

        var gains = 0, losses = 0;
        for (var i = closes.length - period; i < closes.length; i++) {
            var diff = closes[i] - closes[i - 1];
            if (diff > 0) gains += diff;
            else losses -= diff;
        }

        if (losses === 0) return 100;
        var rs = (gains / period) / (losses / period);
        return 100 - (100 / (1 + rs));
    }

    function calcMACD(closes) {
        if (closes.length < 26) return 0;

        function ema(data, p) {
            var k = 2 / (p + 1);
            var sum = 0;
            for (var i = 0; i < p && i < data.length; i++) sum += data[i];
            var result = sum / Math.min(p, data.length);
            for (var j = p; j < data.length; j++) {
                result = data[j] * k + result * (1 - k);
            }
            return result;
        }

        return ema(closes, 12) - ema(closes, 26);
    }

    function calcBollinger(closes, period) {
        period = period || 20;
        if (closes.length < period) return 0.5;

        var slice = closes.slice(-period);
        var sum = 0;
        for (var i = 0; i < slice.length; i++) sum += slice[i];
        var avg = sum / period;

        var variance = 0;
        for (var j = 0; j < slice.length; j++) {
            variance += (slice[j] - avg) * (slice[j] - avg);
        }
        var std = Math.sqrt(variance / period);

        if (std === 0) return 0.5;
        var current = closes[closes.length - 1];
        var lower = avg - 2 * std;
        var upper = avg + 2 * std;
        return (current - lower) / (upper - lower);
    }

    function calcMomentum(closes, period) {
        period = period || 10;
        if (closes.length < period + 1) return 0;
        var current = closes[closes.length - 1];
        var past = closes[closes.length - period - 1];
        if (past === 0) return 0;
        return ((current - past) / past) * 100;
    }

    function computeIndicators(symbol) {
        var klines = state.klinesData[symbol];
        if (!klines || klines.length < 30) return null;

        var closes = [];
        for (var i = 0; i < klines.length; i++) {
            closes.push(klines[i].close);
        }

        var priceData = state.priceData[symbol];
        var currentPrice = priceData && priceData.price > 0 ? priceData.price : closes[closes.length - 1];

        var rsi = calcRSI(closes);
        var macd = calcMACD(closes);
        var bb = calcBollinger(closes);
        var mom = calcMomentum(closes);

        // Нормализация -1 до 1
        return {
            rsi: (50 - rsi) / 50,
            macd: Math.max(-1, Math.min(1, macd / currentPrice * 100)),
            bollinger: (0.5 - bb) * 2,
            momentum: Math.max(-1, Math.min(1, mom / 5)),
            orderbook: 0, // Будет обновлено отдельно
            funding: priceData ? -Math.max(-1, Math.min(1, priceData.fundingRate * 10)) : 0,
            fearGreed: (50 - state.fgData.value) / 50
        };
    }

    function computeCPS(indicators) {
        if (!indicators) return 0;

        var weights = {
            rsi: 0.18,
            macd: 0.15,
            bollinger: 0.12,
            momentum: 0.15,
            orderbook: 0.15,
            funding: 0.13,
            fearGreed: 0.12
        };

        var cps = 0;
        for (var key in weights) {
            cps += (indicators[key] || 0) * weights[key];
        }

        return Math.max(-1, Math.min(1, cps));
    }

    function getCPSLabel(cps) {
        if (cps >= 0.4) return { label: 'STRONG BUY', color: '#00ff88', dir: 'LONG' };
        if (cps >= 0.1) return { label: 'BUY', color: '#00dd66', dir: 'LONG' };
        if (cps >= -0.1) return { label: 'NEUTRAL', color: '#9945ff', dir: 'LONG' };
        if (cps >= -0.4) return { label: 'SELL', color: '#ff6644', dir: 'SHORT' };
        return { label: 'STRONG SELL', color: '#ff3366', dir: 'SHORT' };
    }

    // ==========================================
    // ПРОГНОЗЫ
    // ==========================================
    function createPrediction(symbol, intervalCfg) {
        var priceData = state.priceData[symbol];
        var indicators = state.indicatorsData[symbol];

        if (!priceData || priceData.price <= 0 || !indicators) return null;

        var cps = computeCPS(indicators);
        var info = getCPSLabel(cps);

        var volatility = 0.008;
        var timeFactor = Math.sqrt(intervalCfg.seconds / 60);
        var direction = info.dir === 'LONG' ? 1 : -1;
        var magnitude = Math.abs(cps);

        var move = priceData.price * volatility * timeFactor * magnitude * direction;
        var target = priceData.price + move;

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
        if (!state.predictionsData[symbol]) {
            state.predictionsData[symbol] = {};
        }

        for (var i = 0; i < CONFIG.intervals.length; i++) {
            var interval = CONFIG.intervals[i];
            var existing = state.predictionsData[symbol][interval.key];

            if (!existing || existing.status !== 'ACTIVE') {
                var pred = createPrediction(symbol, interval);
                if (pred) {
                    state.predictionsData[symbol][interval.key] = pred;
                    console.log('New prediction:', symbol, interval.label, pred.direction);
                }
            }
        }
    }

    function checkExpiredPredictions() {
        var now = Date.now();

        for (var symbol in state.predictionsData) {
            for (var intervalKey in state.predictionsData[symbol]) {
                var pred = state.predictionsData[symbol][intervalKey];
                if (pred && pred.status === 'ACTIVE' && now >= pred.expiresAt) {
                    evaluatePrediction(pred);
                }
            }
        }
    }

    function evaluatePrediction(pred) {
        var priceData = state.priceData[pred.symbol];
        if (!priceData || priceData.price <= 0) return;

        var exitPrice = priceData.price;
        var entryPrice = pred.entryPrice;
        var change = (exitPrice - entryPrice) / entryPrice;

        // P/L
        var pl;
        if (pred.direction === 'LONG') {
            pl = change * CONFIG.investment;
        } else {
            pl = -change * CONFIG.investment;
        }

        // Accuracy
        var predictedChange = (pred.targetPrice - entryPrice) / entryPrice;
        var actualDir = change > 0 ? 'LONG' : 'SHORT';
        var correct = pred.direction === actualDir;

        var accuracy;
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
        var tradeCopy = {};
        for (var k in pred) tradeCopy[k] = pred[k];
        state.tradesHistory.unshift(tradeCopy);
        if (state.tradesHistory.length > 50) state.tradesHistory.pop();

        // Update stats
        state.statsData.total++;
        if (pl >= 0) state.statsData.wins++;
        else state.statsData.losses++;
        state.statsData.totalPL += pl;

        console.log('Trade closed:', pred.symbol, pred.direction, 'P/L: $' + pl.toFixed(2));

        // Create new prediction
        var intervalCfg = null;
        for (var i = 0; i < CONFIG.intervals.length; i++) {
            if (CONFIG.intervals[i].key === pred.interval) {
                intervalCfg = CONFIG.intervals[i];
                break;
            }
        }

        if (intervalCfg) {
            var newPred = createPrediction(pred.symbol, intervalCfg);
            if (newPred) {
                state.predictionsData[pred.symbol][pred.interval] = newPred;
            }
        }

        // Update UI
        renderTradeHistory();
        updateStatsDisplay();
        renderPredictionCards();
    }

    // ==========================================
    // CHART
    // ==========================================
    function initChart() {
        var canvas = getEl('priceChart');
        if (!canvas) return;

        state.chartInstance = new Chart(canvas.getContext('2d'), {
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
                animation: false,
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
                            callback: function(v) { return fmtPrice(v); }
                        }
                    }
                }
            }
        });
    }

    function updateChart() {
        if (!state.chartInstance) return;

        var klines = state.klinesData[state.activeCrypto];
        if (!klines || klines.length === 0) return;

        var limits = { '1h': 60, '4h': 48, '1d': 96 };
        var limit = limits[state.chartRange] || 96;

        var data = klines.slice(-limit);
        var labels = [];
        var prices = [];

        for (var i = 0; i < data.length; i++) {
            var d = new Date(data[i].time);
            labels.push((d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes());
            prices.push(data[i].close);
        }

        // Prediction point
        var predData = [];
        for (var j = 0; j < prices.length; j++) predData.push(null);

        var preds = state.predictionsData[state.activeCrypto];
        if (preds) {
            var currentInterval = CONFIG.intervals[state.activeInterval];
            var activePred = preds[currentInterval.key];
            if (activePred && activePred.status === 'ACTIVE') {
                predData[predData.length - 1] = activePred.targetPrice;
            }
        }

        state.chartInstance.data.labels = labels;
        state.chartInstance.data.datasets[0].data = prices;
        state.chartInstance.data.datasets[1].data = predData;
        state.chartInstance.update('none');
    }

    // ==========================================
    // REFRESH DATA
    // ==========================================
    function doRefresh() {
        var symbol = state.activeCrypto;

        loadOrderbook(symbol).then(function(imbalance) {
            if (state.indicatorsData[symbol]) {
                state.indicatorsData[symbol].orderbook = imbalance;
            }
        });

        loadOpenInterest(symbol).then(function(oi) {
            state.oiData[symbol] = oi;
        });

        var indicators = computeIndicators(symbol);
        if (indicators) {
            state.indicatorsData[symbol] = indicators;
            updateCPSGauge();
            renderIndicatorsHeatmap();
        }

        updateChart();
    }

    // ==========================================
    // PUBLIC API
    // ==========================================
    function selectCrypto(symbol) {
        state.activeCrypto = symbol;
        renderCryptoTabs();

        var intervalBybit = CONFIG.intervals[state.activeInterval].bybit;

        // Load klines if needed
        if (!state.klinesData[symbol] || state.klinesData[symbol].length === 0) {
            loadKlinesData(symbol, intervalBybit).then(function(klines) {
                state.klinesData[symbol] = klines;

                var indicators = computeIndicators(symbol);
                if (indicators) {
                    state.indicatorsData[symbol] = indicators;
                }

                generatePredictions(symbol);
                updateMainPrice();
                updateCPSGauge();
                renderIndicatorsHeatmap();
                renderPredictionCards();
                updateChart();
            });
        } else {
            var indicators = computeIndicators(symbol);
            if (indicators) {
                state.indicatorsData[symbol] = indicators;
            }

            generatePredictions(symbol);
            updateMainPrice();
            updateCPSGauge();
            renderIndicatorsHeatmap();
            renderPredictionCards();
            updateChart();
        }

        // Load additional data
        loadOpenInterest(symbol).then(function(oi) {
            state.oiData[symbol] = oi;
            updateMainPrice();
        });

        loadOrderbook(symbol).then(function(imbalance) {
            if (state.indicatorsData[symbol]) {
                state.indicatorsData[symbol].orderbook = imbalance;
                renderIndicatorsHeatmap();
            }
        });
    }

    function selectInterval(idx) {
        state.activeInterval = idx;
        state.countdown = CONFIG.intervals[idx].seconds;
        safeSetText('activeInterval', CONFIG.intervals[idx].label + ' INTERVAL');

        var symbol = state.activeCrypto;
        var intervalBybit = CONFIG.intervals[idx].bybit;

        loadKlinesData(symbol, intervalBybit).then(function(klines) {
            state.klinesData[symbol] = klines;

            var indicators = computeIndicators(symbol);
            if (indicators) {
                state.indicatorsData[symbol] = indicators;
            }

            renderPredictionCards();
            updateChart();
        });
    }

    function setChartRange(range) {
        state.chartRange = range;

        var buttons = document.querySelectorAll('.chart-range-btn');
        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
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
    function init() {
        console.log('Starting CryptoOracle Pro...');

        // Инициализация структуры данных
        initPriceData();

        // Рендер статических элементов
        renderCryptoTabs();
        renderPredictionCards();
        initChart();

        var loadingStatus = getEl('loadingStatus');

        // Загрузка данных последовательно
        var loadPromises = [];

        for (var i = 0; i < CONFIG.cryptos.length; i++) {
            (function(crypto) {
                var promise = loadTickerData(crypto.id).then(function(data) {
                    if (data) {
                        state.priceData[crypto.id] = {
                            price: data.price,
                            change24h: data.change24h,
                            high24h: data.high24h,
                            low24h: data.low24h,
                            volume24h: data.volume24h,
                            fundingRate: data.fundingRate,
                            isLoaded: true
                        };
                        updateTabPrice(crypto.id);
                    }
                    return true;
                });
                loadPromises.push(promise);
            })(CONFIG.cryptos[i]);
        }

        // Load initial klines for active crypto
        var initialKlinesPromise = loadKlinesData(state.activeCrypto, CONFIG.intervals[0].bybit)
            .then(function(klines) {
                state.klinesData[state.activeCrypto] = klines;
                return true;
            });
        loadPromises.push(initialKlinesPromise);

        // Fear & Greed
        var fgPromise = loadFearGreed().then(function(fg) {
            state.fgData = fg;
            updateFearGreedGauge();
            return true;
        });
        loadPromises.push(fgPromise);

        // Wait for all data
        Promise.all(loadPromises).then(function() {
            if (loadingStatus) loadingStatus.textContent = 'Calculating...';

            // Compute indicators
            var indicators = computeIndicators(state.activeCrypto);
            if (indicators) {
                state.indicatorsData[state.activeCrypto] = indicators;
            }

            // Generate predictions
            generatePredictions(state.activeCrypto);

            // Load orderbook
            return loadOrderbook(state.activeCrypto);
        }).then(function(imbalance) {
            if (state.indicatorsData[state.activeCrypto]) {
                state.indicatorsData[state.activeCrypto].orderbook = imbalance;
            }

            return loadOpenInterest(state.activeCrypto);
        }).then(function(oi) {
            state.oiData[state.activeCrypto] = oi;

            // Update all UI
            updateMainPrice();
            updateCPSGauge();
            renderIndicatorsHeatmap();
            renderPredictionCards();
            updateChart();
            updateStatsDisplay();

            // Start WebSocket
            if (loadingStatus) loadingStatus.textContent = 'Connecting...';
            startWebSocket();

            // Hide loading overlay
            var overlay = getEl('loadingOverlay');
            if (overlay) overlay.classList.add('hidden');

            state.initialized = true;
            console.log('CryptoOracle Pro ready!');

            // Start timers
            setInterval(updateTimeDisplay, 1000);
            setInterval(updateCountdownDisplay, 1000);
            setInterval(checkExpiredPredictions, 1000);
            setInterval(renderPredictionCards, 5000);

            // Periodic refresh
            setInterval(function() {
                loadFearGreed().then(function(fg) {
                    state.fgData = fg;
                    updateFearGreedGauge();
                });
            }, 300000);

            setInterval(doRefresh, 30000);

        }).catch(function(err) {
            console.error('Init error:', err);

            var overlay = getEl('loadingOverlay');
            if (overlay) {
                overlay.innerHTML = '<div class="loading-content">' +
                    '<div class="title-font text-xl text-red-400 mb-4">Connection Error</div>' +
                    '<div class="text-gray-400 mb-4">' + (err.message || 'Unknown error') + '</div>' +
                    '<button onclick="location.reload()" class="px-6 py-2 bg-purple-600 rounded-lg hover:bg-purple-700">Retry</button>' +
                    '</div>';
            }
        });
    }

    // Start on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Export public API
    window.App = {
        selectCrypto: selectCrypto,
        selectInterval: selectInterval,
        setChartRange: setChartRange
    };

})();
