/**
 * 自选股票统计表 - 实时数据展示
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'a_stock_watchlist';
  const DATA_FILE = './data/watchlist.json';
  // 硬编码种子数据（最终回退，防止任何缓存导致数据丢失）
  const EMBEDDED_SEED = [
    { "code": "600519", "name": "贵州茅台" },
    { "code": "300750", "name": "宁德时代" },
    { "code": "002594", "name": "比亚迪" },
    { "code": "601318", "name": "中国平安" },
    { "code": "600036", "name": "招商银行" },
    { "code": "300433", "name": "蓝思科技" },
    { "code": "600667", "name": "太极实业" }
  ];
  let watchlist = [];
  let stockDataCache = {};
  let stockDetailCache = {};
  let currentSelectedStock = null;
  let currentTrendPeriod = null;  // 当前走势周期
  let trendRefreshTimer = null;  // 走势刷新定时器
  let trendChartInstance = null;  // 走势图ECharts实例（复用，避免重建）

  // 生成完整交易时段固定时间轴（9:30-11:30, 13:00-15:00，每分钟一个点）
  function generateTradingDayTimes() {
    var times = [];
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    // 上午 9:30-11:30
    for (var m = 30; m < 60; m++) times.push('09:' + pad(m));
    for (var h = 10; h <= 10; h++) { for (var m = 0; m < 60; m++) times.push(pad(h) + ':' + pad(m)); }
    for (var m = 0; m <= 30; m++) times.push('11:' + pad(m));
    // 下午 13:00-15:00
    for (var h = 13; h <= 14; h++) { for (var m = 0; m < 60; m++) times.push(pad(h) + ':' + pad(m)); }
    times.push('15:00');
    return times;
  }

  // 交易时间判断（A股 9:30-11:30, 13:00-15:00 周一至周五）
  function isTradingTime() {
    var now = new Date();
    var day = now.getDay();
    if (day === 0 || day === 6) return false;
    var h = now.getHours();
    var m = now.getMinutes();
    var t = h * 100 + m;
    return (t >= 930 && t <= 1130) || (t >= 1300 && t <= 1500);
  }

  // 加载自选股（三级回退：HTML内联种子 → JS硬编码种子 → localStorage）
  function loadWatchlist() {
    try {
      let data = null;
      // 1. 优先使用 HTML 内联种子（window.__STOCK_WATCHLIST_SEED__）
      if (window.__STOCK_WATCHLIST_SEED__ && window.__STOCK_WATCHLIST_SEED__.length > 0) {
        data = window.__STOCK_WATCHLIST_SEED__;
      }
      // 2. 回退到 JS 硬编码种子（EMBEDDED_SEED）
      if (!data || !data.length) {
        data = EMBEDDED_SEED;
      }
      // 3. 如果 localStorage 有更新的数据，合并进去（补充新增的自选股）
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        try {
          const localData = JSON.parse(raw);
          if (Array.isArray(localData) && localData.length > 0) {
            // 合并：localStorage 中有但种子中没有的股票，追加到列表
            for (const item of localData) {
              if (item && item.code && !data.some(d => d.code === item.code)) {
                data = data.concat([item]);
              }
            }
          }
        } catch(e) {}
      }
      if (!data || !Array.isArray(data)) return [];
      const result = [];
      for (const item of data) {
        if (typeof item === 'string' && /^\d{6}$/.test(item)) {
          result.push({ code: item, name: item });
        } else if (item && typeof item === 'object' && item.code && /^\d{6}$/.test(item.code)) {
          const cleanName = (item.name || item.code).replace(/\s+/g, '');
          result.push({ code: item.code, name: cleanName });
        }
      }
      saveWatchlist(result);
      return result;
    } catch(e) {
      console.warn('[自选页面] 自选股数据加载失败:', e);
      return EMBEDDED_SEED.slice();
    }
  }

  // 保存自选股（同时更新 localStorage 和内存种子数据）
  function saveWatchlist(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      // 同步更新内存种子数据，确保当前会话一致
      window.__STOCK_WATCHLIST_SEED__ = list.slice();
      // 审计日志：记录自选股变更，便于未来核查
      var summary = list.map(function(i){return i.code+'-'+i.name;}).join(', ');
      console.info('[自选股审计] ' + new Date().toLocaleString('zh-CN') + ' | 共' + list.length + '只: ' + summary);
    } catch(e) {
      console.warn('[自选页面] 自选股保存失败:', e);
    }
  }

  // ==================== 工具函数 ====================
  function formatNumber(n) { return (n === null || n === undefined || isNaN(n)) ? '--' : n.toFixed(2); }
  function getChangeClass(c) { return c >= 0 ? 'up' : 'down'; }
  function getChangeSign(c) { return c >= 0 ? '+' : ''; }
  function formatVolume(v) {
    if (!v || isNaN(v)) return '--';
    if (v >= 100000000) return (v / 100000000).toFixed(2) + '亿';
    if (v >= 10000) return (v / 10000).toFixed(2) + '万';
    return v.toString();
  }

  // 判断市场前缀
  function getPrefix(code) {
    if (!code) return 'sz';
    if (code.startsWith('6') || code.startsWith('688') || code.startsWith('689')) return 'sh';
    if (code.startsWith('0') || code.startsWith('3') || code.startsWith('00') || code.startsWith('30')) return 'sz';
    if (code.startsWith('4') || code.startsWith('8')) return 'bj';
    return 'sz';
  }

  // 判断东方财富secid
  function getSecid(code) {
    if (!code) return '';
    if (code.startsWith('6')) return '1.' + code;
    if (code.startsWith('0') || code.startsWith('3')) return '0.' + code;
    if (code.startsWith('4') || code.startsWith('8')) return '0.' + code;
    return '0.' + code;
  }

  // Toast 提示
  let toastTimer = null;
  function showToast(msg, type) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (type ? ' ' + type : '');
    el.style.display = 'block';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.display = 'none'; }, 2500);
  }

  // ==================== 获取实时数据 ====================

  // 增强版 JSONP 请求（带超时和重试）
  function jsonpRequest(url, callbackParam, timeout) {
    timeout = timeout || 10000;
    return new Promise((resolve) => {
      const cbName = 'jsonp_cb_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
      const script = document.createElement('script');
      let resolved = false;
      
      function cleanup() {
        if (!resolved) {
          resolved = true;
          try { delete window[cbName]; } catch(e) { window[cbName] = undefined; }
          if (script.parentNode) document.head.removeChild(script);
        }
      }
      
      window[cbName] = function(data) {
        cleanup();
        resolve(data);
      };
      
      script.onerror = function() {
        cleanup();
        resolve(null);
      };
      
      script.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + (callbackParam || 'cb') + '=' + cbName;
      document.head.appendChild(script);
      
      setTimeout(function() {
        cleanup();
        resolve(null);
      }, timeout);
    });
  }

  // 带重试的 JSONP 请求（最多重试2次）
  async function jsonpRequestWithRetry(url, callbackParam, retries) {
    retries = retries || 2;
    for (let i = 0; i <= retries; i++) {
      const result = await jsonpRequest(url, callbackParam, 10000);
      if (result !== null && result !== undefined) {
        return result;
      }
      if (i < retries) {
        console.warn('[数据获取] JSONP重试 ' + (i + 1) + '/' + retries + ':', url.substring(0, 80));
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    return null;
  }

  // 构建股票数据对象（统一字段映射）
  function buildStockDataFromEastmoney(d) {
    if (!d || !d.f12) return null;
    const code = d.f12;
    const price = d.f2;
    if (!price || price === '-') return null;
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) return null;
    const close = d.f18 || 0;
    const closeNum = parseFloat(close) || 0;
    return {
      code: code,
      name: (d.f14 || code).replace(/\s+/g, ''),
      price: priceNum,
      open: parseFloat(d.f17) || 0,
      close: closeNum,
      high: parseFloat(d.f15) || 0,
      low: parseFloat(d.f16) || 0,
      volume: parseFloat(d.f5) || 0,
      amount: parseFloat(d.f6) || 0,
      change: closeNum > 0 ? ((priceNum - closeNum) / closeNum * 100) : 0,
      changeAmount: priceNum - closeNum,
      turnover: parseFloat(d.f8) || 0
    };
  }

  // 批量获取多只股票实时数据（纯 JSONP，重试机制）
  async function fetchBatchStockData(codes) {
    if (!codes || codes.length === 0) return {};
    const secids = codes.map(function(c) { return getSecid(c); }).join(',');
    const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get?secids=' + secids + '&fields=f12,f14,f2,f3,f4,f5,f6,f15,f16,f17,f18,f8';
    const result = {};

    // 使用 JSONP 请求（file:// 协议下 fetch 被阻止）
    const json = await jsonpRequestWithRetry(url, 'cb', 2);
    if (json && json.data && json.data.diff) {
      json.data.diff.forEach(function(d) {
        const stockData = buildStockDataFromEastmoney(d);
        if (stockData) {
          result[stockData.code] = stockData;
        }
      });
    }
    
    console.info('[数据获取] 批量请求完成: 请求' + codes.length + '只, 成功' + Object.keys(result).length + '只');
    return result;
  }

  // 单只股票实时数据（东方财富 JSONP + 重试机制）
  async function fetchStockData(code) {
    try {
      const secid = getSecid(code);
      const url = 'https://push2.eastmoney.com/api/qt/stock/get?secid=' + secid + '&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f169,f170';
      const json = await jsonpRequestWithRetry(url, 'cb', 2);
      if (json && json.data && json.data.f43) {
        const d = json.data;
        const price = d.f43 / 100;
        if (price > 0) {
          const close = (d.f60 || 0) / 100;
          return {
            code: d.f57 || code,
            name: (d.f58 || code).replace(/\s+/g, ''),
            price: price,
            open: d.f46 / 100,
            close: close,
            high: d.f44 / 100,
            low: d.f45 / 100,
            volume: d.f47 || 0,
            amount: d.f48 || 0,
            change: close > 0 ? ((price - close) / close * 100) : 0,
            changeAmount: price - close
          };
        }
      }
      console.warn('[数据获取] 单只股票数据无效:', code);
    } catch (e) {
      console.warn('[数据获取] 单只股票获取失败:', code, e);
    }
    return null;
  }

  // ==================== 渲染统计摘要 ====================
  function renderSummary(dataList) {
    const total = dataList.length;
    const upList = dataList.filter(d => d && d.change > 0);
    const downList = dataList.filter(d => d && d.change < 0);
    const flatList = dataList.filter(d => d && (!d.price || d.change === 0));
    // 仅统计有有效价格的股票计算平均涨跌幅
    const validList = dataList.filter(d => d && d.price > 0);
    const avgChange = validList.length > 0 ? validList.reduce((sum, d) => sum + d.change, 0) / validList.length : 0;
    
    document.getElementById('totalCount').textContent = total;
    document.getElementById('upCount').textContent = upList.length;
    document.getElementById('downCount').textContent = downList.length;
    document.getElementById('flatCount').textContent = flatList.length;
    
    const avgEl = document.getElementById('avgChange');
    if (validList.length === 0) {
      avgEl.textContent = '--';
      avgEl.className = 'summary-value';
    } else {
      avgEl.textContent = getChangeSign(avgChange) + formatNumber(avgChange) + '%';
      avgEl.className = 'summary-value ' + getChangeClass(avgChange);
    }
  }

  // ==================== 渲染表格 ====================
  async function renderTable() {
    const container = document.getElementById('tableContainer');
    
    if (!watchlist.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#128221;</div><h3>暂无自选股票</h3><p>在首页搜索股票并添加到自选，即可在此查看统计</p><a href="a-stock-dashboard.html" class="btn-primary">去添加股票</a></div>';
      document.getElementById('summaryGrid').style.display = 'none';
      return;
    }
    
    document.getElementById('summaryGrid').style.display = 'grid';
    
    // 第1步：批量获取（一次请求，速度快）
    const allCodes = watchlist.map(function(item) { return item.code; });
    const batchResult = await fetchBatchStockData(allCodes);
    
    // 找出批量未命中的股票
    const missingCodes = watchlist
      .filter(function(item) { return !batchResult[item.code]; })
      .map(function(item) { return item.code; });
    
    // 第2步：对未命中的股票，并行单只获取（JSONP，绕过CORS）
    if (missingCodes.length > 0) {
      const retryResults = await Promise.all(missingCodes.map(function(code) {
        return fetchStockData(code).then(function(d) { return { code: code, data: d }; });
      }));
      for (const r of retryResults) {
        if (r.data) batchResult[r.code] = r.data;
      }
    }
    
    // 按 watchlist 顺序构建 dataList
    const dataList = watchlist.map(function(item) {
      const data = batchResult[item.code];
      if (data) {
        stockDataCache[item.code] = data;
        // 更新名称
        if (data.name && data.name !== item.code && (item.name === item.code || !item.name)) {
          item.name = data.name;
          saveWatchlist(watchlist);
        }
        return data;
      }
      // 彻底失败，标记异常
      return {
        code: item.code,
        name: item.name || item.code,
        price: 0, open: 0, close: 0, high: 0, low: 0,
        volume: 0, amount: 0, change: 0, changeAmount: 0,
        abnormal: true
      };
    });
    
    renderSummary(dataList);
    
    let html = '<table><thead><tr>' +
      '<th>股票名称</th>' +
      '<th>代码</th>' +
      '<th>最新价</th>' +
      '<th>涨跌幅</th>' +
      '<th>涨跌额</th>' +
      '<th>最高</th>' +
      '<th>最低</th>' +
      '<th>成交量</th>' +
      '<th>状态</th>' +
      '<th>操作</th>' +
      '</tr></thead><tbody>';

    for (let i = 0; i < dataList.length; i++) {
      const d = dataList[i];
      const isAbnormal = d.abnormal || !d.price;
      const isUp = d.change > 0;
      const isDown = d.change < 0;
      const selectedClass = (currentSelectedStock && currentSelectedStock.code === d.code) ? ' selected' : '';

      if (isAbnormal) {
        html += '<tr class="row-clickable' + selectedClass + '" onclick="selectStockForNews(\'' + d.code + '\', \'' + d.name.replace(/'/g, "\\'") + '\')">' +
          '<td class="td-name">' + d.name + '</td>' +
          '<td class="td-code">' + d.code + '</td>' +
          '<td class="td-price">--</td>' +
          '<td class="td-change">--</td>' +
          '<td class="td-change">--</td>' +
          '<td class="td-price">--</td>' +
          '<td class="td-price">--</td>' +
          '<td class="td-volume">--</td>' +
          '<td><span class="status-badge status-flat">&#9888; 异常</span></td>' +
          '<td><button class="remove-btn" onclick="event.stopPropagation(); removeStock(\'' + d.code + '\')" title="删除">&#10005;</button></td>' +
        '</tr>';
      } else {
        html += '<tr class="row-clickable' + selectedClass + '" onclick="selectStockForNews(\'' + d.code + '\', \'' + d.name.replace(/'/g, "\\'") + '\')">' +
          '<td class="td-name">' + d.name + '</td>' +
          '<td class="td-code">' + d.code + '</td>' +
          '<td class="td-price ' + getChangeClass(d.change) + '">' + formatNumber(d.price) + '</td>' +
          '<td class="td-change ' + getChangeClass(d.change) + '">' + getChangeSign(d.change) + formatNumber(d.change) + '%</td>' +
          '<td class="td-change ' + getChangeClass(d.change) + '">' + getChangeSign(d.changeAmount) + formatNumber(d.changeAmount) + '</td>' +
          '<td class="td-price">' + formatNumber(d.high) + '</td>' +
          '<td class="td-price">' + formatNumber(d.low) + '</td>' +
          '<td class="td-volume">' + formatVolume(d.volume) + '</td>' +
          '<td><span class="status-badge ' + (isUp ? 'status-up' : (isDown ? 'status-down' : 'status-flat')) + '">' + (isUp ? '&#9650; 上涨' : (isDown ? '&#9660; 下跌' : '&#9644; 平盘')) + '</span></td>' +
          '<td><button class="remove-btn" onclick="event.stopPropagation(); removeStock(\'' + d.code + '\')" title="删除">&#10005;</button></td>' +
        '</tr>';
      }
    }

    html += '</tbody></table>';
    container.innerHTML = html;

    // 仅更新选中股票面板的副标题（不重建面板，避免走势图被销毁重建）
    if (currentSelectedStock && stockDetailCache[currentSelectedStock.code]) {
      var cached = stockDetailCache[currentSelectedStock.code];
      var panelSubtitle = document.querySelector('#stockNewsPanel .stock-news-subtitle');
      if (panelSubtitle) {
        var parts = [];
        if (cached.valuation) parts.push('估值:' + cached.valuation.badge);
        if (cached.analysis) parts.push('技术:' + cached.analysis.advice);
        panelSubtitle.textContent = parts.length ? parts.join(' | ') : '点击标签查看详情';
      }
    }
    
    // 更新时间
    const now = new Date();
    document.getElementById('lastUpdate').textContent = '最后更新：' + now.toLocaleString('zh-CN');
  }

  // ==================== 删除股票 ====================
  window.removeStock = function(code) {
    const item = watchlist.find(i => i.code === code);
    const displayName = (item && item.name) || code;
    if (!confirm('确定要从自选列表中删除 ' + displayName + ' 吗？')) return;
    watchlist = watchlist.filter(i => i.code !== code);
    saveWatchlist(watchlist);
    delete stockDataCache[code];
    renderTable();
    showToast('已从自选列表中删除', 'warning');
  };

  // ==================== 刷新全部 ====================
  window.refreshAll = async function() {
    const btn = document.getElementById('refreshBtn');
    btn.classList.add('spinning');
    btn.disabled = true;
    
    await renderTable();
    
    btn.classList.remove('spinning');
    btn.disabled = false;
  };

  // 导出自选股
  window.exportWatchlist = function() {
    const data = JSON.stringify(watchlist, null, 2);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(data).then(() => {
        showToast('✓ 自选股列表已复制到剪贴板');
      }).catch(() => {
        prompt('请复制以下自选股数据进行备份：', data);
      });
    } else {
      prompt('请复制以下自选股数据进行备份：', data);
    }
  };

  // 导入自选股
  window.importWatchlist = function() {
    const input = prompt('请粘贴自选股备份数据：');
    if (!input) return;
    try {
      const data = JSON.parse(input);
      if (!Array.isArray(data)) throw new Error('格式错误');
      
      const current = loadWatchlist();
      let added = 0;
      for (const item of data) {
        if (item && item.code && /^\d{6}$/.test(item.code)) {
          if (!current.some(i => i.code === item.code)) {
            current.push({ code: item.code, name: item.name || item.code });
            added++;
          }
        } else if (typeof item === 'string' && /^\d{6}$/.test(item)) {
          if (!current.some(i => i.code === item)) {
            current.push({ code: item, name: item });
            added++;
          }
        }
      }
      watchlist = current;
      saveWatchlist(watchlist);
      renderTable();
      showToast('✓ 导入成功，新增 ' + added + ' 只股票');
    } catch(e) {
      showToast('导入失败：数据格式不正确', 'error');
    }
  };

  // 导出为文件（下载JSON文件到本地）
  window.exportWatchlistFile = function() {
    if (!watchlist.length) {
      showToast('自选股列表为空，无需导出', 'warning');
      return;
    }
    const data = JSON.stringify(watchlist, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = '自选股备份_' + date + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('✓ 自选股备份文件已下载');
  };

  // 从文件导入
  window.importWatchlistFile = function() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = function(e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(event) {
        try {
          const data = JSON.parse(event.target.result);
          if (!Array.isArray(data)) throw new Error('格式错误');
          
          const current = loadWatchlist();
          let added = 0;
          for (const item of data) {
            if (item && item.code && /^\d{6}$/.test(item.code)) {
              if (!current.some(i => i.code === item.code)) {
                current.push({ code: item.code, name: item.name || item.code });
                added++;
              }
            } else if (typeof item === 'string' && /^\d{6}$/.test(item)) {
              if (!current.some(i => i.code === item)) {
                current.push({ code: item, name: item });
                added++;
              }
            }
          }
          watchlist = current;
          saveWatchlist(watchlist);
          renderTable();
          showToast('✓ 导入成功，新增 ' + added + ' 只股票');
        } catch(err) {
          showToast('导入失败：文件格式不正确', 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // 从本地数据文件加载自选股
  async function loadWatchlistFromFile() {
    try {
      const response = await fetch(DATA_FILE, { cache: 'no-store' });
      if (!response.ok) return null;
      const data = await response.json();
      if (!Array.isArray(data)) return null;
      const result = [];
      for (const item of data) {
        if (item && typeof item === 'object' && item.code && /^\d{6}$/.test(item.code)) {
          const cleanName = (item.name || item.code).replace(/\s+/g, '');
          result.push({ code: item.code, name: cleanName });
        } else if (typeof item === 'string' && /^\d{6}$/.test(item)) {
          result.push({ code: item, name: item });
        }
      }
      return result;
    } catch (e) {
      console.warn('[自选页面] 本地数据文件加载失败:', e);
      return null;
    }
  }

  // 初始化自选股数据（优先localStorage，其次本地文件）
  async function initWatchlistData() {
    const localData = loadWatchlist();
    if (localData && localData.length > 0) {
      watchlist = localData;
      return;
    }
    const fileData = await loadWatchlistFromFile();
    if (fileData && fileData.length > 0) {
      watchlist = fileData;
      saveWatchlist(fileData);
    } else {
      watchlist = [];
    }
  }

  // 保存为数据文件
  window.saveToDataFile = function() {
    if (!watchlist.length) {
      showToast('自选股列表为空，无需保存', 'warning');
      return;
    }
    const data = JSON.stringify(watchlist, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'watchlist.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('✓ 数据文件已下载，请放到项目 data/ 目录下', 'success', 4000);
  };

  // 备份为种子文件（下载 watchlist-seed.js，替换项目 data/watchlist-seed.js 即可永久保存）
  window.backupSeedFile = function() {
    if (!watchlist.length) {
      showToast('自选股列表为空，无需备份', 'warning');
      return;
    }
    var content = '// 自选股持久化数据 - 通过 <script> 标签加载，兼容 file:// 协议\n';
    content += '// 修改此文件即可永久更新自选股列表\n';
    content += '// 备份时间：' + new Date().toLocaleString('zh-CN') + '\n';
    content += 'window.__STOCK_WATCHLIST_SEED__ = ';
    content += JSON.stringify(watchlist, null, 2).replace(/\n/g, '\n  ');
    content += ';\n';
    var blob = new Blob([content], { type: 'application/javascript' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'watchlist-seed.js';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('✓ 种子文件已下载，请替换项目 data/watchlist-seed.js 以永久保存', 'success', 5000);
  };

  // ==================== 个股新闻面板 ====================

  // JSONP 请求东方财富搜索 API（支持多种搜索类型）
  function fetchSearchNews(keyword, pageSize, searchTypes) {
    return new Promise((resolve) => {
      var cbName = 'em_search_cb_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
      var types = searchTypes || ['cmsArticleWeb'];
      var param = JSON.stringify({
        uid: '',
        keyword: keyword,
        type: types,
        pageIndex: 1,
        pageSize: pageSize || 10
      });
      const url = 'https://search-api-web.eastmoney.com/search/jsonp?cb=' + cbName + '&param=' + encodeURIComponent(param);
      const script = document.createElement('script');
      let resolved = false;
      function done(data) {
        if (resolved) return;
        resolved = true;
        if (script.parentNode) document.head.removeChild(script);
        delete window[cbName];
        resolve(data || []);
      }
      window[cbName] = function(data) {
        if (data && data.result) {
          // 合并多种搜索类型的结果
          var all = [];
          for (var key in data.result) {
            if (Array.isArray(data.result[key])) {
              all = all.concat(data.result[key]);
            }
          }
          done(all);
        } else {
          done([]);
        }
      };
      script.src = url;
      script.onerror = function() { done([]); };
      document.head.appendChild(script);
      setTimeout(function() { done([]); }, 8000);
    });
  }

  // 去除 HTML 标签（如 <em>）
  function stripHtml(str) {
    if (!str) return '';
    return String(str).replace(/<[^>]+>/g, '');
  }

  // HTML属性转义：防止URL中的特殊字符破坏标签
  function escapeHtmlAttr(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\s+/g, ' ');
  }

  // 修复新闻URL：补全协议、去除非法字符、确保file://协议下也能正常打开
  function fixNewsUrl(url) {
    if (!url || typeof url !== 'string') return '';
    url = url.trim();
    if (!url) return '';
    // 拦截无效链接
    if (url === '#' || url === 'javascript:void(0)' || /^javascript:/i.test(url)) return '';
    // 协议相对URL: //xxx → https://xxx（这是导致file://协议下失效的主要原因！）
    if (url.indexOf('//') === 0) url = 'https:' + url;
    // 相对路径: /xxx → 补全东方财富域名
    else if (url.charAt(0) === '/') url = 'https://finance.eastmoney.com' + url;
    // 缺少协议: www.xxx 或 xxx.com → 补https://
    else if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    // 去除可能的非法字符（换行、制表符等）
    url = url.replace(/[\r\n\t]/g, '');
    return url;
  }

  // 格式化时间为相对时间
  function formatRelativeTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr.replace(/-/g, '/'));
    if (isNaN(d.getTime())) return dateStr;
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + '天前';
    if (diff < 86400 * 30) return Math.floor(diff / (86400 * 7)) + '周前';
    return d.toLocaleDateString('zh-CN');
  }

  // 获取新闻（基于东方财富搜索 API，多种搜索类型并行）
  async function fetchStockNews(code, name) {
    try {
      // 搜索类型：cmsArticleWeb(财经新闻)
      var searchTypes = ['cmsArticleWeb'];

      // 用代码和名称并行搜索，合并去重
      var codeResults = await fetchSearchNews(code, 15, searchTypes);
      var nameResults = name && name !== code ? await fetchSearchNews(name, 15, searchTypes) : [];
      var merged = codeResults.concat(nameResults);

      // 去重（按 code 字段）
      var seen = {};
      var deduped = [];
      for (var i = 0; i < merged.length; i++) {
        var item = merged[i];
        var key = item.code || item.title;
        if (seen[key]) continue;
        seen[key] = true;
        deduped.push(item);
      }

      // 按日期倒序排序
      deduped.sort(function(a, b) {
        var da = new Date((a.date || '').replace(/-/g, '/'));
        var db = new Date((b.date || '').replace(/-/g, '/'));
        return db - da;
      });

      // 过滤重复的成交额播报类新闻：同一交易日内同类型标题只保留最新一条
      // 识别模式：包含"成交额超/成交超" + 金额
      var turnoverPattern = /成交额?(?:额)?(?:超|达|突破)[\d.]+亿元?/;
      var seenTurnoverDay = {};  // 按日期追踪成交额类新闻
      var filtered = [];
      for (var fi = 0; fi < deduped.length; fi++) {
        var item = deduped[fi];
        var title = stripHtml(item.title);
        var content = stripHtml(item.content || '');
        var isTurnover = turnoverPattern.test(title) || turnoverPattern.test(content.substring(0, 100));
        if (isTurnover) {
          // 提取日期部分（YYYY-MM-DD）
          var dayKey = (item.date || '').substring(0, 10);
          if (seenTurnoverDay[dayKey]) {
            continue;  // 同一天已有成交额新闻，跳过
          }
          seenTurnoverDay[dayKey] = true;
        }
        filtered.push(item);
      }

      // 取前 12 条，保留完整内容
      return filtered.slice(0, 12).map(function(item) {
        var content = stripHtml(item.content || '');
        // 截取正文前200字作为摘要
        if (content.length > 200) content = content.substring(0, 200) + '...';
        return {
          time: formatRelativeTime(item.date),
          date: item.date || '',
          title: stripHtml(item.title),
          content: content,
          source: item.mediaName || '东方财富',
          url: item.url || item.displayUrl || item.articleUrl || '',
          important: false
        };
      });
    } catch (e) {
      console.warn('[自选页面] 个股新闻获取失败:', e);
      return [];
    }
  }

  // 获取机构评级/目标价（用"股票名 评级"搜索获取研报新闻）
  async function fetchInstitutionForecasts(code, name) {
    try {
      // 用"股票名 评级"和"股票名 买入"作为关键词搜索，获取机构评级类新闻
      var ratingKw = (name || code) + ' 评级';
      var buyKw = (name || code) + ' 买入';
      var ratingResults = await fetchSearchNews(ratingKw, 20, ['cmsArticleWeb']);
      var buyResults = await fetchSearchNews(buyKw, 20, ['cmsArticleWeb']);
      var results = ratingResults.concat(buyResults);

      // 去重
      var seen = {};
      var deduped = [];
      for (var i = 0; i < results.length; i++) {
        if (seen[results[i].code]) continue;
        seen[results[i].code] = true;
        deduped.push(results[i]);
      }

      var ratingKeywords = ['买入', '增持', '强烈推荐', '中性', '减持', '卖出', '跑赢行业', '推荐', '强推'];
      // 排除误匹配：这些词组中的评级关键词不是机构评级
      var excludePatterns = [/净买入/, /买入型/, /买入型评级/, /评级买入/, /买入股/, /买入的/, /买入后/, /可买入/, /已买入/, /将买入/, /买入级/];
      var targetPricePattern = /目标价[^\d]*([\d.]+)\s*元/;

      // 判断是否为真实机构评级新闻的模式：机构名 + 给予/维持/发布研报 + 评级词
      var ratingPatterns = [
        /(?:给予|维持|上调|下调|发布|发布研报|研报称).{0,20}(买入|增持|强烈推荐|中性|减持|卖出|跑赢行业|推荐|强推)/,
        /(买入|增持|强烈推荐|中性|减持|卖出|跑赢行业|推荐|强推)(?:评级|指数|指数评级)/,
        /(?:评级|指数).{0,10}(买入|增持|强烈推荐|中性|减持|卖出|跑赢行业|推荐|强推)/
      ];

      var forecasts = [];
      for (var i = 0; i < deduped.length; i++) {
        var item = deduped[i];
        var text = stripHtml(item.title) + ' ' + stripHtml(item.content);

        // 先排除误匹配
        var excluded = false;
        for (var ex = 0; ex < excludePatterns.length; ex++) {
          if (excludePatterns[ex].test(text)) { excluded = true; break; }
        }
        if (excluded) continue;

        // 必须匹配机构评级的语法模式
        var matchedPattern = false;
        for (var rp = 0; rp < ratingPatterns.length; rp++) {
          if (ratingPatterns[rp].test(text)) { matchedPattern = true; break; }
        }
        if (!matchedPattern) continue;

        var priceMatch = text.match(targetPricePattern);
        var targetPrice = priceMatch ? parseFloat(priceMatch[1]) : null;

        // 提取评级：匹配评级关键词但排除"净买入"等
        var rating = '';
        for (var k = 0; k < ratingKeywords.length; k++) {
          var kw = ratingKeywords[k];
          // 检查关键词是否在上下文中作为评级出现
          var kwIdx = text.indexOf(kw);
          if (kwIdx >= 0) {
            // 检查前面的排除词
            var before = text.substring(Math.max(0, kwIdx - 4), kwIdx);
            if (!/净|型|的|后|级/.test(before)) {
              rating = kw;
              break;
            }
          }
        }
        if (!rating) rating = '未评级';

        var institution = '机构';
        var orgMatch = text.match(/([\u4e00-\u9fa5A-Z]{2,15}(?:证券|银行|资管|信托|基金))/);
        if (orgMatch) institution = orgMatch[1];

        // 提取研报日期
        var rDate = (item.date || '').slice(0, 10);

        // 日期有效性校验与12个月过滤
        if (!rDate || !/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(rDate)) continue;
        var reportDate = new Date(rDate.replace(/-/g, '/'));
        if (isNaN(reportDate.getTime())) continue;
        var now = new Date();
        var diffMonths = (now.getFullYear() - reportDate.getFullYear()) * 12 + (now.getMonth() - reportDate.getMonth());
        if (diffMonths > 12) continue;

        // 提取简短标题
        var rTitle = stripHtml(item.title);
        // 如果包含"研报称"，提取更精准的标题
        var reportMatch = text.match(/发布研报称[：:]\s*([^，,。\s]{5,40})/);
        if (reportMatch) rTitle = reportMatch[1];
        else rTitle = rTitle.substring(0, 50);

        forecasts.push({
          date: rDate,
          _ts: reportDate.getTime(),
          institution: institution,
          analyst: '',
          title: rTitle,
          rating: rating,
          targetPrice: targetPrice,
          industry: ''
        });
      }

      // 按日期降序排序，保证最新的在前
      forecasts.sort(function(a, b) { return b._ts - a._ts; });
      // 仅保留前10条
      return forecasts.slice(0, 10);
    } catch (e) {
      console.warn('[自选页面] 机构预测获取失败:', e);
      return [];
    }
  }

  // 获取AI估值判断（基于真实PE/PB等数据）
  async function fetchAIValuation(code) {
    try {
      const secid = getSecid(code);
      const url = 'https://push2.eastmoney.com/api/qt/stock/get?secid=' + secid + '&fields=f43,f44,f45,f46,f60,f162,f163,f164,f165,f167,f168,f169,f170';
      const json = await jsonpRequestWithRetry(url, 'cb', 2);
      if (!json || !json.data) return null;
      const d = json.data;

      const price = d.f43 / 100;
      const high52 = d.f44 / 100; // 今日最高
      const low52 = d.f45 / 100;  // 今日最低
      const pe = d.f162 / 100;    // 市盈率(动)
      const pb = d.f163 / 100;    // 市净率
      const eps = d.f164 / 100;   // 每股收益
      const bvps = d.f165 / 100;  // 每股净资产
      const totalCap = d.f167;    // 总市值
      const circCap = d.f168;     // 流通市值
      const change = d.f170 / 100; // 涨跌幅

      // AI 估值判断：基于市盈率、市净率分档
      let level = 'fair';
      let text = '';
      let badge = '';

      if (!pe || pe <= 0) {
        level = 'fair';
        badge = '亏损/数据不全';
        text = '当前市盈率为负或数据缺失（公司可能处于亏损状态），无法基于 PE 进行高估/低估判断。';
      } else if (pe < 0 || pe > 200) {
        level = 'fair';
        badge = 'PE异常';
        text = '当前市盈率 ' + pe.toFixed(2) + '，超出常规估值范围（>200），建议结合其他指标综合判断。';
      } else if (pe < 15) {
        level = 'undervalued';
        badge = '可能低估';
        text = '当前市盈率仅 ' + pe.toFixed(2) + '（A股市场中位数约30-40），处于历史低位。PB=' + (pb ? pb.toFixed(2) : '--') + '。';
        if (pb && pb < 1.5) text += 'PB 也较低，可能存在估值修复机会，但需注意低 PE 可能是行业景气度下行所致，建议结合业绩拐点判断。';
      } else if (pe < 30) {
        level = 'undervalued';
        badge = '估值合理偏低';
        text = '当前市盈率 ' + pe.toFixed(2) + '，低于市场平均水平。PB=' + (pb ? pb.toFixed(2) : '--') + '。';
        text += '估值处于合理偏低区间，业绩成长性可关注。';
      } else if (pe < 60) {
        level = 'fair';
        badge = '估值合理';
        text = '当前市盈率 ' + pe.toFixed(2) + '，处于市场平均水平。PB=' + (pb ? pb.toFixed(2) : '--') + '。';
        text += '估值相对合理，需结合业绩增速判断是否值得持有。';
      } else {
        level = 'overvalued';
        badge = '可能高估';
        text = '当前市盈率 ' + pe.toFixed(2) + '，明显高于市场平均。PB=' + (pb ? pb.toFixed(2) : '--') + '。';
        if (pb && pb > 5) text += 'PB 也偏高，估值已较为充分，需警惕业绩不及预期带来的回调风险。';
      }

      return {
        level: level,
        badge: badge,
        text: text,
        metrics: {
          pe: pe || null,
          pb: pb || null,
          eps: eps || null,
          bvps: bvps || null,
          totalCap: totalCap || null,
          circCap: circCap || null,
          high52: high52 || null,
          low52: low52 || null,
          price: price || null
        }
      };
    } catch (e) {
      console.warn('[自选页面] AI估值获取失败:', e);
      return null;
    }
  }

  // ==================== 走势图 ====================

  // 获取走势数据
  // period: 'minute' | '5day' | 'week' | 'month' | 'year'
  async function fetchTrendData(code, period) {
    try {
      var secid = getSecid(code);
      if (period === 'minute') {
        var url = 'https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=' + secid + '&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58';
        var json = await jsonpRequestWithRetry(url, 'cb', 2);
        if (!json || !json.data || !json.data.trends) return null;
        return {
          type: 'minute',
          preClose: json.data.preClose || 0,
          data: json.data.trends.map(function(line) {
            var p = line.split(',');
            return { time: p[0], price: parseFloat(p[2]), avgPrice: parseFloat(p[7]) };
          })
        };
      } else {
        var klt, lmt;
        if (period === '5day') { klt = 101; lmt = 5; }
        else if (period === 'week') { klt = 102; lmt = 26; }
        else if (period === 'month') { klt = 103; lmt = 24; }
        else if (period === 'year') { klt = 103; lmt = 120; }
        else return null;

        var url2 = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + secid + '&klt=' + klt + '&fqt=1&lmt=' + lmt + '&beg=0&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61';
        var json2 = await jsonpRequestWithRetry(url2, 'cb', 2);
        if (!json2 || !json2.data || !json2.data.klines) return null;
        var allKlines = json2.data.klines;
        // beg/end 参数会使API返回全量数据，截取最后 lmt 条
        if (allKlines.length > lmt) allKlines = allKlines.slice(-lmt);
        return {
          type: 'kline',
          period: period,
          data: allKlines.map(function(line) {
            var p = line.split(',');
            return { date: p[0], open: parseFloat(p[1]), close: parseFloat(p[2]), high: parseFloat(p[3]), low: parseFloat(p[4]), volume: parseFloat(p[5]) };
          })
        };
      }
    } catch (e) {
      console.warn('[自选页面] 走势数据获取失败:', e);
      return null;
    }
  }

  // 渲染走势图
  function renderTrendChart(containerId, trendData, stockName) {
    var container = document.getElementById(containerId);
    if (!container) return;

    // 复用已有实例；若实例DOM不匹配则重建（切换股票/周期后container已更换）
    if (trendChartInstance && !trendChartInstance.isDisposed() && trendChartInstance.getDom() === container) {
      // 复用，仅更新数据
    } else {
      if (trendChartInstance && !trendChartInstance.isDisposed()) trendChartInstance.dispose();
      trendChartInstance = echarts.init(container);
    }

    if (trendData.type === 'minute') {
      // 使用固定时间轴（完整交易时段），数据按时间映射，缺失填null
      var fixedTimes = generateTradingDayTimes();
      var dataMap = {};
      trendData.data.forEach(function(d) {
        var t = (d.time.split(' ')[1] || d.time).substring(0, 5);
        dataMap[t] = d;
      });
      var prices = fixedTimes.map(function(t) { return dataMap[t] ? dataMap[t].price : null; });
      var avgPrices = fixedTimes.map(function(t) { return dataMap[t] ? dataMap[t].avgPrice : null; });
      var preClose = trendData.preClose;

      trendChartInstance.setOption({
        title: { text: stockName + ' 分时走势', left: 'center', textStyle: { fontSize: 12, color: 'var(--ink)' } },
        tooltip: { trigger: 'axis', formatter: function(params) { return params[0].name + '<br/>' + params.map(function(p) { return p.seriesName + ': ' + (p.value == null ? '--' : p.value); }).join('<br/>'); } },
        grid: { left: 50, right: 15, top: 30, bottom: 25 },
        xAxis: { type: 'category', data: fixedTimes, axisLabel: { fontSize: 9, interval: Math.floor(fixedTimes.length / 5) } },
        yAxis: { type: 'value', scale: true, axisLabel: { fontSize: 9, formatter: function(v) { return v.toFixed(2); } }, splitLine: { lineStyle: { type: 'dashed', color: 'rgba(100,116,139,0.2)' } } },
        series: [
          { name: '价格', type: 'line', data: prices, showSymbol: false, connectNulls: false, lineStyle: { width: 1.5, color: '#10b981' }, areaStyle: { color: 'rgba(16,185,129,0.08)' } },
          { name: '均价', type: 'line', data: avgPrices, showSymbol: false, connectNulls: false, lineStyle: { width: 1, color: '#f59e0b', type: 'dashed' } },
          { name: '昨收', type: 'line', data: fixedTimes.map(function() { return preClose; }), showSymbol: false, lineStyle: { width: 0.8, color: 'rgba(100,116,139,0.4)', type: 'dotted' } }
        ]
      }, true);
    } else {
      var dates = trendData.data.map(function(d) { return d.date; });
      var closes = trendData.data.map(function(d) { return d.close; });
      var volumes = trendData.data.map(function(d) { return d.volume; });
      var periodLabels = { '5day': '五日', 'week': '周', 'month': '月', 'year': '年' };
      var label = periodLabels[trendData.period] || '';

      // 年走势按年聚合
      if (trendData.period === 'year' && dates.length > 12) {
        var yearMap = {};
        var yearOrder = [];
        trendData.data.forEach(function(d) {
          var y = d.date.split('-')[0];
          if (!yearMap[y]) { yearMap[y] = { close: d.close, volume: 0, high: d.high, low: d.low }; yearOrder.push(y); }
          yearMap[y].close = d.close;
          yearMap[y].volume += d.volume;
          yearMap[y].high = Math.max(yearMap[y].high, d.high);
          yearMap[y].low = Math.min(yearMap[y].low, d.low);
        });
        dates = yearOrder;
        closes = yearOrder.map(function(y) { return yearMap[y].close; });
        volumes = yearOrder.map(function(y) { return yearMap[y].volume; });
      }

      trendChartInstance.setOption({
        title: { text: stockName + ' ' + label + '走势', left: 'center', textStyle: { fontSize: 12, color: 'var(--ink)' } },
        tooltip: { trigger: 'axis' },
        legend: { data: ['收盘价', '成交量'], bottom: 0, textStyle: { fontSize: 10 } },
        grid: { left: 50, right: 40, top: 30, bottom: 35 },
        xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 9, rotate: dates.length > 10 ? 30 : 0, interval: Math.max(0, Math.floor(dates.length / 6) - 1) } },
        yAxis: [
          { type: 'value', scale: true, axisLabel: { fontSize: 9, formatter: function(v) { return v.toFixed(2); } }, splitLine: { lineStyle: { type: 'dashed', color: 'rgba(100,116,139,0.2)' } } },
          { type: 'value', scale: true, axisLabel: { fontSize: 9, formatter: function(v) { if (v >= 1e8) return (v / 1e8).toFixed(1) + '亿'; if (v >= 1e4) return (v / 1e4).toFixed(0) + '万'; return v; } }, splitLine: { show: false } }
        ],
        series: [
          { name: '收盘价', type: 'line', data: closes, showSymbol: dates.length <= 10, symbolSize: 5, lineStyle: { width: 1.5, color: '#3b82f6' }, areaStyle: { color: 'rgba(59,130,246,0.08)' } },
          { name: '成交量', type: 'bar', data: volumes, yAxisIndex: 1, itemStyle: { color: 'rgba(100,116,139,0.3)' } }
        ]
      }, true);
    }
  }

  // 走势子标签切换
  window.switchTrendTab = async function(period, stockCode, stockName) {
    // 记录当前走势周期，用于定时刷新
    currentTrendPeriod = { period: period, code: stockCode, name: stockName };
    // 重启刷新定时器
    startTrendRefreshTimer();

    document.querySelectorAll('.trend-sub-tab').forEach(function(t) { t.classList.remove('active'); });
    var btn = document.getElementById('trendSub_' + period);
    if (btn) btn.classList.add('active');

    // 切换周期/股票时销毁旧实例，重新创建
    if (trendChartInstance && !trendChartInstance.isDisposed()) {
      trendChartInstance.dispose();
      trendChartInstance = null;
    }

    var container = document.getElementById('trendChartContainer');
    if (!container) return;
    container.innerHTML = '<div class="stock-news-loading">⏳ 加载' + ({minute:'分时', '5day':'五日', week:'周', month:'月', year:'年'}[period] || '') + '走势数据...</div>';

    var data = await fetchTrendData(stockCode, period);
    if (!data || (data.data && data.data.length === 0)) {
      container.innerHTML = '<div class="stock-news-empty"><div style="font-size:1.8rem;">📉</div><div>暂无走势数据</div><div style="font-size:0.75rem;margin-top:0.4rem;color:var(--muted);">非交易时间或数据不足</div></div>';
      return;
    }
    container.innerHTML = '<div id="trendChart" style="width:100%;height:260px;"></div>';
    renderTrendChart('trendChart', data, stockName);
  };

  // 启动走势刷新定时器：交易时间每30秒刷新，非交易时间不刷新
  function startTrendRefreshTimer() {
    if (trendRefreshTimer) {
      clearInterval(trendRefreshTimer);
      trendRefreshTimer = null;
    }
    // 交易时间每30秒刷新实时走势，非交易时间不刷新
    trendRefreshTimer = setInterval(async function() {
      if (!currentTrendPeriod) return;
      // 仅交易时间且当前为"实时"走势时才刷新
      if (!isTradingTime()) return;
      if (currentTrendPeriod.period !== 'minute') return;

      // 复用已有实例，不重建DOM，只更新曲线数据
      if (!trendChartInstance || trendChartInstance.isDisposed()) return;

      var data = await fetchTrendData(currentTrendPeriod.code, currentTrendPeriod.period);
      if (!data || (data.data && data.data.length === 0)) return;
      renderTrendChart('trendChart', data, currentTrendPeriod.name);
    }, 30000); // 30秒刷新
  }

  // ==================== AI技术分析 ====================

  // EMA 计算
  function calcEMA(data, period) {
    if (data.length === 0) return 0;
    var k = 2 / (period + 1);
    var ema = data[0];
    for (var i = 1; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  }

  // RSI 计算
  function calcRSI(closes, period) {
    if (closes.length < period + 1) return 50;
    var gains = 0, losses = 0;
    for (var i = closes.length - period; i < closes.length; i++) {
      var diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    var avgGain = gains / period;
    var avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    var rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  // KDJ 计算（简化版）
  function calcKDJ(highs, lows, closes, period) {
    var n = closes.length;
    if (n < period) return { k: 50, d: 50, j: 50 };
    var recentHigh = Math.max.apply(null, highs.slice(-period));
    var recentLow = Math.min.apply(null, lows.slice(-period));
    var rsv = recentHigh === recentLow ? 50 : (closes[n - 1] - recentLow) / (recentHigh - recentLow) * 100;
    var prevK = 50, prevD = 50;
    if (n > period) {
      var prevHigh = Math.max.apply(null, highs.slice(-period - 1, -1));
      var prevLow = Math.min.apply(null, lows.slice(-period - 1, -1));
      var prevRsv = prevHigh === prevLow ? 50 : (closes[n - 2] - prevLow) / (prevHigh - prevLow) * 100;
      prevK = 2 / 3 * 50 + 1 / 3 * prevRsv;
      prevD = 2 / 3 * 50 + 1 / 3 * prevK;
    }
    var k = 2 / 3 * prevK + 1 / 3 * rsv;
    var d = 2 / 3 * prevD + 1 / 3 * k;
    var j = 3 * k - 2 * d;
    return { k: k, d: d, j: j };
  }

  // MACD 计算（简化）
  function calcMACD(closes) {
    if (closes.length < 30) return { dif: 0, dea: 0, macd: 0 };
    var ema12 = calcEMA(closes.slice(-30), 12);
    var ema26 = calcEMA(closes.slice(-30), 26);
    var dif = ema12 - ema26;
    // DEA 近似为 DIF 的 EMA(9)，简化用前9日DIF均值
    var difs = [];
    for (var i = 9; i >= 0; i--) {
      var e12 = calcEMA(closes.slice(-30 - i, closes.length - i), 12);
      var e26 = calcEMA(closes.slice(-30 - i, closes.length - i), 26);
      difs.push(e12 - e26);
    }
    var dea = difs.reduce(function(a, b) { return a + b; }, 0) / difs.length;
    var macd = (dif - dea) * 2;
    return { dif: dif, dea: dea, macd: macd, prevDif: difs[1] || 0, prevDea: dea };
  }

  // AI 技术分析
  async function fetchAIAnalysis(code) {
    try {
      var secid = getSecid(code);
      var url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + secid + '&klt=101&fqt=1&lmt=120&beg=0&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61';
      var json = await jsonpRequestWithRetry(url, 'cb', 2);
      if (!json || !json.data || !json.data.klines || json.data.klines.length < 20) return null;

      var allKlines = json.data.klines;
      // 截取最近120个交易日
      if (allKlines.length > 120) allKlines = allKlines.slice(-120);
      var klines = allKlines.map(function(line) {
        var p = line.split(',');
        return { date: p[0], open: parseFloat(p[1]), close: parseFloat(p[2]), high: parseFloat(p[3]), low: parseFloat(p[4]), volume: parseFloat(p[5]) };
      });

      var closes = klines.map(function(k) { return k.close; });
      var highs = klines.map(function(k) { return k.high; });
      var lows = klines.map(function(k) { return k.low; });
      var volumes = klines.map(function(k) { return k.volume; });
      var n = closes.length;
      var lastClose = closes[n - 1];

      // 均线
      var ma5 = closes.slice(-5).reduce(function(a, b) { return a + b; }, 0) / 5;
      var ma10 = closes.slice(-10).reduce(function(a, b) { return a + b; }, 0) / 10;
      var ma20 = closes.slice(-20).reduce(function(a, b) { return a + b; }, 0) / 20;
      var ma60 = n >= 60 ? closes.slice(-60).reduce(function(a, b) { return a + b; }, 0) / 60 : null;

      // 技术指标
      var rsi = calcRSI(closes, 14);
      var kdj = calcKDJ(highs, lows, closes, 9);
      var macd = calcMACD(closes);

      var score = 0;
      var signals = [];

      // 1. 均线系统
      if (ma5 > ma10 && ma10 > ma20) { score += 2; signals.push({ name: '均线系统', signal: '多头排列', detail: 'MA5=' + ma5.toFixed(2) + ' > MA10=' + ma10.toFixed(2) + ' > MA20=' + ma20.toFixed(2), positive: true }); }
      else if (ma5 < ma10 && ma10 < ma20) { score -= 2; signals.push({ name: '均线系统', signal: '空头排列', detail: 'MA5=' + ma5.toFixed(2) + ' < MA10=' + ma10.toFixed(2) + ' < MA20=' + ma20.toFixed(2), positive: false }); }
      else { signals.push({ name: '均线系统', signal: '交织整理', detail: 'MA5/MA10/MA20 交织，趋势不明', positive: null }); }

      // 2. MA金叉/死叉
      if (n >= 11) {
        var prevMa5 = closes.slice(-6, -1).reduce(function(a, b) { return a + b; }, 0) / 5;
        var prevMa10 = closes.slice(-11, -1).reduce(function(a, b) { return a + b; }, 0) / 10;
        if (prevMa5 <= prevMa10 && ma5 > ma10) { score += 2; signals.push({ name: 'MA交叉', signal: '金叉', detail: 'MA5 上穿 MA10，短期买入信号', positive: true }); }
        else if (prevMa5 >= prevMa10 && ma5 < ma10) { score -= 2; signals.push({ name: 'MA交叉', signal: '死叉', detail: 'MA5 下穿 MA10，短期卖出信号', positive: false }); }
      }

      // 3. MACD
      if (macd.dif > macd.dea && macd.macd > 0) { score += 1; signals.push({ name: 'MACD', signal: '多头', detail: 'DIF=' + macd.dif.toFixed(3) + ' > DEA=' + macd.dea.toFixed(3) + '，柱状正值', positive: true }); }
      else if (macd.dif < macd.dea && macd.macd < 0) { score -= 1; signals.push({ name: 'MACD', signal: '空头', detail: 'DIF=' + macd.dif.toFixed(3) + ' < DEA=' + macd.dea.toFixed(3) + '，柱状负值', positive: false }); }
      else { signals.push({ name: 'MACD', signal: '中性', detail: 'DIF=' + macd.dif.toFixed(3) + ' DEA=' + macd.dea.toFixed(3), positive: null }); }

      // MACD金叉
      if (macd.prevDif <= macd.prevDea && macd.dif > macd.dea) { score += 1; signals.push({ name: 'MACD交叉', signal: '金叉', detail: 'DIF 上穿 DEA', positive: true }); }
      else if (macd.prevDif >= macd.prevDea && macd.dif < macd.dea) { score -= 1; signals.push({ name: 'MACD交叉', signal: '死叉', detail: 'DIF 下穿 DEA', positive: false }); }

      // 4. RSI
      if (rsi > 70) { score -= 1; signals.push({ name: 'RSI(14)', signal: '超买', detail: 'RSI=' + rsi.toFixed(1) + '，短期可能回调', positive: false }); }
      else if (rsi < 30) { score += 1; signals.push({ name: 'RSI(14)', signal: '超卖', detail: 'RSI=' + rsi.toFixed(1) + '，短期可能反弹', positive: true }); }
      else { signals.push({ name: 'RSI(14)', signal: '中性', detail: 'RSI=' + rsi.toFixed(1), positive: null }); }

      // 5. KDJ
      if (kdj.j > kdj.k && kdj.k > kdj.d && kdj.k < 80) { score += 1; signals.push({ name: 'KDJ', signal: '金叉向上', detail: 'K=' + kdj.k.toFixed(1) + ' D=' + kdj.d.toFixed(1) + ' J=' + kdj.j.toFixed(1), positive: true }); }
      else if (kdj.j < kdj.k && kdj.k < kdj.d && kdj.k > 20) { score -= 1; signals.push({ name: 'KDJ', signal: '死叉向下', detail: 'K=' + kdj.k.toFixed(1) + ' D=' + kdj.d.toFixed(1) + ' J=' + kdj.j.toFixed(1), positive: false }); }
      else if (kdj.j > 100) { score -= 1; signals.push({ name: 'KDJ', signal: '超买', detail: 'J=' + kdj.j.toFixed(1) + '，超买区', positive: false }); }
      else if (kdj.j < 0) { score += 1; signals.push({ name: 'KDJ', signal: '超卖', detail: 'J=' + kdj.j.toFixed(1) + '，超卖区', positive: true }); }
      else { signals.push({ name: 'KDJ', signal: '中性', detail: 'K=' + kdj.k.toFixed(1) + ' D=' + kdj.d.toFixed(1) + ' J=' + kdj.j.toFixed(1), positive: null }); }

      // 6. 价格位置（近60日）
      var rangeN = Math.min(60, n);
      var high60 = Math.max.apply(null, highs.slice(-rangeN));
      var low60 = Math.min.apply(null, lows.slice(-rangeN));
      var pos = high60 === low60 ? 50 : (lastClose - low60) / (high60 - low60) * 100;
      if (pos > 85) { score -= 1; signals.push({ name: '价格位置', signal: '高位', detail: '处于' + rangeN + '日区间顶部(' + pos.toFixed(0) + '%)，回调风险', positive: false }); }
      else if (pos < 15) { score += 1; signals.push({ name: '价格位置', signal: '低位', detail: '处于' + rangeN + '日区间底部(' + pos.toFixed(0) + '%)，反弹机会', positive: true }); }
      else { signals.push({ name: '价格位置', signal: '中位', detail: '处于' + rangeN + '日区间' + pos.toFixed(0) + '%位置', positive: null }); }

      // 7. 成交量分析
      if (n >= 25) {
        var avgVol5 = volumes.slice(-5).reduce(function(a, b) { return a + b; }, 0) / 5;
        var avgVol20 = volumes.slice(-20).reduce(function(a, b) { return a + b; }, 0) / 20;
        var volRatio = avgVol5 / avgVol20;
        if (volRatio > 1.5 && lastClose > closes[n - 2]) { score += 1; signals.push({ name: '成交量', signal: '放量上涨', detail: '量比' + volRatio.toFixed(2) + '，资金流入', positive: true }); }
        else if (volRatio > 1.5 && lastClose < closes[n - 2]) { score -= 1; signals.push({ name: '成交量', signal: '放量下跌', detail: '量比' + volRatio.toFixed(2) + '，资金流出', positive: false }); }
        else if (volRatio < 0.6) { signals.push({ name: '成交量', signal: '缩量', detail: '量比' + volRatio.toFixed(2) + '，交投清淡', positive: null }); }
        else { signals.push({ name: '成交量', signal: '正常', detail: '量比' + volRatio.toFixed(2), positive: null }); }
      }

      // 综合建议
      var advice, adviceLevel, adviceText;
      if (score >= 4) { advice = '买入'; adviceLevel = 'buy'; adviceText = '多项技术指标指向多方，短期上涨概率较大，可考虑买入'; }
      else if (score >= 1) { advice = '偏多/持有'; adviceLevel = 'lean-buy'; adviceText = '技术面偏多，可继续持有或择机小幅加仓'; }
      else if (score <= -4) { advice = '卖出'; adviceLevel = 'sell'; adviceText = '多项技术指标指向空方，短期下跌风险较大，建议减仓或卖出'; }
      else if (score <= -1) { advice = '偏空/减仓'; adviceLevel = 'lean-sell'; adviceText = '技术面偏空，考虑减仓防范风险'; }
      else { advice = '持有/观望'; adviceLevel = 'hold'; adviceText = '多空信号交织，建议观望或维持现有仓位'; }

      return {
        advice: advice,
        level: adviceLevel,
        score: score,
        text: adviceText,
        signals: signals,
        metrics: {
          ma5: ma5, ma10: ma10, ma20: ma20, ma60: ma60,
          rsi: rsi, kdj: kdj, macd: macd,
          lastClose: lastClose, high60: high60, low60: low60, position: pos
        }
      };
    } catch (e) {
      console.warn('[自选页面] AI技术分析获取失败:', e);
      return null;
    }
  }

  // 选择股票并加载新闻面板
  window.selectStockForNews = async function(code, name) {
    if (currentSelectedStock && currentSelectedStock.code === code && stockDetailCache[code]) {
      // 已选中，刷新数据
    }
    currentSelectedStock = { code: code, name: name };
    const panelContent = document.getElementById('newsPanelContent');
    const panelTitle = document.getElementById('newsPanelTitle');
    const panelSubtitle = document.querySelector('#stockNewsPanel .stock-news-subtitle');

    panelTitle.textContent = '📰 ' + name + ' (' + code + ')';
    if (panelSubtitle) panelSubtitle.textContent = '正在加载数据...';
    panelContent.innerHTML = '<div class="stock-news-loading">⏳ 正在加载数据，请稍候...</div>';

    // 标记选中行
    document.querySelectorAll('.row-clickable').forEach(r => r.classList.remove('selected'));
    const rows = document.querySelectorAll('.row-clickable');
    rows.forEach(r => {
      if (r.textContent && r.textContent.indexOf(code) >= 0) r.classList.add('selected');
    });

    try {
      // 并行获取新闻、机构预测、AI估值、AI技术分析（每个请求独立 catch）
      const [news, forecasts, valuation, analysis] = await Promise.all([
        fetchStockNews(code, name).catch(() => []),
        fetchInstitutionForecasts(code, name).catch(() => []),
        fetchAIValuation(code).catch(() => null),
        fetchAIAnalysis(code).catch(() => null)
      ]);

      stockDetailCache[code] = { news: news, forecasts: forecasts, valuation: valuation, analysis: analysis };
      renderStockNewsPanel(currentSelectedStock, stockDetailCache[code]);
    } catch (e) {
      panelContent.innerHTML = '<div class="stock-news-empty">⚠️ 数据加载失败，请稍后重试</div>';
    }
  };

  // 渲染新闻面板
  function renderStockNewsPanel(stock, detail) {
    const panelSubtitle = document.querySelector('#stockNewsPanel .stock-news-subtitle');
    if (panelSubtitle) {
      var subtitleParts = [];
      if (detail.valuation) subtitleParts.push('估值:' + detail.valuation.badge);
      if (detail.analysis) subtitleParts.push('技术:' + detail.analysis.advice);
      panelSubtitle.textContent = subtitleParts.length ? subtitleParts.join(' | ') : '点击标签查看详情';
    }

    var html = '<div class="news-tabs">' +
      '<button class="news-tab active" id="tabTrend" onclick="switchNewsTab(\'trend\')">📈 走势</button>' +
      '<button class="news-tab" id="tabValuation" onclick="switchNewsTab(\'valuation\')">🤖 估值</button>' +
      '<button class="news-tab" id="tabAnalysis" onclick="switchNewsTab(\'analysis\')">🧠 AI分析</button>' +
      '<button class="news-tab" id="tabAgent" onclick="switchNewsTab(\'agent\')">👥 5人Agent</button>' +
      '</div>';

    // 走势 Tab 内容（默认显示）
    html += '<div id="trendTabContent" class="news-tab-content">';
    html += '<div class="trend-sub-tabs">' +
      '<button class="trend-sub-tab active" id="trendSub_minute" onclick="switchTrendTab(\'minute\',\'' + stock.code + '\',\'' + stock.name.replace(/'/g, '') + '\')">实时</button>' +
      '<button class="trend-sub-tab" id="trendSub_5day" onclick="switchTrendTab(\'5day\',\'' + stock.code + '\',\'' + stock.name.replace(/'/g, '') + '\')">五日</button>' +
      '<button class="trend-sub-tab" id="trendSub_week" onclick="switchTrendTab(\'week\',\'' + stock.code + '\',\'' + stock.name.replace(/'/g, '') + '\')">周</button>' +
      '<button class="trend-sub-tab" id="trendSub_month" onclick="switchTrendTab(\'month\',\'' + stock.code + '\',\'' + stock.name.replace(/'/g, '') + '\')">月</button>' +
      '<button class="trend-sub-tab" id="trendSub_year" onclick="switchTrendTab(\'year\',\'' + stock.code + '\',\'' + stock.name.replace(/'/g, '') + '\')">年</button>' +
      '</div>';
    html += '<div id="trendChartContainer"><div class="stock-news-loading">⏳ 正在加载分时走势数据...</div></div>';
    html += '</div>';

    // AI估值 Tab 内容（默认隐藏）
    html += '<div id="valuationTabContent" class="news-tab-content" style="display:none;">';
    if (detail.valuation) {
      const v = detail.valuation;
      const m = v.metrics;
      html += '<div class="ai-judgment ' + v.level + '">' +
        '<div class="ai-judgment-title">🤖 AI 估值判断</div>' +
        '<div class="ai-judgment-text">' + v.text + '</div>' +
        '</div>';

      // 关键指标表格
      const fmt = function(x, suffix) {
        if (x === null || x === undefined || isNaN(x)) return '--';
        if (Math.abs(x) >= 1e8) return (x / 1e8).toFixed(2) + '亿' + (suffix || '');
        return x.toFixed(2) + (suffix || '');
      };
      html += '<div class="ai-metrics">' +
        '<div class="ai-metric-row"><span class="ai-metric-label">当前价</span><span class="ai-metric-value">' + fmt(m.price, ' 元') + '</span></div>' +
        '<div class="ai-metric-row"><span class="ai-metric-label">市盈率(动)</span><span class="ai-metric-value">' + fmt(m.pe) + '</span></div>' +
        '<div class="ai-metric-row"><span class="ai-metric-label">市净率</span><span class="ai-metric-value">' + fmt(m.pb) + '</span></div>' +
        '<div class="ai-metric-row"><span class="ai-metric-label">每股收益</span><span class="ai-metric-value">' + fmt(m.eps, ' 元') + '</span></div>' +
        '<div class="ai-metric-row"><span class="ai-metric-label">每股净资产</span><span class="ai-metric-value">' + fmt(m.bvps, ' 元') + '</span></div>' +
        '<div class="ai-metric-row"><span class="ai-metric-label">总市值</span><span class="ai-metric-value">' + fmt(m.totalCap) + '</span></div>' +
        '<div class="ai-metric-row"><span class="ai-metric-label">流通市值</span><span class="ai-metric-value">' + fmt(m.circCap) + '</span></div>' +
        '<div class="ai-metric-row"><span class="ai-metric-label">今日最高</span><span class="ai-metric-value">' + fmt(m.high52, ' 元') + '</span></div>' +
        '<div class="ai-metric-row"><span class="ai-metric-label">今日最低</span><span class="ai-metric-value">' + fmt(m.low52, ' 元') + '</span></div>' +
        '</div>';
      html += '<div id="valHistoryExtra"></div>';

      html += '<div style="font-size:0.7rem;color:var(--muted);margin-top:0.8rem;line-height:1.4;padding-top:0.5rem;border-top:1px dashed var(--rule);">⚠️ 提示：本判断基于当前 PE/PB 等实时指标，结合 A 股市场大致估值区间给出，仅供参考，不构成投资建议。</div>';
    } else {
      html += '<div class="stock-news-empty">' +
        '<div style="font-size:1.8rem;margin-bottom:0.5rem;">🤖</div>' +
        '<div>暂无 ' + stock.name + ' 的估值数据</div>' +
        '<div style="font-size:0.75rem;margin-top:0.4rem;color:var(--muted);">说明：可能为新股/亏损股/已退市</div>' +
        '</div>';
    }
    html += '</div>';

    // AI深度分析 Tab 内容（WorkBuddy 风格，默认隐藏）
    html += '<div id="analysisTabContent" class="news-tab-content" style="display:none;">';
    if (detail.analysis) {
      var a = detail.analysis;
      var m = a.metrics;
      var lastPrice = m.lastClose;

      // === 1. 评级横幅 ===
      var ratingColor = a.level === 'buy' ? '#ef4444' : (a.level === 'sell' ? '#10b981' : '#f59e0b');
      var ratingLabel = a.level === 'buy' ? 'BUY' : (a.level === 'sell' ? 'SELL' : (a.level === 'lean-buy' ? 'LEAN BUY' : (a.level === 'lean-sell' ? 'LEAN SELL' : 'HOLD')));
      html += '<div style="background:linear-gradient(135deg,' + ratingColor + '22,' + ratingColor + '08);border:1px solid ' + ratingColor + '88;border-radius:10px;padding:12px 16px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;">' +
        '<div><div style="font-size:0.7rem;color:var(--muted);">综合评级</div><div style="font-size:1.1rem;font-weight:700;color:' + ratingColor + ';">' + ratingLabel + '</div></div>' +
        '<div style="text-align:right;"><div style="font-size:0.7rem;color:var(--muted);">技术评分</div><div style="font-size:1.1rem;font-weight:700;color:' + ratingColor + ';">' + (a.score >= 0 ? '+' : '') + a.score + '</div></div>' +
        '</div>';

      // === 2. 五维评分雷达图 ===
      var techScore = Math.max(0, Math.min(10, 5 + a.score * 1.5));
      var fundScore = Math.max(0, Math.min(10, 5 + (detail.valuation ? (detail.valuation.level === 'undervalued' ? 3 : (detail.valuation.level === 'overvalued' ? -2 : 0)) : 0)));
      var newsScore = Math.max(0, Math.min(10, 5 + (detail.news && detail.news.length > 3 ? 2 : 0) + (detail.forecasts && detail.forecasts.length > 0 ? 1 : 0)));
      var sentimentScore = Math.max(0, Math.min(10, 5 + (m.position > 70 ? -1 : (m.position < 30 ? 1 : 0)) + (a.signals.filter(function(s){return s.positive;}).length - a.signals.filter(function(s){return s.positive === false;}).length)));
      var riskScore = Math.max(0, Math.min(10, 5 + (m.position > 85 ? -2 : (m.position < 15 ? 2 : 0)) + (m.rsi > 70 ? -1 : (m.rsi < 30 ? 1 : 0))));
      var radarId = 'radar_' + stock.code + '_' + Date.now();
      var radarData = [techScore.toFixed(1), fundScore.toFixed(1), newsScore.toFixed(1), sentimentScore.toFixed(1), riskScore.toFixed(1)];
      html += '<div style="background:var(--bg);border-radius:10px;padding:12px;margin-bottom:12px;">' +
        '<div style="font-size:0.8rem;color:var(--muted);margin-bottom:6px;">五维评分雷达</div>' +
        '<div id="' + radarId + '" class="radar-chart" data-values="' + radarData.join(',') + '" style="height:200px;"></div></div>';

      // === 3. 多空辩论 ===
      var bullPoints = [];
      var bearPoints = [];
      a.signals.forEach(function(s) {
        if (s.positive === true) bullPoints.push(s.name + ': ' + s.signal + ' (' + s.detail + ')');
        else if (s.positive === false) bearPoints.push(s.name + ': ' + s.signal + ' (' + s.detail + ')');
      });
      if (bullPoints.length === 0) bullPoints.push('暂无明确多头信号');
      if (bearPoints.length === 0) bearPoints.push('暂无明确空头信号');
      var bullWeight = Math.min(10, 5 + a.score);
      var bearWeight = Math.max(0, 5 - a.score);

      html += '<div style="background:var(--bg);border-radius:10px;padding:12px;margin-bottom:12px;">' +
        '<div style="font-size:0.8rem;color:var(--muted);margin-bottom:8px;">多空辩论</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
        '<div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:10px;">' +
        '<div style="color:#ef4444;font-size:0.75rem;font-weight:600;margin-bottom:4px;">多头 (权重 ' + bullWeight + ')</div>' +
        bullPoints.map(function(p) { return '<div style="font-size:0.7rem;color:var(--muted);padding:1px 0;">▲ ' + p + '</div>'; }).join('') +
        '</div>' +
        '<div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:10px;">' +
        '<div style="color:#10b981;font-size:0.75rem;font-weight:600;margin-bottom:4px;">空头 (权重 ' + bearWeight + ')</div>' +
        bearPoints.map(function(p) { return '<div style="font-size:0.7rem;color:var(--muted);padding:1px 0;">▼ ' + p + '</div>'; }).join('') +
        '</div>' +
        '</div>' +
        '<div style="background:var(--card);border-left:3px solid #f59e0b;border-radius:6px;padding:8px 12px;margin-top:8px;">' +
        '<div style="font-size:0.75rem;color:var(--ink);"><strong>裁决：</strong>' + a.text + '</div>' +
        '</div></div>';

      // === 4. 交易方案 ===
      var entryLow = (lastPrice * 0.95).toFixed(2);
      var entryHigh = (lastPrice * 0.98).toFixed(2);
      var target1 = (lastPrice * (a.score >= 2 ? 1.10 : 1.05)).toFixed(2);
      var target2 = (lastPrice * (a.score >= 2 ? 1.20 : 1.10)).toFixed(2);
      var stopLoss = (lastPrice * 0.92).toFixed(2);
      var positionSize = a.score >= 4 ? '15-25%' : (a.score >= 1 ? '10-15%' : (a.score <= -4 ? '0-5%' : '5-10%'));

      html += '<div style="background:var(--bg);border-radius:10px;padding:12px;margin-bottom:12px;">' +
        '<div style="font-size:0.8rem;color:var(--muted);margin-bottom:8px;">交易方案</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(80px,1fr));gap:6px;">' +
        '<div style="text-align:center;background:var(--card);border-radius:6px;padding:8px;border:1px solid var(--rule);"><div style="font-size:0.65rem;color:var(--muted);">入场价</div><div style="font-size:0.9rem;font-weight:600;">' + entryLow + '-' + entryHigh + '</div></div>' +
        '<div style="text-align:center;background:var(--card);border-radius:6px;padding:8px;border:1px solid var(--rule);"><div style="font-size:0.65rem;color:var(--muted);">目标价一</div><div style="font-size:0.9rem;font-weight:600;color:#ef4444;">' + target1 + '</div></div>' +
        '<div style="text-align:center;background:var(--card);border-radius:6px;padding:8px;border:1px solid var(--rule);"><div style="font-size:0.65rem;color:var(--muted);">目标价二</div><div style="font-size:0.9rem;font-weight:600;color:#ef4444;">' + target2 + '</div></div>' +
        '<div style="text-align:center;background:var(--card);border-radius:6px;padding:8px;border:1px solid var(--rule);"><div style="font-size:0.65rem;color:var(--muted);">止损价</div><div style="font-size:0.9rem;font-weight:600;color:#10b981;">' + stopLoss + '</div></div>' +
        '<div style="text-align:center;background:var(--card);border-radius:6px;padding:8px;border:1px solid var(--rule);"><div style="font-size:0.65rem;color:var(--muted);">建议仓位</div><div style="font-size:0.9rem;font-weight:600;">' + positionSize + '</div></div>' +
        '</div></div>';

      // === 5. 技术指标明细 ===
      var fmtT = function(x, suffix) {
        if (x === null || x === undefined || isNaN(x)) return '--';
        return x.toFixed(2) + (suffix || '');
      };
      html += '<details style="margin-bottom:10px;"><summary style="font-size:0.75rem;color:var(--muted);cursor:pointer;padding:6px;background:var(--bg);border-radius:6px;">技术指标明细</summary>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:4px;padding:8px 0;">' +
        '<div style="display:flex;justify-content:space-between;padding:3px 8px;background:var(--bg);border-radius:4px;font-size:0.7rem;"><span style="color:var(--muted);">MA5</span><span>' + fmtT(m.ma5) + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;padding:3px 8px;background:var(--bg);border-radius:4px;font-size:0.7rem;"><span style="color:var(--muted);">MA10</span><span>' + fmtT(m.ma10) + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;padding:3px 8px;background:var(--bg);border-radius:4px;font-size:0.7rem;"><span style="color:var(--muted);">MA20</span><span>' + fmtT(m.ma20) + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;padding:3px 8px;background:var(--bg);border-radius:4px;font-size:0.7rem;"><span style="color:var(--muted);">MA60</span><span>' + (m.ma60 ? fmtT(m.ma60) : '--') + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;padding:3px 8px;background:var(--bg);border-radius:4px;font-size:0.7rem;"><span style="color:var(--muted);">RSI(14)</span><span>' + fmtT(m.rsi) + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;padding:3px 8px;background:var(--bg);border-radius:4px;font-size:0.7rem;"><span style="color:var(--muted);">MACD柱</span><span>' + fmtT(m.macd.macd) + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;padding:3px 8px;background:var(--bg);border-radius:4px;font-size:0.7rem;"><span style="color:var(--muted);">KDJ-K</span><span>' + fmtT(m.kdj.k) + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;padding:3px 8px;background:var(--bg);border-radius:4px;font-size:0.7rem;"><span style="color:var(--muted);">KDJ-J</span><span>' + fmtT(m.kdj.j) + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;padding:3px 8px;background:var(--bg);border-radius:4px;font-size:0.7rem;"><span style="color:var(--muted);">60日位置</span><span>' + m.position.toFixed(0) + '%</span></div>' +
        '</div></details>';

      // === 6. 催化标签 ===
      var catalystTags = '';
      a.signals.forEach(function(s) {
        var isPos = s.positive === true;
        var isNeg = s.positive === false;
        catalystTags += '<span style="font-size:0.65rem;padding:2px 8px;border-radius:10px;border:1px solid ' + (isPos ? '#ef4444' : (isNeg ? '#10b981' : '#64748b')) + ';color:' + (isPos ? '#ef4444' : (isNeg ? '#10b981' : '#94a3b8')) + ';margin:2px;display:inline-block;">' + s.name + ' ' + s.signal + '</span>';
      });
      if (catalystTags) {
        html += '<div style="background:var(--bg);border-radius:10px;padding:12px;margin-bottom:10px;">' +
          '<div style="font-size:0.8rem;color:var(--muted);margin-bottom:6px;">信号标签</div>' +
          '<div>' + catalystTags + '</div></div>';
      }

      html += '<div style="font-size:0.65rem;color:var(--muted);line-height:1.4;padding-top:6px;border-top:1px dashed var(--rule);">本分析基于均线/MACD/RSI/KDJ/成交量等技术指标，结合五维评分模型生成。仅供参考，不构成投资建议。</div>';

    } else {
      html += '<div class="stock-news-empty">' +
        '<div style="font-size:1.8rem;margin-bottom:0.5rem;">🧠</div>' +
        '<div>暂无 ' + stock.name + ' 的技术分析数据</div>' +
        '<div style="font-size:0.75rem;margin-top:0.4rem;color:var(--muted);">说明：上市不足20个交易日或数据不足</div>' +
        '</div>';
    }
    html += '</div>';

    // === 5人Agent Tab 内容（默认隐藏）===
    html += '<div id="agentTabContent" class="news-tab-content" style="display:none;">';
    html += '<div class="stock-news-loading">⏳ 正在加载 5 人 Agent 报告...</div>';
    html += '</div>';

    document.getElementById('newsPanelContent').innerHTML = html;

    // 异步补充估值历史（近5年 PE/PB 分位，改进#12）
    if (stock.code) {
      renderValHistoryExtra(stock.code);
    }

    // 渲染独立新闻栏（含新闻和机构预测）
    renderNewsSection(stock, detail.news || [], detail.forecasts || []);

    // 默认加载分时走势
    if (stock.code) {
      switchTrendTab('minute', stock.code, stock.name);
    }

    // 异步加载 5 人 Agent 报告 JSON
    fetchAgentReport(stock.code);
  }

  // 估值历史补充（近5年 PE/PB 分位，改进#12；数据源：后端 /api/valuation_history）
  async function renderValHistoryExtra(code) {
    const el = document.getElementById('valHistoryExtra');
    if (!el || !code) return;
    let data = null;
    try {
      const resp = await fetch('/api/valuation_history?code=' + encodeURIComponent(code), { cache: 'no-store' });
      data = await resp.json();
    } catch (e) { return; } // file:// 或非服务器访问时静默隐藏
    if (!data || !data.ok || !data.series || !data.series.length) return;
    const lines = [];
    if (data.pe_5y_pct != null && data.pe_5y_pct > 0) {
      var rng = (data.pe_5y_range && data.pe_5y_range[0] > 0)
        ? '（区间 ' + data.pe_5y_range[0].toFixed(1) + '~' + data.pe_5y_range[1].toFixed(1) + '）'
        : '';
      lines.push('PE-TTM 近5年分位 <b>' + data.pe_5y_pct + '%</b>' + rng);
    }
    if (data.pb_5y_pct != null && data.pb_5y_pct > 0) {
      lines.push('PB 近5年分位 <b>' + data.pb_5y_pct + '%</b>');
    }
    if (!lines.length) return;
    el.innerHTML = '<div style="font-size:0.7rem;color:var(--muted);line-height:1.6;margin-top:0.6rem;padding-top:0.5rem;border-top:1px dashed var(--rule);">📈 ' + lines.join(' · ') + '（演示参考，不构成投资建议）</div>';
  }

  // 渲染独立新闻栏（含新闻和机构预测）
  function renderNewsSection(stock, news, forecasts) {
    var section = document.getElementById('stockNewsSection');
    var title = document.getElementById('newsSectionTitle');
    var subtitle = document.getElementById('newsSectionSubtitle');
    var content = document.getElementById('newsSectionContent');
    if (!section || !content) return;

    section.style.display = 'block';
    title.textContent = '📰 ' + stock.name + '（' + stock.code + '）新闻与机构预测';
    var parts = [];
    if (news.length) parts.push(news.length + ' 条新闻');
    if (forecasts && forecasts.length) parts.push(forecasts.length + ' 条机构评级');
    subtitle.textContent = parts.length ? parts.join(' · ') : '暂无数据';

    var html = '';

    // 机构预测部分（紧凑表格形式）
    if (forecasts && forecasts.length > 0) {
      html += '<div class="forecast-section" style="margin-bottom:1rem;">' +
        '<div class="section-sub-title">📊 近期机构评级（近12个月）</div>' +
        '<div class="forecast-table">' +
        '<table class="forecast-compact">' +
        '<thead><tr>' +
        '<th>机构</th>' +
        '<th>评级</th>' +
        '<th style="text-align:right;">目标价</th>' +
        '<th style="text-align:right;">日期</th>' +
        '</tr></thead>' +
        '<tbody>';
      forecasts.slice(0, 10).forEach(function(f) {
        var ratingClass = getRatingClass(f.rating);
        var priceHtml = f.targetPrice ? f.targetPrice.toFixed(2) : '--';
        html += '<tr>' +
          '<td class="fc-inst">' + f.institution + '</td>' +
          '<td><span class="rating ' + ratingClass + '">' + (f.rating || '未评级') + '</span></td>' +
          '<td class="fc-price">' + priceHtml + '</td>' +
          '<td class="fc-date">' + (f.date || '--') + '</td>' +
          '</tr>';
      });
      html += '</tbody></table></div></div>';
    }

    // 新闻部分
    if (news.length > 0) {
      html += '<div class="section-sub-title">📰 新闻动态</div>';
      html += '<div class="stock-news-list">';
      news.forEach(function(n) {
        var hasContent = n.content && n.content.length > 0;
        var fixedUrl = fixNewsUrl(n.url);
        var hasUrl = fixedUrl.length > 0;
        // 对URL和文本进行HTML转义，防止特殊字符破坏标签
        var safeUrl = escapeHtmlAttr(fixedUrl);
        var titleText = escapeHtmlAttr(n.title || '');
        // 标题也做成可点击链接
        var titleHtml = hasUrl
          ? '<a href="' + safeUrl + '" target="_blank" rel="noopener noreferrer" class="news-title-link">' + titleText + '</a>'
          : titleText;
        html += '<div class="stock-news-item' + (n.important ? ' important' : '') + '">' +
          '<div class="stock-news-item-title">' + titleHtml + '</div>' +
          (hasContent ? '<div class="stock-news-item-content">' + escapeHtmlAttr(n.content) + '</div>' : '') +
          '<div class="stock-news-item-meta">' +
            '<span>🕐 ' + escapeHtmlAttr(n.time || '--') + '</span>' +
            '<span>📡 ' + escapeHtmlAttr(n.source || '--') + '</span>' +
            (hasUrl ? '<a href="' + safeUrl + '" target="_blank" rel="noopener noreferrer" class="news-link">查看原文 →</a>' : '') +
          '</div>' +
        '</div>';
      });
      html += '</div>';
    }

    if (news.length === 0 && (!forecasts || forecasts.length === 0)) {
      html = '<div class="stock-news-empty" style="padding:1.5rem;">' +
        '<div style="font-size:1.8rem;margin-bottom:0.5rem;">📭</div>' +
        '<div>暂无 ' + stock.name + ' 的相关新闻和机构预测</div>' +
        '</div>';
    }

    content.innerHTML = html;

    // 给所有新闻链接绑定兜底点击事件（防止target=_blank在内嵌环境被拦截）
    var newsLinks = content.querySelectorAll('.news-title-link, .news-link');
    for (var li = 0; li < newsLinks.length; li++) {
      newsLinks[li].addEventListener('click', function(e) {
        var href = this.getAttribute('data-href') || this.getAttribute('href');
        if (!href) return;
        e.preventDefault();
        try {
          var newWin = window.open(href, '_blank', 'noopener,noreferrer');
          if (!newWin) {
            // window.open被拦截，降级为当前标签跳转
            window.location.href = href;
          }
        } catch (err) {
          // 兜底：当前标签跳转
          window.location.href = href;
        }
      });
    }
  }

  // 评级样式映射
  function getRatingClass(rating) {
    if (!rating) return 'rating-hold';
    const r = String(rating);
    if (r.indexOf('买入') >= 0 || r.indexOf('强烈推荐') >= 0 || r.indexOf('强推') >= 0 || r.indexOf('跑赢') >= 0) return 'rating-buy';
    if (r.indexOf('增持') >= 0 || r.indexOf('推荐') >= 0) return 'rating-buy';
    if (r.indexOf('减持') >= 0 || r.indexOf('卖出') >= 0) return 'rating-sell';
    return 'rating-hold';
  }

  // === 5 人 Agent 报告：从 data/report_{code}.json 加载并渲染 ===
  function fetchAgentReport(code) {
    var container = document.getElementById('agentTabContent');
    if (!container) return;
    fetch('./data/report_' + code + '.json')
      .then(function(r) {
        if (!r.ok) throw new Error('not found');
        return r.json();
      })
      .then(function(data) {
        renderAgentReport(container, data);
      })
      .catch(function() {
        container.innerHTML = '<div class="stock-news-empty">' +
          '<div style="font-size:1.8rem;margin-bottom:0.5rem;">👥</div>' +
          '<div>暂无 ' + code + ' 的 5 人 Agent 分析报告</div>' +
          '<div style="font-size:0.72rem;margin-top:0.4rem;color:var(--muted);line-height:1.5;">' +
          '请在终端运行：<br><code style="background:var(--bg);padding:2px 6px;border-radius:4px;">python multi_agent_stock_analysis.py ' + code + '</code><br>生成报告后刷新页面</div>' +
          '</div>';
      });
  }

  function renderAgentReport(container, data) {
    var f = data.final || {};
    var stock = data.stock || {};
    var agents = data.agents || {};
    var rating = f.rating || 'HOLD';
    var ratingScore = f.rating_score || 0;

    // 评级颜色
    var rc = rating.toUpperCase();
    var ratingColor = rc.indexOf('BUY') >= 0 && rc.indexOf('LEAN') < 0 ? '#ef4444' :
      rc.indexOf('BUY') >= 0 ? '#f97316' :
      rc.indexOf('SELL') >= 0 && rc.indexOf('LEAN') < 0 ? '#10b981' :
      rc.indexOf('SELL') >= 0 ? '#22c55e' : '#94a3b8';
    var ratingClass = rating.toLowerCase().replace(/\s+/g, '-');

    var html = '';

    // 1. 评级横幅
    html += '<div style="background:linear-gradient(135deg,' + ratingColor + '22,' + ratingColor + '08);' +
      'border:1px solid ' + ratingColor + '88;border-radius:10px;padding:12px;margin-bottom:10px;' +
      'display:flex;justify-content:space-between;align-items:center;">' +
      '<div><div style="font-size:0.65rem;color:var(--muted);">综合评级</div>' +
      '<div style="font-size:1rem;font-weight:700;color:' + ratingColor + ';">' + rating + '</div></div>' +
      '<div style="text-align:right;"><div style="font-size:0.65rem;color:var(--muted);">综合评分</div>' +
      '<div style="font-size:1rem;font-weight:700;color:' + ratingColor + ';">' + (ratingScore >= 0 ? '+' : '') + ratingScore + '</div></div>' +
      '</div>';

    // 1.5 醒目免责横幅
    html += '<div style="background:#3a2f12;border:1px solid #f1c40f;color:#f7d97a;border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:0.68rem;font-weight:600;line-height:1.5;">' +
      '⚠️ 本报告由 AI 自动生成，仅供研究学习参考，不构成任何投资建议。市场有风险，入市需谨慎。</div>';

    // 2. 五维雷达图（用 ECharts）
    var radarId = 'agent_radar_' + (f.stock_code || '') + '_' + Date.now();
    var radarVals = [f.score_valuation || 0, f.score_earnings || 0, f.score_industry || 0, f.score_technical || 0, f.score_risk || 0];
    html += '<div style="background:var(--bg);border-radius:10px;padding:10px;margin-bottom:10px;">' +
      '<div style="font-size:0.75rem;color:var(--muted);margin-bottom:4px;">五维评分雷达</div>' +
      '<div id="' + radarId + '" class="agent-radar-chart" data-values="' + radarVals.join(',') + '" style="height:180px;"></div>' +
      // 分数表格
      '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-top:6px;">' +
      ['估值', '财报', '产业', '技术', '安全'].map(function(label, i) {
        var s = radarVals[i];
        var c = s >= 7 ? '#ef4444' : s >= 4 ? '#f59e0b' : '#64748b';
        return '<div style="text-align:center;background:var(--card);border-radius:4px;padding:4px 2px;">' +
          '<div style="font-size:0.6rem;color:var(--muted);">' + label + '</div>' +
          '<div style="font-size:0.85rem;font-weight:700;color:' + c + ';">' + s + '</div></div>';
      }).join('') +
      '</div>' +
      '<div style="font-size:0.58rem;color:var(--muted);text-align:center;margin-top:4px;">所有维度分数越高越好（安全高分=风险低）</div>' +
      '</div>';

    // 3. 交易方案
    html += '<div style="background:var(--bg);border-radius:10px;padding:10px;margin-bottom:10px;">' +
      '<div style="font-size:0.75rem;color:var(--muted);margin-bottom:2px;">交易方案（演示参考）</div>' +
      '<div style="font-size:0.6rem;color:#e8c8a0;margin-bottom:6px;">⚠️ 以下价格与仓位为演示学习用参考，不构成投资建议。</div>' +
      '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;">' +
      '<div style="text-align:center;background:var(--card);border-radius:6px;padding:6px;border:1px solid var(--rule);"><div style="font-size:0.6rem;color:var(--muted);">入场价区间</div><div style="font-size:0.82rem;font-weight:600;">' + (f.entry_low || 0).toFixed(2) + ' ~ ' + (f.entry_high || 0).toFixed(2) + '</div></div>' +
      '<div style="text-align:center;background:var(--card);border-radius:6px;padding:6px;border:1px solid var(--rule);"><div style="font-size:0.6rem;color:var(--muted);">当前价</div><div style="font-size:0.82rem;font-weight:600;">' + (f.price || 0).toFixed(2) + '</div></div>' +
      '<div style="text-align:center;background:var(--card);border-radius:6px;padding:6px;border:1px solid var(--rule);"><div style="font-size:0.6rem;color:var(--muted);">目标价(保守)</div><div style="font-size:0.82rem;font-weight:600;color:#ef4444;">' + (f.tgt1 || 0).toFixed(2) + '</div></div>' +
      '<div style="text-align:center;background:var(--card);border-radius:6px;padding:6px;border:1px solid var(--rule);"><div style="font-size:0.6rem;color:var(--muted);">目标价(乐观)</div><div style="font-size:0.82rem;font-weight:600;color:#ef4444;">' + (f.tgt2 || 0).toFixed(2) + '</div></div>' +
      '<div style="text-align:center;background:var(--card);border-radius:6px;padding:6px;border:1px solid var(--rule);"><div style="font-size:0.6rem;color:var(--muted);">止损价</div><div style="font-size:0.82rem;font-weight:600;color:#10b981;">' + (f.stop_loss || 0).toFixed(2) + '</div></div>' +
      '<div style="text-align:center;background:var(--card);border-radius:6px;padding:6px;border:1px solid var(--rule);"><div style="font-size:0.6rem;color:var(--muted);">参考仓位（演示）</div><div style="font-size:0.82rem;font-weight:600;">' + (f.position_size || '--') + '</div></div>' +
      '</div></div>';

    // 4. 多空辩论
    var bulls = f.aggregated_bulls || [];
    var bears = f.aggregated_bears || [];
    var maxRows = Math.max(bulls.length, bears.length);
    var debateRows = '';
    for (var i = 0; i < maxRows; i++) {
      var b = bulls[i] || '';
      var s = bears[i] || '';
      debateRows += '<tr><td style="color:#e8a0a0;font-size:0.7rem;padding:4px 6px;border-bottom:1px solid var(--rule);border-right:1px solid var(--rule);">' + b + '</td>' +
        '<td style="color:#a0d8a0;font-size:0.7rem;padding:4px 6px;border-bottom:1px solid var(--rule);">' + s + '</td></tr>';
    }
    html += '<div style="background:var(--bg);border-radius:10px;padding:10px;margin-bottom:10px;">' +
      '<div style="font-size:0.75rem;color:var(--muted);margin-bottom:6px;">多空辩论 (' + bulls.length + ' vs ' + bears.length + ')</div>' +
      '<table style="width:100%;border-collapse:collapse;">' +
      '<tr><th style="font-size:0.68rem;color:#ef4444;text-align:left;padding:4px 6px;border-bottom:1px solid var(--rule);border-right:1px solid var(--rule);">多头</th>' +
      '<th style="font-size:0.68rem;color:#10b981;text-align:left;padding:4px 6px;border-bottom:1px solid var(--rule);">空头</th></tr>' +
      debateRows + '</table></div>';

    // 5. 5 个 Agent 详情卡片
    var agentEmojis = {'估值分析师': '🔢', '财报分析师': '📊', '产业策略师': '🏭', '市场信号官': '📈', '逆向投资人': '🧨'};
    var agentOrder = ['估值分析师', '财报分析师', '产业策略师', '市场信号官', '逆向投资人'];
    agentOrder.forEach(function(role) {
      var a = agents[role];
      if (!a) return;
      var emoji = agentEmojis[role] || '🔍';
      var sc = a.score >= 7 ? '#ef4444' : a.score >= 4 ? '#f59e0b' : '#64748b';
      html += '<div style="background:var(--card);border-radius:8px;margin-bottom:8px;overflow:hidden;border:1px solid var(--rule);">' +
        '<div style="padding:8px 10px;font-weight:600;font-size:0.78rem;display:flex;align-items:center;gap:4px;background:var(--bg);border-bottom:1px solid var(--rule);">' +
        '<span>' + emoji + '</span> ' + role +
        '<span style="margin-left:auto;padding:1px 8px;border-radius:8px;font-size:0.68rem;color:#fff;background:' + sc + ';">' + a.score + '/10</span>' +
        '</div>' +
        '<div style="padding:8px 10px;">';
      // 结论
      if (a.conclusions && a.conclusions.length) {
        html += '<div style="font-size:0.65rem;color:var(--muted);margin-bottom:3px;">核心结论</div>';
        a.conclusions.forEach(function(c) {
          html += '<div style="font-size:0.7rem;color:var(--ink);padding:1px 0;line-height:1.4;">' + c + '</div>';
        });
      }
      // 多头
      if (a.bull_points && a.bull_points.length) {
        html += '<div style="font-size:0.65rem;color:#ef4444;margin-top:4px;margin-bottom:2px;">多头</div>';
        a.bull_points.forEach(function(b) {
          html += '<div style="font-size:0.68rem;color:var(--muted);padding:1px 0 1px 8px;border-left:2px solid #ef4444;">' + b + '</div>';
        });
      }
      // 空头
      if (a.bear_points && a.bear_points.length) {
        html += '<div style="font-size:0.65rem;color:#10b981;margin-top:4px;margin-bottom:2px;">空头</div>';
        a.bear_points.forEach(function(b) {
          html += '<div style="font-size:0.68rem;color:var(--muted);padding:1px 0 1px 8px;border-left:2px solid #10b981;">' + b + '</div>';
        });
      }
      html += '</div></div>';
    });

    // 6. 催化 & 风险
    if (f.catalysts && f.catalysts.length) {
      html += '<div style="background:var(--bg);border-radius:10px;padding:10px;margin-bottom:10px;">' +
        '<div style="font-size:0.75rem;color:var(--muted);margin-bottom:6px;">关键催化</div>' +
        f.catalysts.map(function(c) {
          return '<span style="font-size:0.65rem;padding:2px 8px;border-radius:10px;background:var(--card);color:#5dade2;margin:2px;display:inline-block;">' + c + '</span>';
        }).join('') + '</div>';
    }
    if (f.warnings && f.warnings.length) {
      html += '<div style="background:var(--bg);border-radius:10px;padding:10px;margin-bottom:10px;">' +
        '<div style="font-size:0.75rem;color:#f59e0b;margin-bottom:6px;">风险预警</div>' +
        f.warnings.map(function(w) {
          return '<div style="font-size:0.7rem;color:#e8c8a0;padding:2px 0;line-height:1.4;">' + w + '</div>';
        }).join('') + '</div>';
    }

    // 报告时间
    html += '<div style="font-size:0.62rem;color:var(--muted);text-align:center;padding:6px 0;border-top:1px dashed var(--rule);">' +
      '报告生成时间：' + (data.generated_at || '--') + '<br>本报告由 5 人 Agent 团队自动生成，仅供参考</div>';

    container.innerHTML = html;
  }

  // 切换新闻 Tab
  window.switchNewsTab = function(tab) {
    document.querySelectorAll('.news-tab').forEach(t => t.classList.remove('active'));
    var contentIds = ['trendTabContent', 'valuationTabContent', 'analysisTabContent', 'agentTabContent'];
    contentIds.forEach(function(id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; });
    var tabMap = {
      trend: { tab: 'tabTrend', content: 'trendTabContent' },
      valuation: { tab: 'tabValuation', content: 'valuationTabContent' },
      analysis: { tab: 'tabAnalysis', content: 'analysisTabContent' },
      agent: { tab: 'tabAgent', content: 'agentTabContent' }
    };
    var t = tabMap[tab];
    if (t) {
      var tabEl = document.getElementById(t.tab);
      var contentEl = document.getElementById(t.content);
      if (tabEl) tabEl.classList.add('active');
      if (contentEl) contentEl.style.display = 'block';
      // 切换到AI分析tab时渲染雷达图
      if (tab === 'analysis') renderRadarCharts();
      // 切换到5人Agent tab时渲染雷达图
      if (tab === 'agent') renderAgentRadarCharts();
    }
  };

  // 渲染AI分析tab中的雷达图（在tab可见后调用，否则容器宽高为0）
  function renderRadarCharts() {
    var containers = document.querySelectorAll('.radar-chart');
    containers.forEach(function(el) {
      if (el.getAttribute('data-rendered') === '1') return;
      if (typeof echarts === 'undefined') return;
      var vals = (el.getAttribute('data-values') || '').split(',').map(Number);
      if (vals.length < 5 || vals.some(isNaN)) return;
      var chart = echarts.init(el);
      chart.setOption({
        radar: {
          indicator: [
            { name: '技术面', max: 10 },
            { name: '基本面', max: 10 },
            { name: '新闻面', max: 10 },
            { name: '情绪面', max: 10 },
            { name: '风险', max: 10 }
          ],
          radius: '60%',
          splitArea: { areaStyle: { color: ['rgba(59,130,246,0.05)', 'rgba(59,130,246,0.1)'] } },
          axisLine: { lineStyle: { color: '#334155' } },
          splitLine: { lineStyle: { color: '#334155' } },
          name: { textStyle: { color: '#94a3b8', fontSize: 10 } }
        },
        series: [{
          type: 'radar',
          data: [{ value: vals, areaStyle: { color: 'rgba(59,130,246,0.2)' }, lineStyle: { color: '#3b82f6', width: 2 }, itemStyle: { color: '#3b82f6' } }]
        }]
      });
      el.setAttribute('data-rendered', '1');
    });
  }

  // 渲染5人Agent tab中的雷达图
  function renderAgentRadarCharts() {
    var containers = document.querySelectorAll('.agent-radar-chart');
    containers.forEach(function(el) {
      if (el.getAttribute('data-rendered') === '1') return;
      if (typeof echarts === 'undefined') return;
      var vals = (el.getAttribute('data-values') || '').split(',').map(Number);
      if (vals.length < 5 || vals.some(isNaN)) return;
      var chart = echarts.init(el);
      chart.setOption({
        radar: {
          indicator: [
            { name: '估值', max: 10 },
            { name: '财报', max: 10 },
            { name: '产业', max: 10 },
            { name: '技术', max: 10 },
            { name: '安全', max: 10 }
          ],
          radius: '60%',
          splitArea: { areaStyle: { color: ['rgba(93,173,226,0.05)', 'rgba(93,173,226,0.1)'] } },
          axisLine: { lineStyle: { color: '#334155' } },
          splitLine: { lineStyle: { color: '#334155' } },
          name: { textStyle: { color: '#94a3b8', fontSize: 10 } }
        },
        series: [{
          type: 'radar',
          data: [{ value: vals, areaStyle: { color: 'rgba(93,173,226,0.2)' }, lineStyle: { color: '#5dade2', width: 2 }, itemStyle: { color: '#5dade2' } }]
        }]
      });
      el.setAttribute('data-rendered', '1');
    });
  }

  // ==================== 初始化 ====================
  document.addEventListener('DOMContentLoaded', async function() {
    await initWatchlistData();
    renderTable();

    // 自适应定时刷新：交易时间30秒，非交易时间60分钟
    function scheduleNextRefresh() {
      var interval = isTradingTime() ? 30000 : 3600000;
      setTimeout(function() {
        if (watchlist.length > 0) {
          renderTable();
        }
        scheduleNextRefresh();
      }, interval);
    }
    scheduleNextRefresh();
  });

})();
