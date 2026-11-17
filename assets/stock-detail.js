/**
 * 股票详情页 - 第三级页面
 * 功能：显示股票详情和走势图（分时/日K/月K/年K）
 */

(function() {
  'use strict';

  // ==================== 变量 ====================
  let stockCode = '';
  let stockName = '';
  let currentChart = null;
  let currentType = 'minute';
  let realtimeData = null;
  let chartDataCache = {};

  // ==================== 工具函数 ====================
  function formatNumber(n) { return (n === null || n === undefined || isNaN(n)) ? '--' : n.toFixed(2); }
  function formatVolume(v) {
    if (!v || isNaN(v)) return '--';
    if (v >= 100000000) return (v / 100000000).toFixed(2) + '亿';
    if (v >= 10000) return (v / 10000).toFixed(2) + '万';
    return v.toString();
  }
  function formatAmount(v) {
    if (!v || isNaN(v)) return '--';
    if (v >= 100000000) return (v / 100000000).toFixed(2) + '亿';
    if (v >= 10000) return (v / 10000).toFixed(2) + '万';
    return v.toString();
  }
  function getChangeClass(c) { return c >= 0 ? 'up' : 'down'; }
  function getChangeSign(c) { return c >= 0 ? '+' : ''; }

  function getSecid(code) {
    if (!code) return '';
    if (code.startsWith('6')) return '1.' + code;
    if (code.startsWith('0') || code.startsWith('3')) return '0.' + code;
    if (code.startsWith('688') || code.startsWith('689')) return '1.' + code;
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
    toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3000);
  }

  // ==================== 获取URL参数 ====================
  function getUrlParam(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
  }

  // ==================== 获取实时数据 ====================
  async function fetchRealtimeData(code) {
    try {
      const secid = getSecid(code);
      const url = 'https://push2.eastmoney.com/api/qt/stock/get?secid=' + secid + '&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f162,f167,f168,f169,f170';
      const response = await fetch(url, { mode: 'cors', headers: { 'Referer': 'https://quote.eastmoney.com/' } });
      const data = await response.json();
      if (data && data.data && data.data.f43) {
        const d = data.data;
        return {
          code: d.f57 || code,
          name: (d.f58 || code).replace(/\s+/g, ''),
          price: d.f43 / 100,
          open: d.f46 / 100,
          close: (d.f60 || 0) / 100,
          high: d.f44 / 100,
          low: d.f45 / 100,
          volume: d.f47 || 0,
          amount: d.f48 || 0,
          change: d.f170 / 100,
          changeAmount: d.f169 / 100,
          pe: (d.f162 || 0) / 100,
          pb: (d.f167 || 0) / 100,
          turnover: (d.f168 || 0) / 100
        };
      }
    } catch (e) {
      console.warn('实时数据获取失败:', e);
    }
    return null;
  }

  // ==================== 获取K线数据 ====================
  async function fetchKlineData(code, klt, lmt) {
    try {
      const secid = getSecid(code);
      const url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + secid + '&klt=' + klt + '&fqt=1&lmt=' + lmt + '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61';
      const response = await fetch(url, { mode: 'cors', headers: { 'Referer': 'https://quote.eastmoney.com/' } });
      const data = await response.json();
      if (data && data.data && data.data.klines && data.data.klines.length > 0) {
        return data.data.klines.map(line => {
          const parts = line.split(',');
          return {
            date: parts[0],
            open: parseFloat(parts[1]),
            close: parseFloat(parts[2]),
            high: parseFloat(parts[3]),
            low: parseFloat(parts[4]),
            volume: parseFloat(parts[5]),
            amount: parseFloat(parts[6])
          };
        });
      }
    } catch (e) {
      console.warn('K线数据获取失败:', e);
    }
    return null;
  }

  // ==================== 获取分时数据 ====================
  async function fetchMinuteData(code) {
    try {
      const secid = getSecid(code);
      const url = 'https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=' + secid + '&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58';
      const response = await fetch(url, { mode: 'cors', headers: { 'Referer': 'https://quote.eastmoney.com/' } });
      const data = await response.json();
      if (data && data.data && data.data.trends && data.data.trends.length > 0) {
        const preClose = data.data.preClose || 0;
        return {
          preClose: preClose,
          data: data.data.trends.map(line => {
            const parts = line.split(',');
            return {
              time: parts[0],
              price: parseFloat(parts[2]),
              avgPrice: parseFloat(parts[7]),
              volume: parseFloat(parts[5]),
              amount: parseFloat(parts[6])
            };
          })
        };
      }
    } catch (e) {
      console.warn('分时数据获取失败:', e);
    }
    return null;
  }

  // ==================== 渲染股票头部信息 ====================
  function renderStockHeader(data) {
    const header = document.getElementById('stockHeader');
    const changeClass = getChangeClass(data.change);
    const changeSign = getChangeSign(data.change);

    header.innerHTML =
      '<div class="stock-info">' +
        '<h1>' + data.name + '</h1>' +
        '<div class="stock-code">' + data.code + '</div>' +
      '</div>' +
      '<div class="stock-price">' +
        '<div class="price ' + changeClass + '">' + formatNumber(data.price) + '</div>' +
        '<div class="change ' + changeClass + '">' + changeSign + formatNumber(data.change) + '% (' + changeSign + formatNumber(data.changeAmount) + ')</div>' +
      '</div>';
  }

  // ==================== 渲染指标卡片 ====================
  function renderMetrics(data) {
    document.getElementById('metricsGrid').style.display = 'grid';
    document.getElementById('mOpen').textContent = formatNumber(data.open);
    document.getElementById('mHigh').textContent = formatNumber(data.high);
    document.getElementById('mLow').textContent = formatNumber(data.low);
    document.getElementById('mClose').textContent = formatNumber(data.close);
    document.getElementById('mVolume').textContent = formatVolume(data.volume);
    document.getElementById('mAmount').textContent = formatAmount(data.amount);
    document.getElementById('mPE').textContent = data.pe > 0 ? formatNumber(data.pe) : '亏损';
    document.getElementById('mPB').textContent = formatNumber(data.pb);
  }

  // ==================== 渲染分时图 ====================
  function renderMinuteChart(minuteData) {
    const container = document.getElementById('chartContainer');
    if (!container || typeof echarts === 'undefined') return;

    if (currentChart) {
      currentChart.dispose();
    }

    currentChart = echarts.init(container, null, { renderer: 'svg' });

    const times = minuteData.data.map(d => d.time.substring(8, 10) + ':' + d.time.substring(10, 12));
    const prices = minuteData.data.map(d => d.price);
    const avgPrices = minuteData.data.map(d => d.avgPrice);
    const preClose = minuteData.preClose;

    const upColor = '#ef4444';
    const downColor = '#10b981';

    const option = {
      animation: false,
      tooltip: {
        trigger: 'axis',
        appendToBody: true,
        backgroundColor: 'rgba(30,41,59,0.95)',
        borderColor: '#334155',
        textStyle: { color: '#f1f5f9' },
        axisPointer: { type: 'cross' },
        formatter: function(params) {
          if (!params || !params.length) return '';
          const p = params[0];
          return '<div style="font-weight:600;margin-bottom:4px;">' + p.axisValue + '</div>' +
                 '<div>价格: <b>' + p.value + '</b></div>' +
                 '<div>涨跌幅: <b>' + (preClose ? ((p.value - preClose) / preClose * 100).toFixed(2) + '%' : '--') + '</b></div>';
        }
      },
      grid: {
        left: '3%',
        right: '3%',
        bottom: '10%',
        top: '8%',
        containLabel: true
      },
      xAxis: {
        type: 'category',
        data: times,
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: { color: '#94a3b8', fontSize: 11 },
        splitLine: { show: false }
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: {
          color: '#94a3b8',
          fontSize: 11,
          formatter: function(value) {
            if (preClose) {
              const pct = ((value - preClose) / preClose * 100).toFixed(2);
              return value + '\n(' + (pct >= 0 ? '+' : '') + pct + '%)';
            }
            return value;
          }
        },
        splitLine: { lineStyle: { color: '#1e293b', type: 'dashed' } }
      },
      series: [
        {
          name: '价格',
          type: 'line',
          data: prices,
          smooth: true,
          lineStyle: { color: '#ef4444', width: 1.5 },
          itemStyle: { color: '#ef4444' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(239,68,68,0.25)' },
                { offset: 1, color: 'rgba(239,68,68,0.02)' }
              ]
            }
          },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: '#64748b', type: 'dashed', width: 1 },
            data: [{ yAxis: preClose, label: { formatter: '昨收 ' + preClose, color: '#64748b', fontSize: 11 } }]
          }
        },
        {
          name: '均价',
          type: 'line',
          data: avgPrices,
          smooth: true,
          lineStyle: { color: '#f59e0b', width: 1, type: 'dashed' },
          itemStyle: { color: '#f59e0b' },
          showSymbol: false
        }
      ]
    };

    currentChart.setOption(option);
  }

  // ==================== 渲染K线图 ====================
  function renderKlineChart(klineData, title) {
    const container = document.getElementById('chartContainer');
    if (!container || typeof echarts === 'undefined') return;

    if (currentChart) {
      currentChart.dispose();
    }

    currentChart = echarts.init(container, null, { renderer: 'svg' });

    const dates = klineData.map(d => d.date);
    const ohlc = klineData.map(d => [d.open, d.close, d.low, d.high]);
    const volumes = klineData.map(d => d.volume);
    const colors = klineData.map(d => d.close >= d.open ? '#ef4444' : '#10b981');

    const upColor = '#ef4444';
    const downColor = '#10b981';

    const option = {
      animation: false,
      tooltip: {
        trigger: 'axis',
        appendToBody: true,
        backgroundColor: 'rgba(30,41,59,0.95)',
        borderColor: '#334155',
        textStyle: { color: '#f1f5f9' },
        axisPointer: { type: 'cross' },
        formatter: function(params) {
          if (!params || !params.length) return '';
          const k = klineData[params[0].dataIndex];
          if (!k) return '';
          const change = k.close - k.open;
          const changePct = k.open > 0 ? (change / k.open * 100).toFixed(2) : '0';
          return '<div style="font-weight:600;margin-bottom:6px;">' + k.date + '</div>' +
                 '<div style="display:grid;grid-template-columns:auto auto;gap:4px 12px;">' +
                   '<span>开盘:</span><b>' + k.open.toFixed(2) + '</b>' +
                   '<span>收盘:</span><b>' + k.close.toFixed(2) + '</b>' +
                   '<span>最高:</span><b style="color:' + upColor + ';">' + k.high.toFixed(2) + '</b>' +
                   '<span>最低:</span><b style="color:' + downColor + ';">' + k.low.toFixed(2) + '</b>' +
                   '<span>涨跌:</span><b style="color:' + (change >= 0 ? upColor : downColor) + ';">' + (change >= 0 ? '+' : '') + change.toFixed(2) + ' (' + (change >= 0 ? '+' : '') + changePct + '%)</b>' +
                   '<span>成交量:</span><b>' + formatVolume(k.volume) + '</b>' +
                 '</div>';
        }
      },
      axisPointer: {
        link: [{ xAxisIndex: 'all' }]
      },
      grid: [
        {
          left: '3%',
          right: '3%',
          top: '8%',
          height: '55%',
          containLabel: true
        },
        {
          left: '3%',
          right: '3%',
          top: '72%',
          height: '18%',
          containLabel: true
        }
      ],
      xAxis: [
        {
          type: 'category',
          data: dates,
          gridIndex: 0,
          axisLine: { lineStyle: { color: '#334155' } },
          axisLabel: { show: false },
          splitLine: { show: false }
        },
        {
          type: 'category',
          data: dates,
          gridIndex: 1,
          axisLine: { lineStyle: { color: '#334155' } },
          axisLabel: { color: '#94a3b8', fontSize: 11 },
          splitLine: { show: false }
        }
      ],
      yAxis: [
        {
          type: 'value',
          scale: true,
          gridIndex: 0,
          axisLine: { lineStyle: { color: '#334155' } },
          axisLabel: { color: '#94a3b8', fontSize: 11 },
          splitLine: { lineStyle: { color: '#1e293b', type: 'dashed' } }
        },
        {
          type: 'value',
          scale: true,
          gridIndex: 1,
          axisLine: { lineStyle: { color: '#334155' } },
          axisLabel: { color: '#94a3b8', fontSize: 10, formatter: function(v) { return formatVolume(v); } },
          splitLine: { show: false }
        }
      ],
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: [0, 1],
          start: 0,
          end: 100
        }
      ],
      series: [
        {
          name: 'K线',
          type: 'candlestick',
          data: ohlc,
          xAxisIndex: 0,
          yAxisIndex: 0,
          itemStyle: {
            color: upColor,
            color0: downColor,
            borderColor: upColor,
            borderColor0: downColor
          }
        },
        {
          name: '成交量',
          type: 'bar',
          data: volumes.map((v, i) => ({ value: v, itemStyle: { color: colors[i] } })),
          xAxisIndex: 1,
          yAxisIndex: 1
        }
      ]
    };

    currentChart.setOption(option);
  }

  // ==================== 无数据提示 ====================
  function showNoDataChart(message) {
    const container = document.getElementById('chartContainer');
    if (!container || typeof echarts === 'undefined') return;
    if (currentChart) {
      currentChart.dispose();
    }
    currentChart = echarts.init(container, null, { renderer: 'svg' });
    currentChart.setOption({
      graphic: {
        type: 'text',
        left: 'center',
        top: 'center',
        style: {
          text: message || '暂无历史数据',
          fontSize: 14,
          fill: '#94a3b8'
        }
      }
    });
  }

  // ==================== 切换图表类型 ====================
  window.switchChart = async function(type) {
    currentType = type;

    // 更新按钮状态
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.type === type) btn.classList.add('active');
    });

    // 更新标题
    const titles = { minute: '分时走势', day: '日K线', month: '月K线', year: '年K线' };
    document.getElementById('chartTitle').textContent = titles[type] || '走势';

    // 显示加载状态
    if (currentChart) {
      currentChart.showLoading({ text: '加载中...', color: '#ef4444', textColor: '#94a3b8', maskColor: 'rgba(15,23,42,0.8)' });
    }

    try {
      if (type === 'minute') {
        // 分时图
        let minuteData = chartDataCache.minute;
        if (!minuteData) {
          minuteData = await fetchMinuteData(stockCode);
          if (!minuteData) {
            if (currentChart) currentChart.hideLoading();
            showNoDataChart('暂无分时数据');
            return;
          }
          chartDataCache.minute = minuteData;
        }
        if (currentChart) currentChart.hideLoading();
        renderMinuteChart(minuteData);
      } else {
        // K线图
        const kltMap = { day: 101, month: 103, year: 102 };
        const lmtMap = { day: 250, month: 120, year: 20 };
        const klt = kltMap[type] || 101;
        const lmt = lmtMap[type] || 250;

        let klineData = chartDataCache[type];
        if (!klineData) {
          klineData = await fetchKlineData(stockCode, klt, lmt);
          if (!klineData || klineData.length === 0) {
            if (currentChart) currentChart.hideLoading();
            showNoDataChart('暂无历史K线数据');
            return;
          }
          chartDataCache[type] = klineData;
        }
        if (currentChart) currentChart.hideLoading();
        renderKlineChart(klineData, titles[type]);
      }

      // 更新时间
      const now = new Date();
      document.getElementById('lastUpdate').textContent = '最后更新：' + now.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      console.error('图表渲染失败:', e);
      if (currentChart) currentChart.hideLoading();
      showToast('图表加载失败', 'error');
    }
  };

  // ==================== 初始化 ====================
  async function init() {
    // 获取URL参数
    stockCode = getUrlParam('code');
    stockName = getUrlParam('name') || stockCode;

    if (!stockCode || !/^\d{6}$/.test(stockCode)) {
      document.getElementById('stockHeader').innerHTML =
        '<div class="empty-state" style="width:100%;">' +
          '<div class="empty-state-icon">&#9888;</div>' +
          '<h3>股票代码无效</h3>' +
          '<p>请从自选股列表点击进入</p>' +
          '<a href="watchlist.html" style="display:inline-block;padding:0.7rem 1.5rem;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">返回自选股</a>' +
        '</div>';
      return;
    }

    // 设置面包屑
    document.getElementById('breadcrumbName').textContent = stockName || stockCode;
    document.title = stockName + ' - 股票详情 - A股智能分析看板';

    // 获取实时数据
    realtimeData = await fetchRealtimeData(stockCode);

    if (realtimeData) {
      stockName = realtimeData.name;
      document.getElementById('breadcrumbName').textContent = stockName;
      document.title = stockName + ' - 股票详情 - A股智能分析看板';
      renderStockHeader(realtimeData);
      renderMetrics(realtimeData);
    } else {
      // 实时数据获取失败，显示基本信息
      document.getElementById('stockHeader').innerHTML =
        '<div class="stock-info">' +
          '<h1>' + stockName + '</h1>' +
          '<div class="stock-code">' + stockCode + '</div>' +
        '</div>' +
        '<div class="stock-price">' +
          '<div class="price">--</div>' +
          '<div class="change" style="color:var(--muted);">暂无实时数据</div>' +
        '</div>';
      document.getElementById('metricsGrid').style.display = 'grid';
    }

    // 初始化图表（默认分时）
    chartDataCache = {};
    await switchChart('minute');

    // 响应式调整
    window.addEventListener('resize', () => {
      if (currentChart) currentChart.resize();
    });
  }

  // 页面加载完成后初始化
  document.addEventListener('DOMContentLoaded', init);

})();
