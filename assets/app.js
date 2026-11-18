/**
 * A股智能分析看板 - 实时数据版
 * 数据来源：东方财富/新浪财经公开API（无需注册，免费使用）
 */

(function() {
  'use strict';

  // ==================== 股票代码映射（名称->代码）====================
  const NAME_TO_CODE = {
    '贵州茅台':'600519','宁德时代':'300750','比亚迪':'002594','中国平安':'601318',
    '招商银行':'600036','五粮液':'000858','中芯国际':'688981','美的集团':'000333',
    '海康威视':'002415','恒瑞医药':'600276','中信证券':'600030','隆基绿能':'601012',
    '立讯精密':'002475','迈瑞医疗':'300760','工商银行':'601398','伊利股份':'600887',
    '东方财富':'300059','药明康德':'603259','长江电力':'600900','顺丰控股':'002352',
    '京东方A':'000725','三一重工':'600031','牧原股份':'002714','阳光电源':'300274',
    '海尔智家':'600690','中国中免':'601888','紫金矿业':'601899','通威股份':'600438',
    '爱尔眼科':'300015','山西汾酒':'600809','泸州老窖':'000568','中国神华':'601088',
    '中国建筑':'601668','保利发展':'600048','中国船舶':'600150','科大讯飞':'002230',
    '中兴通讯':'000063','工业富联':'601138','东方雨虹':'002271','万华化学':'600309',
    '汇川技术':'300124','片仔癀':'600436','海天味业':'603288','中国国航':'601111',
    '中国核电':'601985','中国太保':'601601','中国中铁':'601390','中国铁建':'601186',
    '中国电建':'601669','中国中车':'601766','中国交建':'601800','中国化学':'601117',
    '中国中冶':'601618','中国能建':'601868','中国核建':'601611','中国海油':'600938',
    '中国石油':'601857','中国石化':'600028','中国广核':'003816','华能水电':'600025',
    '三峡能源':'600905','陕西煤业':'601225','兖矿能源':'600188','中远海控':'601919',
    '大秦铁路':'601006','京沪高铁':'601816','上海机场':'600009','南方航空':'600029',
    '中国东航':'600115','宝钢股份':'600019','洛阳钼业':'603993','江西铜业':'600362',
    '山东黄金':'600547','中国铝业':'601600','云铝股份':'000807','华友钴业':'603799',
    '天齐锂业':'002466','赣锋锂业':'002460','北方稀土':'600111','中金黄金':'600489',
    '赤峰黄金':'600988','银泰黄金':'000975','中金岭南':'000060','驰宏锌锗':'600497',
    '厦门钨业':'600549','锡业股份':'000960','贵研铂业':'600459','宝钛股份':'600456',
    '金钼股份':'601958','东方锆业':'002167','东方钽业':'000962',
    '蓝思科技':'300433','歌尔股份':'002241','传音控股':'688036',
    '韦尔股份':'603501','兆易创新':'603986','卓胜微':'300782',
    '闻泰科技':'600745','立讯精密':'002475','领益智造':'002600',
    '长盈精密':'300115','捷荣技术':'002855','光弘科技':'300735',
    '传音控股':'688036','中芯国际':'688981','寒武纪':'688256',
    '澜起科技':'688008','金山办公':'688111','中微公司':'688012',
    '汇顶科技':'603160','紫光国微':'002049','圣邦股份':'300661',
    '思瑞浦':'688536','纳芯微':'688052','芯海科技':'688595',
    '北方华创':'002371','中微公司':'688012','拓荆科技':'688072',
    '华大九天':'301269','大华股份':'002236','海康威视':'002415',
    '太极实业':'600667','长电科技':'600584','通富微电':'002156',
    '华天科技':'002185','深科技':'000021'
  };

  // ==================== 数据存储 ====================
  const STORAGE_KEY = 'a_stock_watchlist';
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
  let currentStock = null;
  let watchlist = [];

  // 加载自选股（改进#6：统一 localStorage 为唯一权威源，种子仅首次初始化）
  function loadWatchlist() {
    try {
      // 1. localStorage 有数据 → 直接返回（不再与种子合并，修复删自选后又被种子带回的问题）
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        try {
          const localData = JSON.parse(raw);
          if (Array.isArray(localData) && localData.length > 0) {
            const result = [];
            for (const item of localData) {
              if (typeof item === 'string' && /^\d{6}$/.test(item)) {
                const name = Object.keys(NAME_TO_CODE).find(k => NAME_TO_CODE[k] === item);
                result.push({ code: item, name: (name || item).replace(/\s+/g, '') });
              } else if (item && typeof item === 'object' && item.code && /^\d{6}$/.test(item.code)) {
                const cleanName = (item.name || item.code).replace(/\s+/g, '');
                result.push({ code: item.code, name: cleanName });
                if (cleanName) NAME_TO_CODE[cleanName] = item.code;
              }
            }
            if (result.length > 0) return result;
          }
        } catch(e) {}
      }
      // 2. localStorage 为空（首次使用）→ 用种子初始化并写入 localStorage，此后以 localStorage 为准
      let seed = null;
      if (window.__STOCK_WATCHLIST_SEED__ && window.__STOCK_WATCHLIST_SEED__.length > 0) {
        seed = window.__STOCK_WATCHLIST_SEED__;
      } else {
        seed = EMBEDDED_SEED;
      }
      const result = [];
      for (const item of seed) {
        if (typeof item === 'string' && /^\d{6}$/.test(item)) {
          const name = Object.keys(NAME_TO_CODE).find(k => NAME_TO_CODE[k] === item);
          result.push({ code: item, name: (name || item).replace(/\s+/g, '') });
        } else if (item && typeof item === 'object' && item.code && /^\d{6}$/.test(item.code)) {
          const cleanName = (item.name || item.code).replace(/\s+/g, '');
          result.push({ code: item.code, name: cleanName });
          if (cleanName) NAME_TO_CODE[cleanName] = item.code;
        }
      }
      saveWatchlist(result);
      return result;
    } catch(e) {
      console.warn('自选股数据加载失败:', e);
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
      console.warn('自选股保存失败:', e);
    }
  }

  // ==================== 工具函数 ====================
  function formatNumber(n) { return n ? n.toFixed(2) : '--'; }
  function getChangeClass(c) { return c >= 0 ? 'up' : 'down'; }
  function getChangeSign(c) { return c >= 0 ? '+' : ''; }

  function getSecid(code) {
    if (!code) return '';
    if (code.startsWith('6')) return '1.' + code;
    if (code.startsWith('0') || code.startsWith('3') || code.startsWith('00') || code.startsWith('30')) return '0.' + code;
    if (code.startsWith('688') || code.startsWith('689')) return '1.' + code;
    return '0.' + code;
  }

  // Toast 提示
  let toastTimer = null;
  function showToast(msg, type, duration) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (type ? ' ' + type : '');
    el.style.display = 'block';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.display = 'none'; }, duration || 3000);
  }

  // ==================== API调用（JSONP方式，绕过CORS）====================
  
  // 增强版 JSONP 请求（带超时和重试，统一实现）
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

  // 东方财富实时行情（纯 JSONP + 重试机制）
  async function fetchStockRealtime(code) {
    try {
      const secid = getSecid(code);
      const url = 'https://push2.eastmoney.com/api/qt/stock/get?secid=' + secid + '&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f116,f162,f167,f168,f169,f170';
      const json = await jsonpRequestWithRetry(url, 'cb', 2);
      if (json && json.data && json.data.f43) {
        const d = json.data;
        const price = d.f43 / 100;
        if (price > 0) {
          const close = (d.f60 || 0) / 100;
          return {
            name: (d.f58 || '').replace(/\s+/g, ''),
            code: d.f57 || code,
            price: price,
            open: d.f46 / 100,
            close: close,
            high: d.f44 / 100,
            low: d.f45 / 100,
            volume: d.f47 || 0,
            amount: d.f48 || 0,
            change: close > 0 ? ((price - close) / close * 100) : 0,
            changeAmount: price - close,
            pe: (d.f162 || 0) / 100,
            pb: (d.f167 || 0) / 100,
            marketCap: d.f116 || 0,
            turnover: (d.f168 || 0) / 100
          };
        }
      }
      console.warn('[数据获取] 股票数据无效:', code);
    } catch (e) {
      console.warn('[数据获取] 股票获取失败:', code, e);
    }
    return null;
  }

  // 东方财富搜索API（替代失效的新浪搜索）
  async function searchStockCode(keyword) {
    try {
      // 优先使用新浪搜索（如果可用）
      const result = await searchSinaViaScript(keyword);
      if (result) return result;
      // 降级：使用东方财富搜索
      return await searchEastmoney(keyword);
    } catch (e) {
      return null;
    }
  }

  function searchEastmoney(keyword) {
    return new Promise((resolve) => {
      const url = 'https://searchapi.eastmoney.com/api/suggest/get?input=' + encodeURIComponent(keyword) + '&type=14&count=5';
      const script = document.createElement('script');
      const cbName = 'em_search_' + Date.now();
      script.src = url + '&cb=' + cbName;
      let done = false;
      function finish(code) {
        if (done) return;
        done = true;
        if (script.parentNode) document.head.removeChild(script);
        try { delete window[cbName]; } catch(e) {}
        resolve(code || null);
      }
      window[cbName] = function(data) {
        if (data && Array.isArray(data) && data.length > 0) {
          for (const item of data) {
            if (item.code && /^\d{6}$/.test(item.code)) {
              finish(item.code);
              return;
            }
          }
        }
        finish(null);
      };
      script.onerror = function() { finish(null); };
      document.head.appendChild(script);
      setTimeout(() => { finish(null); }, 5000);
    });
  }

  function searchSinaViaScript(keyword) {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      const varName = 'suggestdata_' + Date.now();
      script.src = 'https://suggest3.sinajs.cn/suggest/type=11,12,13,14,15&key=' + encodeURIComponent(keyword) + '&name=' + varName;
      script.charset = 'gb2312';
      script.onload = function() {
        if (script.parentNode) document.head.removeChild(script);
        try {
          const result = window[varName];
          // 清理变量
          try { window[varName] = undefined; } catch(e) {}
          if (result && typeof result === 'string' && result.length > 0) {
            const cleanResult = result.replace(/^"|"$/g, '');
            const items = cleanResult.split(';').filter(s => s.trim().length > 0);
            for (const item of items) {
              const parts = item.split(',');
              if (parts.length >= 3) {
                const code = parts[2];
                if (/^\d{6}$/.test(code)) {
                  // 动态添加到映射表（移除名称中的空格）
                  const stockName = parts[0].replace(/\s+/g, '');
                  NAME_TO_CODE[stockName] = code;
                  resolve(code);
                  return;
                }
              }
            }
          }
        } catch(e) {
          console.warn('搜索解析失败:', e);
        }
        resolve(null);
      };
      script.onerror = function() { if (script.parentNode) document.head.removeChild(script); resolve(null); };
      document.head.appendChild(script);
      setTimeout(() => { if (script.parentNode) document.head.removeChild(script); resolve(null); }, 8000);
    });
  }

  // 新浪实时行情API（已失效，降级为东方财富JSONP）
  async function fetchSinaRealtime(code) {
    return fetchStockRealtime(code);
  }

  // 东方财富实时行情（JSONP方式，用于自选列表价格更新）
  async function fetchSinaViaScript(code) {
    try {
      const secid = getSecid(code);
      const url = 'https://push2.eastmoney.com/api/qt/stock/get?secid=' + secid + '&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f116,f162,f167,f168,f169,f170';
      const json = await jsonpRequestWithRetry(url, 'cb', 2);
      if (json && json.data && json.data.f43) {
        const d = json.data;
        const price = d.f43 / 100;
        if (price > 0) {
          const close = (d.f60 || 0) / 100;
          return {
            name: (d.f58 || code).replace(/\s+/g, ''),
            code: d.f57 || code,
            price: price,
            open: d.f46 / 100,
            close: close,
            high: d.f44 / 100,
            low: d.f45 / 100,
            volume: d.f47 || 0,
            change: close > 0 ? ((price - close) / close * 100) : 0,
            changeAmount: price - close,
            pe: (d.f162 || 0) / 100,
            pb: (d.f167 || 0) / 100,
            marketCap: d.f116 || 0,
            turnover: (d.f168 || 0) / 100
          };
        }
      }
    } catch (e) {
      console.warn('[数据获取] 自选价格获取失败:', code, e);
    }
    return null;
  }

  function parseEastmoneyData(d) {
    if (!d) return null;
    return {
      name: (d.f58 || '').replace(/\s+/g, ''), // 移除名称中的空格
      code: d.f57,
      price: d.f43 / 100,       // 最新价
      open: d.f46 / 100,        // 开盘价
      close: (d.f60 || d.f44) / 100, // 昨收价（优先f60）
      high: d.f44 / 100,        // 最高价
      low: d.f45 / 100,         // 最低价
      volume: d.f47 || 0,       // 成交量（手）
      amount: d.f48 || 0,       // 成交额
      change: d.f170 / 100,     // 涨跌幅(%)
      changeAmount: d.f169 / 100, // 涨跌额
      pe: (d.f162 || 0) / 100,  // 市盈率
      pb: (d.f167 || 0) / 100,  // 市净率
      marketCap: d.f116 || 0,   // 总市值
      turnover: (d.f168 || 0) / 100, // 换手率
      amplitude: (d.f171 || 0) / 100  // 振幅
    };
  }

  // 东方财富行业板块数据
  async function fetchSectorData() {
    try {
      const url = 'https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2+f:!50&fields=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f20,f21,f23,f24,f25,f26,f27,f28,f29,f30,f31,f32,f33,f34,f35,f36,f37,f38,f39,f40,f41,f42,f43,f44,f45,f46,f47,f48,f49,f50,f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65,f66,f67,f68,f69,f70,f71,f72,f73,f74,f75,f76,f77,f78,f79,f80,f81,f82,f83,f84,f85,f86,f87,f88,f89,f90,f91,f92,f93,f94,f95,f96,f97,f98,f99,f100';
      const response = await fetch(url, { mode: 'cors' });
      const data = await response.json();
      if (data.data && data.data.diff) {
        return data.data.diff.map(item => ({
          name: item.f14,
          code: item.f12,
          price: item.f2,
          change: item.f3,
          volume: item.f5,
          amount: item.f6,
          heat: Math.abs(item.f3) + (item.f5 / 1000000)
        })).sort((a, b) => b.heat - a.heat).slice(0, 20);
      }
      return null;
    } catch (e) {
      console.warn('行业数据获取失败:', e);
      return null;
    }
  }

  // A股大盘指数数据
  async function fetchMarketIndexData() {
    // 上证指数、深证成指、创业板指、科创50、沪深300、上证50、中证500
    const indexList = [
      { secid: '1.000001', name: '上证指数' },
      { secid: '0.399001', name: '深证成指' },
      { secid: '0.399006', name: '创业板指' },
      { secid: '1.000688', name: '科创50' },
      { secid: '1.000300', name: '沪深300' },
      { secid: '1.000016', name: '上证50' },
      { secid: '1.000905', name: '中证500' }
    ];

    const results = [];

    for (const idx of indexList) {
      try {
        const url = 'https://push2.eastmoney.com/api/qt/stock/get?secid=' + idx.secid + '&fields=f43,f57,f58,f60,f169,f170';
        const response = await fetch(url, { mode: 'cors', headers: { 'Referer': 'https://quote.eastmoney.com/' } });
        const data = await response.json();
        if (data && data.data && data.data.f43) {
          const d = data.data;
          results.push({
            code: d.f57 || idx.secid.split('.')[1],
            name: idx.name,
            price: d.f43 / 100,
            change: d.f170 / 100,
            changeAmount: d.f169 / 100
          });
        }
      } catch (e) {
        console.warn(idx.name + '获取失败:', e);
      }
    }

    return results;
  }

  function renderMarketIndex(indexList) {
    const container = document.getElementById('marketIndexList');
    if (!container) return;

    if (!indexList || indexList.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding:1.5rem;"><div style="font-size:0.85rem;color:var(--muted);">暂无数据</div></div>';
      return;
    }

    container.innerHTML = indexList.map(idx => {
      const changeClass = idx.change >= 0 ? 'up' : 'down';
      const changeSign = idx.change >= 0 ? '+' : '';
      return '<div class="index-card">' +
        '<div class="index-name">' + idx.name + '</div>' +
        '<div class="index-value ' + changeClass + '">' + formatNumber(idx.price) + '</div>' +
        '<div class="index-change ' + changeClass + '">' + changeSign + formatNumber(idx.change) + '% (' + changeSign + formatNumber(idx.changeAmount) + ')</div>' +
      '</div>';
    }).join('');

    // 更新时间徽章
    const badge = document.getElementById('indexUpdateBadge');
    if (badge) {
      const now = new Date();
      badge.textContent = '更新于 ' + now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
  }

  // 个股资金流向
  async function fetchMoneyFlow(code) {
    try {
      const secid = getSecid(code);
      const url = 'https://push2.eastmoney.com/api/qt/stock/fflow/kline/get?secid=' + secid + '&klt=101&lmt=5&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65';
      const response = await fetch(url, { mode: 'cors' });
      const data = await response.json();
      if (data.data && data.data.klines) {
        return data.data.klines.map(line => {
          const parts = line.split(',');
          return {
            date: parts[0],
            mainIn: parseFloat(parts[1]) / 10000,
            mainOut: parseFloat(parts[2]) / 10000,
            retailIn: parseFloat(parts[5]) / 10000,
            retailOut: parseFloat(parts[6]) / 10000
          };
        });
      }
      return null;
    } catch (e) {
      console.warn('资金流向获取失败:', e);
      return null;
    }
  }

  // 个股新闻（使用东方财富，仅返回真实数据）
  async function fetchStockNews(code) {
    try {
      const url = 'https://searchapi.eastmoney.com/api/suggest/get?input=' + code + '&type=14&count=5';
      const response = await fetch(url, { mode: 'cors' });
      const data = await response.json();
      // 若接口返回新闻数组则使用真实数据
      if (data && Array.isArray(data) && data.length > 0) {
        return data.map(function(item) {
          return {
            time: item.time || '',
            title: item.title || '',
            source: item.source || ''
          };
        }).filter(function(n) { return n.title; });
      }
      return [];
    } catch (e) {
      return [];
    }
  }

  // ==================== 估值分析 ====================
  function calcPercentile(current, history) {
    if (!history || history.length === 0) return 50;
    const sorted = history.slice().sort((a, b) => a - b);
    let count = 0;
    for (let i = 0; i < sorted.length; i++) { if (current >= sorted[i]) count++; }
    return Math.round((count / sorted.length) * 100);
  }

  function getAdvice(stock) {
    const pe = stock.pe;
    const pb = stock.pb;

    if (pe < 0 || !pe) {
      return { type: 'hold', text: '当前市盈率为负或数据缺失，公司可能处于亏损状态。历史估值走势及百分位需要真实历史数据支撑。', badge: '亏损/缺数据' };
    }
    return { type: 'hold', text: '当前市盈率 ' + formatNumber(pe) + '，市净率 ' + formatNumber(pb) + '。历史估值走势及百分位需要真实历史数据支撑，当前仅展示实时估值指标。', badge: '当前估值' };
  }

  // ==================== 渲染函数 ====================
  function renderWatchlist() {
    const container = document.getElementById('watchlist');
    if (!watchlist.length) {
      container.innerHTML = '<div class="empty-state" style="padding:1rem;"><div style="font-size:1.5rem;margin-bottom:0.5rem;">&#128221;</div><div style="font-size:0.85rem;">暂无自选股票<br>搜索并添加</div></div>';
      return;
    }
    container.innerHTML = watchlist.map((item, idx) => {
      const code = item.code;
      const displayName = item.name || code;
      const activeClass = (currentStock && currentStock.code === code) ? 'active' : '';
      return '<div class="watchlist-item ' + activeClass + '" onclick="window.selectStock(\'' + code + '\')">' +
        '<div><div class="wl-name">' + displayName + '</div><div class="wl-code">' + code + '</div></div>' +
        '<div style="text-align:right;"><div class="wl-price" id="wl-price-' + code + '">--</div><div class="wl-change" id="wl-change-' + code + '">--</div></div>' +
        '<button class="remove-btn" onclick="event.stopPropagation(); window.removeFromWatchlist(' + idx + ')">&#10005;</button>' +
      '</div>';
    }).join('');
    
    // 立即更新自选价格
    updateWatchlistPrices();
  }

  async function updateWatchlistPrices() {
    for (const item of watchlist) {
      const code = item.code;
      try {
        const data = await fetchSinaViaScript(code);
        if (data) {
          // 更新名称（如果API返回了更准确的名称）
          if (data.name && data.name !== item.name) {
            const cleanName = data.name.replace(/\s+/g, '');
            item.name = cleanName;
            NAME_TO_CODE[cleanName] = code;
            saveWatchlist(watchlist);
          }
          const priceEl = document.getElementById('wl-price-' + code);
          const changeEl = document.getElementById('wl-change-' + code);
          if (priceEl) {
            priceEl.textContent = formatNumber(data.price);
            priceEl.className = 'wl-price ' + getChangeClass(data.change);
          }
          if (changeEl) {
            changeEl.textContent = getChangeSign(data.change) + formatNumber(data.change) + '%';
            changeEl.className = 'wl-change ' + getChangeClass(data.change);
          }
        }
      } catch (e) { /* ignore */ }
    }
  }

  function renderSectorList(sectors) {
    const container = document.getElementById('sectorList');
    if (!sectors || !sectors.length) {
      container.innerHTML = '<div class="empty-state" style="padding:1rem;font-size:0.85rem;">加载中...</div>';
      return;
    }
    const maxHeat = Math.max(...sectors.map(s => Math.abs(s.change)));
    container.innerHTML = sectors.map((s, i) => {
      const barColor = s.change >= 0 ? 'linear-gradient(90deg, #ef4444, #dc2626)' : 'linear-gradient(90deg, #10b981, #059669)';
      return '<div class="sector-row">' +
        '<div class="sector-rank">' + (i + 1) + '</div>' +
        '<div class="sector-name">' + s.name + '</div>' +
        '<div class="sector-bar-wrap"><div class="sector-bar" style="width:' + (Math.abs(s.change) / maxHeat * 100) + '%;background:' + barColor + '"></div></div>' +
        '<div class="sector-pct ' + getChangeClass(s.change) + '">' + getChangeSign(s.change) + formatNumber(s.change) + '%</div>' +
      '</div>';
    }).join('');
  }

  async function renderStockPanel(stockCode, stockName) {
    try {
      const panel = document.getElementById('stockPanel');
      panel.innerHTML = '<div class="empty-state"><div class="skeleton" style="height:200px;width:100%;"></div><p style="margin-top:1rem;">正在加载实时数据...</p></div>';

      // 并行获取数据（每个请求单独catch，避免一个失败导致全部失败）
      const [realtimeData, moneyFlow, news] = await Promise.all([
        fetchStockRealtime(stockCode),
        fetchMoneyFlow(stockCode).catch(() => null),
        fetchStockNews(stockCode).catch(() => [])
      ]);

      if (!realtimeData) {
        // 即使数据加载失败，也设置currentStock，让用户可以添加到自选
        const cleanName = (stockName || stockCode).replace(/\s+/g, '');
        currentStock = { code: stockCode, name: cleanName };
        if (cleanName && /^\d{6}$/.test(stockCode)) {
          NAME_TO_CODE[cleanName] = stockCode;
        }
        panel.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#9888;</div><h3>实时数据加载失败</h3><p>股票代码 <strong>' + stockCode + '</strong> 暂无实时数据，可能原因：<br>1. 非交易时间（周末/节假日）<br>2. 该股票已停牌或退市<br>3. 网络连接异常<br>4. 代码格式不正确（请尝试输入6位数字代码）</p><p style="margin-top:1rem;color:var(--brand);">&#10003; 您仍可点击"加入自选"按钮将该股票加入自选列表</p></div>';
        return;
      }

      currentStock = { code: realtimeData.code || stockCode, name: (realtimeData.name || stockName).replace(/\s+/g, '') };
      // 确保名称映射表中有这只股票（便于后续自选列表显示名称）
      if (realtimeData.name) {
        const cleanName = realtimeData.name.replace(/\s+/g, '');
        NAME_TO_CODE[cleanName] = realtimeData.code || stockCode;
      }

    const advice = getAdvice(realtimeData);
    const pe = realtimeData.pe || 0;
    const pb = realtimeData.pb || 0;
    const marketCapStr = realtimeData.marketCap ? (realtimeData.marketCap / 100000000).toFixed(0) + '亿' : '--';

    const now = new Date();
    const updateTime = now.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

    let html = '<div class="stock-header">' +
      '<div class="stock-info"><h2>' + (realtimeData.name || stockName) + '</h2><div class="code">' + stockCode + ' | 实时行情 · 数据更新于 ' + updateTime + '</div></div>' +
      '<div class="stock-price">' +
        '<div class="price ' + getChangeClass(realtimeData.change) + '">' + formatNumber(realtimeData.price) + '</div>' +
        '<div class="change ' + getChangeClass(realtimeData.change) + '">' + getChangeSign(realtimeData.change) + formatNumber(realtimeData.change) + '% (' + getChangeSign(realtimeData.changeAmount) + formatNumber(realtimeData.changeAmount) + ')</div>' +
      '</div>' +
    '</div>';

    html += '<div class="metrics-grid">' +
      '<div class="metric-card"><div class="metric-label">市盈率 PE</div><div class="metric-value">' + (pe > 0 ? formatNumber(pe) : '亏损') + '</div><div class="metric-desc">实时估值</div></div>' +
      '<div class="metric-card"><div class="metric-label">市净率 PB</div><div class="metric-value">' + formatNumber(pb) + '</div><div class="metric-desc">实时估值</div></div>' +
      '<div class="metric-card"><div class="metric-label">总市值</div><div class="metric-value">' + marketCapStr + '</div><div class="metric-desc">流通市值</div></div>' +
      '<div class="metric-card"><div class="metric-label">换手率</div><div class="metric-value">' + (realtimeData.turnover ? formatNumber(realtimeData.turnover) + '%' : '--') + '</div><div class="metric-desc">今日成交</div></div>' +
      '<div class="metric-card"><div class="metric-label">最高</div><div class="metric-value">' + formatNumber(realtimeData.high) + '</div><div class="metric-desc">今日最高</div></div>' +
      '<div class="metric-card"><div class="metric-label">最低</div><div class="metric-value">' + formatNumber(realtimeData.low) + '</div><div class="metric-desc">今日最低</div></div>' +
      '<div class="metric-card"><div class="metric-label">今开</div><div class="metric-value">' + formatNumber(realtimeData.open) + '</div><div class="metric-desc">开盘价</div></div>' +
      '<div class="metric-card"><div class="metric-label">昨收</div><div class="metric-value">' + formatNumber(realtimeData.close) + '</div><div class="metric-desc">昨收盘价</div></div>' +
    '</div>';

    html += '<div class="advice-box ' + advice.type + '">' +
      '<div class="advice-title"><span class="badge badge-' + advice.type + '">' + advice.badge + '</span></div>' +
      '<div class="advice-text">' + advice.text + '</div>' +
    '</div>';

    html += '<div style="margin-top:1.5rem;"><div class="panel-header" style="margin-bottom:0.8rem;"><div class="panel-title">&#128200; 估值历史走势</div></div><div class="chart-note">历史估值走势需要真实历史数据支撑，当前仅展示实时估值指标。</div></div>';

    html += '<div style="margin-top:1.5rem;"><div class="panel-header" style="margin-bottom:0.8rem;"><div class="panel-title">&#128240; 相关资讯</div><span class="badge badge-info">实时</span></div><div class="news-list">' +
      (news || []).map(n => '<div class="news-item"><div class="news-time">' + n.time + '</div><div class="news-content"><div class="news-title">' + n.title + '</div><div class="news-source">' + n.source + '</div></div></div>').join('') +
    '</div></div>';

    html += '<div style="margin-top:1.5rem;"><div class="panel-header" style="margin-bottom:0.8rem;"><div class="panel-title">&#128176; 主力资金流向</div></div><div id="fundFlowChart" class="chart-container"></div></div>';

    panel.innerHTML = html;

    setTimeout(() => {
      try { renderFundFlowChart(moneyFlow); } catch(e) { console.warn('资金流向图表渲染失败:', e); }
    }, 50);
    } catch(e) {
      console.error('股票面板渲染失败:', e);
      const panel = document.getElementById('stockPanel');
      if (panel) {
        panel.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#9888;</div><h3>数据处理出错</h3><p>无法显示股票信息，请重试或搜索其他股票。<br><small style="color:#888;">错误：' + e.message + '</small></p></div>';
      }
    }
  }

  function renderFundFlowChart(flowData) {
    const el = document.getElementById('fundFlowChart');
    if (!el || typeof echarts === 'undefined') return;
    const chart = echarts.init(el, null, { renderer: 'svg' });

    if (!flowData || flowData.length === 0) {
      chart.setOption({
        graphic: {
          type: 'text',
          left: 'center',
          top: 'center',
          style: { text: '暂无资金流向数据', fontSize: 14, fill: '#94a3b8' }
        }
      });
      window.addEventListener('resize', () => chart.resize());
      return;
    }

    const days = flowData.map(d => d.date ? d.date.substring(5) : '');
    const mainIn = flowData.map(d => d.mainIn || 0);
    const mainOut = flowData.map(d => -(d.mainOut || 0));

    chart.setOption({
      animation: false,
      tooltip: { trigger: 'axis', appendToBody: true },
      legend: { data: ['主力净流入', '主力净流出'], textStyle: { color: '#94a3b8' } },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'category', data: days, axisLine: { lineStyle: { color: '#334155' } }, axisLabel: { color: '#94a3b8' } },
      yAxis: { type: 'value', name: '亿元', axisLine: { lineStyle: { color: '#334155' } }, axisLabel: { color: '#94a3b8' }, splitLine: { lineStyle: { color: '#1e293b' } } },
      series: [
        { name: '主力净流入', type: 'bar', stack: 'total', data: mainIn, itemStyle: { color: '#ef4444' } },
        { name: '主力净流出', type: 'bar', stack: 'total', data: mainOut, itemStyle: { color: '#10b981' } }
      ]
    });
    window.addEventListener('resize', () => chart.resize());
  }

  // ==================== 全局暴露函数 ====================
  let searchLock = false;
  window.searchStock = async function() {
    if (searchLock) return; // 防止重复触发
    const input = document.getElementById('stockInput').value.trim();
    if (!input) return;
    
    try {
      searchLock = true;
      let code = input;
      let displayName = input;
      // 如果是名称，查找对应代码
      if (NAME_TO_CODE[input]) {
        code = NAME_TO_CODE[input];
        displayName = input;
      } else if (!/^\d{6}$/.test(input)) {
        // 输入的不是6位数字代码，也不是已知名称，尝试通过新浪API搜索
        code = await searchStockCode(input);
        if (!code) {
          showToast('未找到 "' + input + '" 对应的股票，请尝试输入6位股票代码', 'warning');
          return;
        }
        displayName = input;
      } else {
        // 输入的是6位数字代码，尝试从映射表找名称
        const nameEntry = Object.keys(NAME_TO_CODE).find(k => NAME_TO_CODE[k] === code);
        if (nameEntry) displayName = nameEntry;
      }
      
      await renderStockPanel(code, displayName);
    } catch(e) {
      console.error('搜索出错:', e);
      showToast('搜索出错：' + e.message, 'error');
    } finally {
      searchLock = false;
    }
  };

  // ==================== AI 深度分析（打通后端多 Agent 引擎） ====================
  window.openAiReport = function() {
    if (!currentStock || !currentStock.code) {
      showToast('请先搜索并选择一只股票', 'warning');
      return;
    }
    // 必须经本地服务器访问，才能调用后端 /api/analyze 接口
    if (location.protocol === 'file:') {
      showToast('请通过本地服务器打开（双击 start-server.bat），否则无法调用 AI 分析引擎', 'warning');
      return;
    }
    const code = currentStock.code;
    const modal = document.getElementById('aiReportModal');
    const frame = document.getElementById('aiReportFrame');
    const loading = document.getElementById('aiReportLoading');
    if (!modal || !frame) return;
    loading.style.display = 'flex';
    frame.style.display = 'none';
    frame.src = '/api/analyze?code=' + encodeURIComponent(code);
    modal.style.display = 'flex';
  };

  window.closeAiReport = function() {
    const modal = document.getElementById('aiReportModal');
    const frame = document.getElementById('aiReportFrame');
    if (modal) modal.style.display = 'none';
    if (frame) frame.src = 'about:blank';
  };

  // iframe 加载完成隐藏 loading；点击遮罩关闭
  document.addEventListener('DOMContentLoaded', function() {
    const frame = document.getElementById('aiReportFrame');
    if (frame) {
      frame.addEventListener('load', function() {
        const loading = document.getElementById('aiReportLoading');
        if (loading) loading.style.display = 'none';
        frame.style.display = 'block';
      });
    }
    const modal = document.getElementById('aiReportModal');
    if (modal) {
      modal.addEventListener('click', function(e) {
        if (e.target === modal) window.closeAiReport();
      });
    }
  });

  window.addToWatchlist = function() {
    if (!currentStock) {
      showToast('请先搜索并选择一只股票', 'warning');
      return;
    }
    const code = currentStock.code;
    const name = currentStock.name || code;
    // 确保code是有效的6位数字代码
    if (!/^\d{6}$/.test(code)) {
      showToast('股票代码格式异常，请重新搜索该股票后再添加', 'error');
      return;
    }
    // 重新从localStorage读取最新数据（避免内存与存储不同步）
    watchlist = loadWatchlist();
    
    if (watchlist.some(item => item.code === code)) {
      showToast('该股票已在自选列表中', 'warning');
      return;
    }
    watchlist.push({ code: code, name: name });
    saveWatchlist(watchlist);
    renderWatchlist();
    // 高亮显示新添加的项
    setTimeout(() => {
      const newItem = document.querySelector('.watchlist-item.active');
      if (newItem) {
        newItem.style.transition = 'background 0.3s';
        newItem.style.background = 'rgba(239,68,68,0.3)';
        setTimeout(() => { newItem.style.background = ''; }, 1500);
      }
    }, 50);
    showToast('✓ 已成功添加「' + name + '」到自选股票！', 'success', 4000);
  };

  window.removeFromWatchlist = function(idx) {
    watchlist.splice(idx, 1);
    saveWatchlist(watchlist);
    renderWatchlist();
  };

  window.selectStock = async function(code) {
    const item = watchlist.find(i => i.code === code);
    const name = (item && item.name) || Object.keys(NAME_TO_CODE).find(k => NAME_TO_CODE[k] === code) || code;
    document.getElementById('stockInput').value = name.replace(/\s+/g, '');
    await renderStockPanel(code, name);
  };

  // 导出自选股（返回JSON字符串）
  window.exportWatchlist = function() {
    const data = JSON.stringify(watchlist, null, 2);
    // 复制到剪贴板
    if (navigator.clipboard) {
      navigator.clipboard.writeText(data).then(() => {
        showToast('✓ 自选股列表已复制到剪贴板');
      }).catch(() => {
        prompt('请复制以下自选股数据进行备份：', data);
      });
    } else {
      prompt('请复制以下自选股数据进行备份：', data);
    }
    return data;
  };

  // 导入自选股
  window.importWatchlist = function() {
    const input = prompt('请粘贴自选股备份数据：');
    if (!input) return;
    try {
      const data = JSON.parse(input);
      if (!Array.isArray(data)) throw new Error('格式错误');
      
      // 重新加载并合并
      const current = loadWatchlist();
      let added = 0;
      for (const item of data) {
        if (item && item.code && /^\d{6}$/.test(item.code)) {
          if (!current.some(i => i.code === item.code)) {
            current.push({ code: item.code, name: item.name || item.code });
            if (item.name) NAME_TO_CODE[item.name] = item.code;
            added++;
          }
        } else if (typeof item === 'string' && /^\d{6}$/.test(item)) {
          if (!current.some(i => i.code === item)) {
            const name = Object.keys(NAME_TO_CODE).find(k => NAME_TO_CODE[k] === item);
            current.push({ code: item, name: name || item });
            added++;
          }
        }
      }
      watchlist = current;
      saveWatchlist(watchlist);
      renderWatchlist();
      showToast('✓ 导入成功，新增 ' + added + ' 只股票');
    } catch(e) {
      showToast('导入失败：数据格式不正确', 'error');
    }
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
                if (item.name) NAME_TO_CODE[item.name] = item.code;
                added++;
              }
            } else if (typeof item === 'string' && /^\d{6}$/.test(item)) {
              if (!current.some(i => i.code === item)) {
                const name = Object.keys(NAME_TO_CODE).find(k => NAME_TO_CODE[k] === item);
                current.push({ code: item, name: name || item });
                added++;
              }
            }
          }
          watchlist = current;
          saveWatchlist(watchlist);
          renderWatchlist();
          showToast('✓ 导入成功，新增 ' + added + ' 只股票');
        } catch(err) {
          showToast('导入失败：文件格式不正确', 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // ==================== 交易时间判断 ====================
  function isTradingTime() {
    const now = new Date();
    const day = now.getDay(); // 0=周日, 6=周六
    if (day === 0 || day === 6) return false;

    const hour = now.getHours();
    const minute = now.getMinutes();
    const time = hour * 100 + minute; // 例如 930, 1130, 1300, 1500

    // A股交易时间：9:30-11:30, 13:00-15:00
    return (time >= 930 && time <= 1130) || (time >= 1300 && time <= 1500);
  }

  // ==================== 自动刷新 ====================
  function startRealtimeUpdate() {
    const tradingInterval = {
      index: 30000,   // 大盘走势：交易时间 30秒
      price: 60000,   // 自选股价：交易时间 60秒
      sector: 60000,  // 行业热度：交易时间 60秒
      panel: 60000    // 股票面板：交易时间 60秒
    };
    const closedInterval = 600000; // 非交易时间统一 10分钟

    const lastUpdate = {
      index: 0,
      price: 0,
      sector: 0,
      panel: 0
    };

    // 每10秒检查一次是否需要刷新
    setInterval(async () => {
      const now = Date.now();
      const inTrade = isTradingTime();

      // 大盘走势
      if (now - lastUpdate.index >= (inTrade ? tradingInterval.index : closedInterval)) {
        lastUpdate.index = now;
        try {
          const indexData = await fetchMarketIndexData();
          renderMarketIndex(indexData);
        } catch (e) {}
      }

      // 自选股价
      if (watchlist.length > 0 && now - lastUpdate.price >= (inTrade ? tradingInterval.price : closedInterval)) {
        lastUpdate.price = now;
        try { await updateWatchlistPrices(); } catch (e) {}
      }

      // 行业热度
      if (now - lastUpdate.sector >= (inTrade ? tradingInterval.sector : closedInterval)) {
        lastUpdate.sector = now;
        try {
          const sectors = await fetchSectorData();
          if (sectors) renderSectorList(sectors);
        } catch (e) {}
      }

      // 当前股票面板
      if (currentStock && currentStock.code && now - lastUpdate.panel >= (inTrade ? tradingInterval.panel : closedInterval)) {
        lastUpdate.panel = now;
        const panel = document.getElementById('stockPanel');
        if (panel && !panel.querySelector('.empty-state')) {
          try { await renderStockPanel(currentStock.code, currentStock.name); } catch (e) {}
        }
      }
    }, 10000);
  }

  // 初始化自选股数据（改进#6：统一 localStorage 单源，loadWatchlist 内完成初始化/迁移）
  function initWatchlistData() {
    watchlist = loadWatchlist();
  }

  // ==================== 国内及国际经济大新闻 ====================
  // 数据来源：东方财富 7×24 全球财经直播（聚合财联社、证券时报、华尔街见闻等主流媒体）
  // 由于纯前端无法直接访问微博/微信公众号等自媒体平台，这里通过该聚合源间接跟踪各主流财经媒体动态

  let macroNewsCache = [];        // 全部新闻缓存
  let macroNewsCursor = '';       // 分页游标（realSort）
  let currentNewsTab = 'all';     // 当前选中的分类
  let newsRefreshTimer = null;
  let newsDisplayLimit = 30;      // 当前显示条数（点击加载更多时增加）

  // 国际财经关键词（用于识别国际财经新闻，非财经国际新闻不纳入）
  const INTL_FINANCE_KEYWORDS = [
    '美联储','鲍威尔','美元指数','美股','纳斯达克','标普','道琼斯','欧央行','拉加德',
    '欧元区','英国央行','英镑','日本央行','日元','韩国央行','韩元',
    '俄央行','OPEC','欧佩克','原油','布油','黄金','白银','IMF','世界银行',
    'WTO','纳斯达克指数','日经指数','恒生指数','恒指','恒生科技','港股','中概股',
    '英伟达','特斯拉','苹果公司','微软','谷歌','亚马逊','Meta','OpenAI','加密货币',
    '比特币','以太坊','贸易战','关税','半导体出口','芯片法案','AI监管','大模型',
    '财报季','业绩预告','加息预期','降息预期','通胀率','CPI数据','PPI数据','失业率',
    '非农数据','GDP数据','经济衰退','金融危机','银行业危机',
    '德国股市','法国股市','意大利债市','加拿大央行','澳洲联储','印度央行','越南股市','新加坡金管局'
  ];

  // 国内财经关键词（用于识别国内财经新闻，非财经国内新闻不纳入）
  const DOMESTIC_FINANCE_KEYWORDS = [
    '央行','人民银行','潘功胜','国务院','发改委','财政部','证监会','金融监管总局',
    '外汇局','商务部','工信部','住建部','国资委','税务总局','海关总署','统计局',
    'A股','沪深','上证','深证','创业板','科创板','北证','北交所','新三板','两市',
    '人民币','离岸人民币','LPR','MLF','逆回购','降准','降息','加息','国债','地方债',
    '城投','房地产','楼市','房企','限购','房贷','保障房','新能源','光伏','锂电',
    '半导体','芯片','人工智能','AI','大模型','数据要素','数字经济','专精特新',
    '国企改革','央企','国企','REITs','沪深港通','北向','南向','融资融券','限售股',
    '解禁','回购','增持','减持','分红','注册制','IPO','退市','并购','重组',
    '财联社','证券时报','上海证券报','中国证券报','证券日报','华尔街见闻','中信证券',
    '涨停','跌停','涨跌幅','成交量','成交额','市值','估值','市盈率','市净率',
    '机构','券商','基金','私募','公募','保险','银行','理财','信托','资管',
    'GDP','CPI','PPI','PMI','通胀','通缩','经济增长','消费','投资','出口',
    '进出口','外贸','社融','M2','存款','贷款','利率','汇率',
    '比亚迪','宁德时代','贵州茅台','中国平安','招商银行','隆基','通威',
    '腾讯','阿里','美团','小米','京东','拼多多','百度','网易'
  ];

  // 非财经排除关键词（含这些关键词的新闻直接排除）
  // 改进#5（P4）：删除地缘/军事/大宗误杀词（乌克兰/俄罗斯/以色列/战争/导弹/霍尔木兹等），
  // 这类词可能同时出现在油价、黄金、大宗、军工等财经新闻中；仅保留纯非财经词。
  const EXCLUDE_KEYWORDS = [
    '火灾','地震','洪水','台风','暴雨','车祸','空难','沉船','爆炸','坍塌',
    '杀人','遇难','伤亡','失踪',
    '间谍','窃密','涉密',
    '疫情','传染病','病毒',
    '明星','娱乐','八卦','电影','综艺','选秀',
    '体育','足球','篮球','奥运会','世界杯',
    '高考','中考','考研',
    '旅游','美食','时尚','养生',
    '恐怖袭击','撞人','枪击','暗杀','自杀',
    '取消航班','航班取消','延误'
  ];

  // 政策类新闻关键词
  const POLICY_KEYWORDS = [
    '央行','人民银行','证监会','金融监管总局','发改委','财政部','国务院',
    '外汇局','商务部','工信部','住建部','国资委','税务总局','海关总署','统计局',
    '政策','新规','出台','发布','印发','通知','规定','办法','条例','方案',
    '监管','处罚','调查','立案','警示','指导意见','工作会议','国常会',
    '降准','降息','加息','LPR','MLF','逆回购','国债','地方债',
    '注册制','退市','IPO','再融资','减持新规','回购',
    '房地产政策','限购','限贷','公积金','房贷利率',
    '新能源补贴','产业政策','扶持','减税','降费'
  ];

  // 行业类新闻关键词（按行业分组）
  const INDUSTRY_KEYWORDS = [
    // 新能源
    '新能源','光伏','锂电','储能','新能源车','电动汽车','充电桩','氢能','风电','水电','核电',
    // 科技
    '半导体','芯片','集成电路','AI','人工智能','大模型','算力','数据中心','云计算','量子计算',
    '消费电子','手机','芯片产业链','光刻','EDA',
    // 医药
    '医药','创新药','CXO','医疗器械','疫苗','生物制药','中医药','医疗服务',
    // 消费
    '白酒','食品饮料','消费电子','家电','家居','纺织','服装','美妆','免税',
    // 金融地产
    '银行','保险','券商','基金','信托','房地产','物业','建材','家居',
    // 其他行业
    '军工','航天','航空','船舶','工程机械','化工','有色','钢铁','煤炭','石油',
    '农业','种业','养殖','渔业','林业',
    '传媒','游戏','影视','出版','教育','旅游酒店',
    '交通运输','快递','物流','港口','机场','航空',
    '通信','5G','6G','卫星','互联网','软件','信创',
    '环保','碳中和','碳达峰','绿色能源',
    '机器人','智能制造','工业母机','3D打印',
    // 行业通用
    '行业','板块','产业链','景气度','产能','供需','价格上涨','价格下跌'
  ];

  // 企业类新闻关键词
  const COMPANY_KEYWORDS = [
    '财报','业绩','营收','净利润','毛利率','净资产','ROE','市盈率','市净率',
    '上市','IPO','过会','聆讯','招股','发行','退市','摘牌',
    '并购','重组','收购','剥离','分拆','借壳',
    '增持','减持','回购','分红','配股','增发','可转债',
    '董事会','董事长','总经理','CEO','CFO','高管','股权','实控人',
    '签约','中标','订单','合作','战略','协议','战略合作',
    '新产品','发布','量产','下线','交付','投产','扩产',
    '亏损','盈利','预增','预减','扭亏','暴雷','风险提示',
    '控股集团','股份有限公司','有限公司','公司','企业'
  ];

  // 判断新闻是否为财经相关
  function isFinanceNews(item) {
    const fullText = item.title + ' ' + item.summary;
    
    // 先检查排除关键词
    for (const kw of EXCLUDE_KEYWORDS) {
      if (fullText.indexOf(kw) >= 0) return false;
    }
    
    // 再检查是否有财经关键词
    for (const kw of DOMESTIC_FINANCE_KEYWORDS) {
      if (fullText.indexOf(kw) >= 0) return true;
    }
    for (const kw of INTL_FINANCE_KEYWORDS) {
      if (fullText.indexOf(kw) >= 0) return true;
    }
    
    // 如果有stockList关联股票，也算财经新闻
    if (item.stockList && item.stockList.length > 0) return true;
    
    return false;
  }

  // 判断新闻分类（国内/国际/重要 + 政策/行业/企业 + 自选相关）
  function classifyNews(item) {
    const fullText = item.title + ' ' + item.summary;
    const tags = [];
    let isIntl = false;
    let isDomestic = false;
    let category = ''; // policy / industry / company

    // 国际财经
    for (const kw of INTL_FINANCE_KEYWORDS) {
      if (fullText.indexOf(kw) >= 0) { isIntl = true; break; }
    }
    // 国内财经
    for (const kw of DOMESTIC_FINANCE_KEYWORDS) {
      if (fullText.indexOf(kw) >= 0) { isDomestic = true; break; }
    }
    
    // 都没命中时默认国内（因为是A股看板，国内财经为主）
    if (!isIntl && !isDomestic) isDomestic = true;
    
    if (isIntl) tags.push('intl');
    if (isDomestic && !isIntl) tags.push('domestic');
    if (item.titleColor && item.titleColor !== 0) tags.push('urgent');

    // 内容分类：政策 > 企业 > 行业（优先级判断）
    let policyScore = 0;
    let companyScore = 0;
    let industryScore = 0;
    for (const kw of POLICY_KEYWORDS) {
      if (fullText.indexOf(kw) >= 0) policyScore++;
    }
    for (const kw of COMPANY_KEYWORDS) {
      if (fullText.indexOf(kw) >= 0) companyScore++;
    }
    for (const kw of INDUSTRY_KEYWORDS) {
      if (fullText.indexOf(kw) >= 0) industryScore++;
    }
    // 如果有stockList，偏向企业类
    if (item.stockList && item.stockList.length > 0) companyScore += 2;

    if (policyScore > 0 && policyScore >= companyScore && policyScore >= industryScore) {
      category = 'policy';
    } else if (companyScore > 0 && companyScore >= industryScore) {
      category = 'company';
    } else if (industryScore > 0) {
      category = 'industry';
    } else {
      // 默认企业类（因为大部分快讯都跟公司相关）
      category = 'company';
    }
    tags.push(category);

    // 判断是否与自选股相关
    let isWatchlistRelated = false;
    let relatedStockNames = [];
    if (typeof watchlist !== 'undefined' && watchlist && watchlist.length > 0) {
      for (const s of watchlist) {
        if (fullText.indexOf(s.name) >= 0) {
          isWatchlistRelated = true;
          relatedStockNames.push(s.name);
        }
      }
      // 也检查stockList
      if (item.stockList && item.stockList.length > 0) {
        for (const s of item.stockList) {
          const sname = (s.name || s.stockName || '').trim();
          if (!sname) continue; // 空名称跳过
          for (const ws of watchlist) {
            if (sname.indexOf(ws.name) >= 0 || ws.name.indexOf(sname) >= 0) {
              isWatchlistRelated = true;
              if (relatedStockNames.indexOf(ws.name) < 0) relatedStockNames.push(ws.name);
            }
          }
        }
      }
    }
    if (isWatchlistRelated) tags.push('watchlist');

    return { isIntl, isDomestic, category, isWatchlistRelated, relatedStockNames, tags };
  }

  // 生成新闻摘要（内容过长时截取前2句）
  function getNewsSummary(item) {
    if (!item.summary) return '';
    // 去掉标题前缀【xxx】
    let text = item.summary.replace(/^【[^】]+】/, '');
    // 按句号/问号/叹号分句
    const sentences = text.split(/[。！？\.\!\?]/).filter(s => s.trim());
    if (sentences.length <= 2) return text.trim();
    // 取前2句作为摘要
    return sentences.slice(0, 2).join('。') + '。';
  }

  // 渲染单条新闻（精简卡片，点击标题展开详情）
  function renderNewsItem(item, classify) {
    const tags = classify.tags || [];
    let itemClass = 'macro-news-item';
    if (tags.indexOf('urgent') >= 0 || (item.titleColor && item.titleColor !== 0)) itemClass += ' important';
    if (classify.isIntl) itemClass += ' intl';
    if (classify.isWatchlistRelated) itemClass += ' watchlist';

    // 显示标签：自选相关 > 重要 > 内容分类(政策/行业/企业) > 地域(国内/国际)
    const labels = { domestic: '国内', intl: '国际', urgent: '重要', policy: '政策', industry: '行业', company: '企业', watchlist: '★自选' };
    const displayTags = [];
    const displayOrder = ['watchlist', 'urgent', 'policy', 'industry', 'company', 'domestic', 'intl'];
    for (const t of displayOrder) {
      if (tags.indexOf(t) >= 0) {
        displayTags.push('<span class="macro-news-tag ' + t + '">' + labels[t] + '</span>');
      }
    }
    const tagsHtml = displayTags.join('');

    // 关联股票标签
    let stocksHtml = '';
    if (item.stockList && item.stockList.length > 0) {
      stocksHtml = '<div class="macro-news-stocks">' +
        item.stockList.slice(0, 4).map(s => {
          const name = s.name || s.stockName || '';
          return '<span class="macro-news-stock">' + name + '</span>';
        }).join('') + '</div>';
    }

    const timeStr = (item.showTime || '').substring(5);
    const newsId = 'news_' + (item.code || '');
    const summary = getNewsSummary(item);
    const fullText = (item.summary || '').replace(/^【[^】]+】/, '').trim();
    const isLong = fullText.length > 80;

    return '<div class="' + itemClass + '" data-news-id="' + newsId + '">' +
      '<div class="macro-news-head">' +
        '<div class="macro-news-title" onclick="toggleNewsDetail(this)" style="cursor:pointer;">' +
          '<span class="macro-news-arrow">&#9654;</span>' +
          (item.title || '').replace(/</g, '&lt;') +
        '</div>' +
        '<div class="macro-news-time">' + timeStr + '</div>' +
      '</div>' +
      '<div class="macro-news-detail" style="display:none;">' +
        '<div class="macro-news-detail-text">' + (fullText || summary || '暂无详情').replace(/</g, '&lt;') + '</div>' +
      '</div>' +
      '<div class="macro-news-footer">' +
        '<div class="macro-news-tags">' + tagsHtml + '</div>' +
        stocksHtml +
      '</div>' +
    '</div>';
  }

  // 抓取东方财富 7×24 全球财经直播
  async function fetchMacroNews() {
    try {
      const url = 'https://np-listapi.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=' + macroNewsCursor + '&pageSize=40&req_trace=stock_dashboard_' + Date.now();
      const resp = await fetch(url, { mode: 'cors' });
      if (!resp.ok) return null;
      const json = await resp.json();
      if (!json || !json.data || !json.data.fastNewsList) return null;
      return {
        items: json.data.fastNewsList,
        nextCursor: json.data.sortEnd || ''
      };
    } catch (e) {
      console.warn('宏观新闻抓取失败:', e);
      return null;
    }
  }

  // 按当前分类过滤并渲染新闻
  function renderMacroNews() {
    const container = document.getElementById('macroNewsList');
    if (!container) return;

    let filtered = macroNewsCache;
    // 按内容分类或地域分类过滤
    if (currentNewsTab === 'domestic') {
      filtered = macroNewsCache.filter(n => n._classify.isDomestic && !n._classify.isIntl);
    } else if (currentNewsTab === 'intl') {
      filtered = macroNewsCache.filter(n => n._classify.isIntl);
    } else if (currentNewsTab === 'urgent') {
      filtered = macroNewsCache.filter(n => (n.titleColor && n.titleColor !== 0));
    } else if (currentNewsTab === 'watchlist') {
      filtered = macroNewsCache.filter(n => n._classify.isWatchlistRelated);
    } else if (currentNewsTab === 'policy') {
      filtered = macroNewsCache.filter(n => n._classify.category === 'policy');
    } else if (currentNewsTab === 'industry') {
      filtered = macroNewsCache.filter(n => n._classify.category === 'industry');
    } else if (currentNewsTab === 'company') {
      filtered = macroNewsCache.filter(n => n._classify.category === 'company');
    }

    if (filtered.length === 0) {
      const labels = { domestic: '国内', intl: '国际', urgent: '重要', watchlist: '自选相关', policy: '政策', industry: '行业', company: '企业' };
      container.innerHTML = '<div class="empty-state" style="padding:2rem;"><div style="font-size:1.5rem;margin-bottom:0.5rem;">&#128240;</div><div style="font-size:0.85rem;color:var(--muted);">暂无' + (labels[currentNewsTab] || '') + '新闻快讯</div></div>';
      return;
    }

    // 排序：自选相关优先 > 重要 > 时间倒序
    filtered = [...filtered].sort((a, b) => {
      const aScore = (a._classify.isWatchlistRelated ? 100 : 0) + ((a.titleColor && a.titleColor !== 0) ? 50 : 0);
      const bScore = (b._classify.isWatchlistRelated ? 100 : 0) + ((b.titleColor && b.titleColor !== 0) ? 50 : 0);
      if (bScore !== aScore) return bScore - aScore;
      return (b.realSort || '').localeCompare(a.realSort || '');
    });

    // 显示前 newsDisplayLimit 条
    const display = filtered.slice(0, newsDisplayLimit);
    container.innerHTML = display.map(n => renderNewsItem(n, n._classify)).join('');

    // 加载更多提示
    if (filtered.length > newsDisplayLimit) {
      container.innerHTML += '<div class="macro-news-loadmore" onclick="loadMoreNews()">&#8595; 还有 ' + (filtered.length - newsDisplayLimit) + ' 条，点击加载更多</div>';
    }

    // 更新徽章
    const badge = document.getElementById('newsUpdateBadge');
    if (badge) {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      badge.textContent = '已更新 ' + hh + ':' + mm + ' · 共' + macroNewsCache.length + '条';
    }
  }

  // 切换新闻分类Tab
  window.switchNewsTab = function(btn, tab) {
    currentNewsTab = tab;
    newsDisplayLimit = 30; // 切换Tab时重置显示数量
    // 更新Tab高亮
    const panel = document.getElementById('macroNewsPanel');
    if (panel) {
      panel.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
    }
    renderMacroNews();
  };

  // 点击标题展开/收起新闻详情
  window.toggleNewsDetail = function(titleEl) {
    const item = titleEl.closest('.macro-news-item');
    if (!item) return;
    const detail = item.querySelector('.macro-news-detail');
    const arrow = titleEl.querySelector('.macro-news-arrow');
    if (!detail) return;
    const isOpen = detail.style.display !== 'none';
    if (isOpen) {
      detail.style.display = 'none';
      if (arrow) arrow.style.transform = 'rotate(0deg)';
      item.classList.remove('expanded');
    } else {
      detail.style.display = 'block';
      if (arrow) arrow.style.transform = 'rotate(90deg)';
      item.classList.add('expanded');
    }
  };

  // 加载更多新闻（增加显示数量，必要时拉取下一页）
  window.loadMoreNews = async function() {
    // 先增加显示数量
    newsDisplayLimit += 30;

    // 如果当前过滤后的数据不够显示，从API拉取更多
    let needFetch = false;
    let filtered = macroNewsCache;
    if (currentNewsTab === 'watchlist') {
      filtered = macroNewsCache.filter(n => n._classify.isWatchlistRelated);
    } else if (currentNewsTab === 'policy') {
      filtered = macroNewsCache.filter(n => n._classify.category === 'policy');
    } else if (currentNewsTab === 'industry') {
      filtered = macroNewsCache.filter(n => n._classify.category === 'industry');
    } else if (currentNewsTab === 'company') {
      filtered = macroNewsCache.filter(n => n._classify.category === 'company');
    } else if (currentNewsTab === 'urgent') {
      filtered = macroNewsCache.filter(n => (n.titleColor && n.titleColor !== 0));
    }

    if (filtered.length < newsDisplayLimit) {
      needFetch = true;
    }

    if (needFetch) {
      const result = await fetchMacroNews();
      if (result && result.items && result.items.length > 0) {
        let newCount = 0;
        for (const item of result.items) {
          if (!macroNewsCache.find(n => n.code === item.code) && isFinanceNews(item)) {
            item._classify = classifyNews(item);
            macroNewsCache.push(item);
            newCount++;
          }
        }
        macroNewsCursor = result.nextCursor || macroNewsCursor;
      }
    }

    renderMacroNews();
  };

  // 启动新闻自动刷新
  function startNewsAutoRefresh() {
    if (newsRefreshTimer) clearInterval(newsRefreshTimer);
    newsRefreshTimer = setInterval(async () => {
      await refreshMacroNews(true);
    }, 60000); // 60秒刷新一次
  }

  // 每天上午9点自动更新所有数据
  function scheduleDailyUpdate() {
    function getNext9amMs() {
      const now = new Date();
      const next = new Date(now);
      next.setHours(9, 0, 0, 0);
      if (next.getTime() <= now.getTime()) {
        next.setDate(next.getDate() + 1);
      }
      return next.getTime() - now.getTime();
    }

    setTimeout(async function runDaily() {
      showToast('🔔 每日数据更新中...', 'info', 3000);

      // 刷新自选股价格
      if (typeof updateWatchlistPrices === 'function') {
        try { await updateWatchlistPrices(); } catch(e) {}
      }

      // 刷新行业数据
      try {
        const sectors = await fetchSectorData();
        if (sectors) renderSectorList(sectors);
      } catch(e) {}

      // 刷新新闻
      await refreshMacroNews(true);

      showToast('✅ 每日数据已更新', 'success', 3000);

      // 安排下一天
      setTimeout(runDaily, 24 * 60 * 60 * 1000);
    }, getNext9amMs());
  }

  // 刷新新闻（保留重要消息）
  window.refreshNews = async function() {
    const btn = document.getElementById('newsRefreshBtn');
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = '0.5';
    }

    // 1. 先把重要消息保存下来
    const importantNews = macroNewsCache.filter(n => n.titleColor && n.titleColor !== 0);

    // 2. 拉取最新新闻
    const result = await fetchMacroNews();
    if (!result || !result.items || !result.items.length) {
      showToast('刷新失败，请稍后重试', 'error');
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
      return;
    }

    // 3. 用新数据重建缓存
    macroNewsCursor = result.nextCursor || '';
    const seen = new Set();
    const merged = [];

    // 先加入新的财经新闻
    for (const item of result.items) {
      if (!seen.has(item.code) && isFinanceNews(item)) {
        item._classify = classifyNews(item);
        merged.push(item);
        seen.add(item.code);
      }
    }

    // 4. 把重要消息加回去（如果不在新数据里）
    for (const item of importantNews) {
      if (!seen.has(item.code)) {
        merged.push(item);
        seen.add(item.code);
      }
    }

    // 排序：自选相关 > 重要 > 时间倒序
    merged.sort((a, b) => {
      const aScore = (a._classify.isWatchlistRelated ? 100 : 0) + ((a.titleColor && a.titleColor !== 0) ? 50 : 0);
      const bScore = (b._classify.isWatchlistRelated ? 100 : 0) + ((b.titleColor && b.titleColor !== 0) ? 50 : 0);
      if (bScore !== aScore) return bScore - aScore;
      return (b.realSort || '').localeCompare(a.realSort || '');
    });

    macroNewsCache = merged.slice(0, 200);
    newsDisplayLimit = 30;
    renderMacroNews();

    // 更新徽章
    const badge = document.getElementById('newsUpdateBadge');
    if (badge) {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      badge.textContent = '已更新 ' + hh + ':' + mm + ' · 共' + macroNewsCache.length + '条';
    }

    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    showToast('✓ 新闻已刷新，重要消息已保留', 'success', 2000);
  };

  // 刷新宏观新闻（增量更新）
  async function refreshMacroNews(silent) {
    const result = await fetchMacroNews();
    if (!result || !result.items || result.items.length === 0) {
      if (!silent) showToast('新闻抓取失败，请稍后重试', 'error');
      return;
    }
    // 重置游标，从最新开始
    macroNewsCursor = '';
    const merged = [];
    const seen = new Set();
    // 新数据优先（且只保留财经新闻）
    for (const item of result.items) {
      if (!seen.has(item.code) && isFinanceNews(item)) {
        item._classify = classifyNews(item);
        merged.push(item);
        seen.add(item.code);
      }
    }
    // 合并旧数据（保留历史）
    for (const old of macroNewsCache) {
      if (!seen.has(old.code)) {
        merged.push(old);
        seen.add(old.code);
      }
    }
    // 按时间倒序
    merged.sort((a, b) => (b.realSort || '').localeCompare(a.realSort || ''));
    // 最多保留200条
    macroNewsCache = merged.slice(0, 200);
    renderMacroNews();
  }

  // 初始化宏观新闻
  async function initMacroNews() {
    const container = document.getElementById('macroNewsList');
    if (!container) return;
    const result = await fetchMacroNews();
    if (!result || !result.items || result.items.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding:2rem;"><div style="font-size:1.5rem;margin-bottom:0.5rem;">&#9888;</div><div style="font-size:0.85rem;color:var(--muted);">新闻源暂时无法访问<br>稍后将自动重试</div></div>';
      // 60秒后重试
      setTimeout(initMacroNews, 60000);
      return;
    }
    // 过滤：只保留财经相关新闻
    const financeNews = result.items.filter(item => isFinanceNews(item));
    macroNewsCache = financeNews.map(item => {
      item._classify = classifyNews(item);
      return item;
    });
    macroNewsCache.sort((a, b) => (b.realSort || '').localeCompare(a.realSort || ''));
    macroNewsCursor = result.nextCursor || '';
    renderMacroNews();
    startNewsAutoRefresh();
  }

  // ==================== 初始化 ====================
  document.addEventListener('DOMContentLoaded', async function() {
    await initWatchlistData();
    renderWatchlist();

    // 初始化A股大盘走势
    const indexData = await fetchMarketIndexData();
    renderMarketIndex(indexData);

    // 初始化国内及国际经济大新闻（异步加载，不阻塞其他功能）
    initMacroNews();
    
    // 加载行业数据
    const sectors = await fetchSectorData();
    if (sectors) {
      renderSectorList(sectors);
    } else {
      // 使用默认数据
      renderSectorList([
        { name: '有色金属', change: 3.25 }, { name: '煤炭', change: 2.85 },
        { name: '石油石化', change: 1.85 }, { name: '公用事业', change: 1.25 },
        { name: '建筑装饰', change: 0.85 }, { name: '交通运输', change: 0.65 },
        { name: '银行', change: 0.45 }, { name: '食品饮料', change: 0.95 },
        { name: '非银金融', change: 1.55 }, { name: '家用电器', change: 0.45 }
      ]);
    }
    
    document.getElementById('stockInput').addEventListener('keypress', function(e) {
      if (e.key === 'Enter') window.searchStock();
    });
    
    startRealtimeUpdate();

    // 每天上午9点自动更新
    scheduleDailyUpdate();
  });

})();
