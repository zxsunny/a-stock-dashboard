# -*- coding: utf-8 -*-
"""
5人 Agent 股票分析团队 - 多 Agent 协作演示脚本

架构：
  🧑‍💼 研究主管（主脑）：任务编排 + 汇总裁决 + 最终评级
  ├── 🔢 估值分析师 ： DCF/PE/PB 历史分位 + 同行可比 + 目标价区间
  ├── 📊 财报分析师 ： 三表拆解 + ROE/毛利率/现金流 + 红黄牌预警
  ├── 🏭 产业策略师 ： 产业链/Porter五力/护城河/景气周期
  ├── 📈 市场信号官 ： MA/MACD/KDJ/量价/资金流 + 支撑压力位
  └── 🧨 逆向投资人： 空头视角，风险清单 + 黑天鹅 + 看空论据

运行方式：
    python multi_agent_stock_analysis.py 300433
    python multi_agent_stock_analysis.py 600519 300750 002594
"""

import json
import sys
import time
import datetime
import urllib.request
import urllib.parse
from typing import Dict, List, Any, Tuple
from dataclasses import dataclass, field, asdict
from tabulate import tabulate

# ============================================================
#  基础工具：多数据源回退层（优先 requests，降级 urllib）
# ============================================================
try:
    import requests as _requests  # type: ignore
    _HAS_REQUESTS = True
except ImportError:
    _HAS_REQUESTS = False

HEADERS_EM = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": "https://quote.eastmoney.com/",
}
HEADERS_QQ = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Referer": "https://gu.qq.com/",
}


_REQ_SESSION = None


def _session() -> Any:
    """为 requests 建立独立 Session，关闭连接复用，避免被反爬断掉的 socket 污染后续请求"""
    global _REQ_SESSION
    if not _HAS_REQUESTS:
        return None
    if _REQ_SESSION is None:
        s = _requests.Session()
        s.headers.update({"Connection": "close"})  # 关键：关闭 keep-alive，不复用脏连接
        _REQ_SESSION = s
    return _REQ_SESSION


def _get(url: str, headers: Dict[str, str], timeout: int = 15) -> str:
    """requests 优先，urllib 回退。

    编码说明：腾讯 qt.gtimg.cn / web.ifzq.gtimg.cn 返回的是 GBK/GB18030 文本，
    requests 的 apparent_encoding 容易误判为 Shift-JIS（出现半角片假名），
    因此对腾讯域名强制使用 GBK 解码，其余域名走 apparent_encoding。
    """
    is_tencent = "gtimg.cn" in url
    if _HAS_REQUESTS:
        try:
            s = _session()
            r = s.get(url, headers=headers, timeout=timeout)
            raw = r.content
            if is_tencent:
                return raw.decode("gbk", errors="ignore")
            enc = r.apparent_encoding or "utf-8"
            return raw.decode(enc, errors="ignore")
        except Exception as e:
            print(f"  [数据层] requests 失败 {url[:70]}...: {type(e).__name__}: {e}，降级 urllib")
    try:
        h = dict(headers)
        h["Connection"] = "close"
        req = urllib.request.Request(url, headers=h)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            if is_tencent:
                return raw.decode("gbk", errors="ignore")
            enc = resp.headers.get_content_charset() or "utf-8"
            return raw.decode(enc, errors="ignore")
    except Exception as e2:
        print(f"  [数据层] urllib 失败: {type(e2).__name__}: {e2}")
        raise


def _fetch_jsonp(url: str, headers: Dict[str, str] | None = None, timeout: int = 10) -> Any:
    try:
        body = _get(url, headers or HEADERS_EM, timeout)
        start = body.find("(")
        end = body.rfind(")")
        if start != -1 and end != -1:
            body = body[start + 1:end]
        return json.loads(body)
    except Exception as e:
        print(f"  [数据层] JSONP请求失败 {url[:60]}...: {e}")
        return None


def code_to_secid(code: str) -> str:
    """股票代码 -> 东方财富 secid（如 600519 -> 1.600519 / 300433 -> 0.300433）"""
    code = code.strip()
    if code.startswith(("6", "5")):
        return f"1.{code}"
    return f"0.{code}"


def code_to_qq(code: str) -> str:
    """股票代码 -> 腾讯 qt 代码（如 600519 -> sh600519 / 300433 -> sz300433）"""
    code = code.strip()
    if code.startswith(("6", "5")):
        return f"sh{code}"
    return f"sz{code}"


# ============================================================
#  数据采集：行情 / 估值指标 / K线（技术面）/ 财务摘要
# ============================================================
@dataclass
class StockRawData:
    code: str
    name: str = ""
    # 实时行情
    price: float = 0.0        # 最新价
    change_pct: float = 0.0   # 涨跌幅
    pe_ttm: float = 0.0       # PE-TTM
    pb: float = 0.0           # PB
    total_mv: float = 0.0     # 总市值（亿元）
    turnover: float = 0.0     # 换手率 %
    volume: float = 0.0       # 成交量（手）
    amount: float = 0.0       # 成交额（元）
    high: float = 0.0
    low: float = 0.0
    open_p: float = 0.0
    prev_close: float = 0.0
    # 财务摘要（F10）
    revenue: List[float] = field(default_factory=list)   # 近 4 期营收（亿）
    net_profit: List[float] = field(default_factory=list)  # 近 4 期归母净利（亿）
    gross_margin: float = 0.0     # 毛利率 %
    net_margin: float = 0.0       # 净利率 %
    roe: float = 0.0              # ROE %
    debt_ratio: float = 0.0       # 资产负债率 %
    report_dates: List[str] = field(default_factory=list)
    # 技术指标（从 K 线计算）
    ma5: float = 0.0
    ma10: float = 0.0
    ma20: float = 0.0
    ma60: float = 0.0
    rsi14: float = 0.0
    macd_dif: float = 0.0
    macd_dea: float = 0.0
    macd_bar: float = 0.0
    kdj_k: float = 50.0
    kdj_d: float = 50.0
    kdj_j: float = 50.0
    position_60d: float = 50.0   # 60 日位置百分位 0~100
    high_60d: float = 0.0
    low_60d: float = 0.0


def fetch_realtime(data: StockRawData):
    """实时行情 + 估值指标（三重回退：腾讯 qt -> EM push2批量 -> EM push2单股）"""
    ok = False

    # ===== 方案 1: 腾讯 qt.gtimg.cn（最稳，字段完整） =====
    try:
        qq_code = code_to_qq(data.code)
        url = f"https://qt.gtimg.cn/q={qq_code}"
        prefix = f'v_{qq_code}="'
        body = _get(url, HEADERS_QQ, timeout=8)
        # 形如 v_sz300433="51~蓝思科技~300433~34.82~35.09~...~53.44~~35.58~34.24~3.82~1730.45~1838.06~3.52~..."
        p = body.find(prefix)
        if p != -1:
            q = body.find('"', p + len(prefix))
            if q != -1:
                inner_raw = body[p + len(prefix):q]
                # 腾讯接口返回全角波浪号的兼容（旧服务器可能返回）
                import re as _re
                inner = _re.sub(r"[\u203e\uff5e]", "~", inner_raw)
                f = inner.split("~")
                # 腾讯行情字段（按实际 88 字段样本校准，2026-08-06）:
                #   1=名称  2=代码  3=现价  4=昨收  5=今开  6=成交量(手)
                #  31=涨跌额  32=涨跌幅%  33=最高  34=最低
                #  38=换手率%  35="价格/手/万"（显示文本）  37=成交额(万元)
                #  39=PE(显示值)   44=流通市值(亿)  45=总市值(亿)  46=PB
                #  52=动态PE  53=静态PE  （二者取正数中较小者作为最终PE）
                def _f(i, default=0.0):
                    try:
                        return float(f[i])
                    except (IndexError, TypeError, ValueError):
                        return default
                if len(f) > 3:
                    data.name = f[1] or data.name
                    data.price = _f(3)
                    data.prev_close = _f(4)
                    data.open_p = _f(5)
                    data.volume = _f(6)
                    if len(f) > 34:
                        data.high = _f(33)
                        data.low = _f(34)
                    if len(f) > 32:
                        data.change_pct = _f(32)
                    if len(f) > 38:
                        data.turnover = _f(38)
                    # PE：优先用 [39]（腾讯显示的动态PE），次选 [53] 静态PE
                    if len(f) > 53:
                        pe_opts = [x for x in (_f(39), _f(53), _f(52)) if 0 < x < 5000]
                        if pe_opts:
                            data.pe_ttm = min(pe_opts)
                    elif len(f) > 39:
                        pe = _f(39)
                        if 0 < pe < 5000:
                            data.pe_ttm = pe
                    if len(f) > 46:
                        data.total_mv = _f(45) if _f(45) > 0 else _f(44)
                        data.pb = _f(46)
                    # 成交额：腾讯 f[37] 是 万元，转换为 元
                    amt_wan = _f(37) if len(f) > 37 else 0.0
                    data.amount = amt_wan * 10000 if amt_wan > 0 else data.price * data.volume * 100
                    if data.price > 0:
                        ok = True
                        print(f"  [数据层] 行情(腾讯): {data.name}({data.code}) {data.price} {data.change_pct:+.2f}% "
                              f"PE={data.pe_ttm:.2f} PB={data.pb:.2f} 市值={data.total_mv:.0f}亿 (f_len={len(f)})")
    except Exception as e:
        import traceback
        print(f"  [数据层] 腾讯行情接口异常: {e}")
        traceback.print_exc()

    # ===== 方案 2: 东方财富 push2 批量接口（字段正常，仅 f9 为滚动PE） =====
    if not ok:
        try:
            secid = code_to_secid(data.code)
            url = (f"https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2"
                   f"&secids={secid}&fields=f2,f3,f4,f5,f6,f7,f9,f12,f14,f15,f16,f17,f18,f20,f23")
            obj = _fetch_jsonp(url, HEADERS_EM)
            if obj and obj.get("data") and obj["data"].get("diff"):
                d = obj["data"]["diff"][0]
                def _f2(k, default=0.0):
                    v = d.get(k, "-")
                    if v == "-" or v is None:
                        return default
                    try:
                        return float(v)
                    except (TypeError, ValueError):
                        return default
                data.name = d.get("f14", data.name)
                data.price = _f2("f2")
                data.change_pct = _f2("f3")
                data.volume = _f2("f5")
                data.amount = _f2("f6")
                data.turnover = _f2("f7")
                data.high = _f2("f15")
                data.low = _f2("f16")
                data.open_p = _f2("f17")
                data.prev_close = _f2("f18")
                pe = _f2("f9")
                if pe > 0:
                    data.pe_ttm = pe
                data.total_mv = _f2("f20") / 1e8
                data.pb = _f2("f23")
                if data.price > 0:
                    ok = True
                    print(f"  [数据层] 行情(EM批量): {data.name}({data.code}) {data.price} {data.change_pct:+.2f}% PE={data.pe_ttm:.2f} PB={data.pb:.2f}")
        except Exception as e:
            print(f"  [数据层] EM批量行情接口异常: {e}")

    # ===== 方案 3: 东方财富 push2 单股（兜底） =====
    if not ok:
        try:
            secid = code_to_secid(data.code)
            fields = "f2,f3,f4,f5,f6,f7,f15,f16,f17,f18,f9,f20,f23,f14"
            url = (f"https://push2.eastmoney.com/api/qt/stock/get"
                   f"?secid={secid}&fields={fields}&cb=cb")
            obj = _fetch_jsonp(url, HEADERS_EM)
            if obj and obj.get("data"):
                d = obj["data"]
                data.name = d.get("f14", data.name)
                def _f3(k, default=0.0):
                    v = d.get(k, "-")
                    if v == "-" or v is None:
                        return default
                    try:
                        return float(v)
                    except (TypeError, ValueError):
                        return default
                data.price = _f3("f2")
                data.change_pct = _f3("f3")
                data.volume = _f3("f5")
                data.amount = _f3("f6")
                data.turnover = _f3("f7")
                data.high = _f3("f15")
                data.low = _f3("f16")
                data.open_p = _f3("f17")
                data.prev_close = _f3("f18")
                pe = _f3("f9")
                if pe > 0:
                    data.pe_ttm = pe
                data.total_mv = _f3("f20") / 1e8
                data.pb = _f3("f23")
                if data.price > 0:
                    print(f"  [数据层] 行情(EM单股): {data.name}({data.code}) {data.price} {data.change_pct:+.2f}% PE={data.pe_ttm:.2f} PB={data.pb:.2f}")
        except Exception as e:
            print(f"  [数据层] EM单股行情接口异常: {e}")


def _ema(values: List[float], n: int) -> List[float]:
    if not values:
        return []
    k = 2.0 / (n + 1)
    ema = [values[0]]
    for v in values[1:]:
        ema.append(v * k + ema[-1] * (1 - k))
    return ema


def _sma(values: List[float], n: int, m: int) -> List[float]:
    if not values:
        return []
    y = [values[0]]
    for v in values[1:]:
        y.append((m * v + (n - m) * y[-1]) / n)
    return y


def fetch_klines_and_ta(data: StockRawData, count: int = 180):
    """日 K 线并计算 MA/RSI/MACD/KDJ/60 日位置（优先腾讯 ifzq 接口，稳定不封）"""
    closes = []
    highs = []
    lows = []
    ok = False

    # ===== 方案 1: 腾讯 ifzq 日K线接口 =====
    try:
        qq_code = code_to_qq(data.code)
        url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={qq_code},day,,,{count},qfq"
        body = _get(url, HEADERS_QQ, timeout=12)
        obj = json.loads(body)
        # 结构：{"data":{"sz300433":{"qfqday":[["2025-01-02", "22.00",...], ...]}}}
        if isinstance(obj, dict) and obj.get("data"):
            d = obj["data"]
            items = d.get(qq_code, {}) or {}
            day_arr = items.get("qfqday") or items.get("day") or []
            for row in day_arr:
                if isinstance(row, list) and len(row) >= 5:
                    try:
                        closes.append(float(row[2]))   # 收盘
                        highs.append(float(row[3]))    # 最高
                        lows.append(float(row[4]))     # 最低
                    except (TypeError, ValueError):
                        continue
            if len(closes) >= 20:
                ok = True
    except Exception as e:
        print(f"  [数据层] 腾讯K线接口异常: {e}")

    # ===== 方案 2: 东方财富 K线接口 (兜底) =====
    if not ok:
        try:
            secid = code_to_secid(data.code)
            url = (f"https://push2his.eastmoney.com/api/qt/stock/kline/get"
                   f"?secid={secid}&klt=101&fqt=1&lmt={count}&beg=0&end=20500101"
                   f"&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&cb=cb")
            obj = _fetch_jsonp(url, HEADERS_EM)
            if obj and obj.get("data") and obj["data"].get("klines"):
                klines = obj["data"]["klines"]
                closes, highs, lows = [], [], []
                for line in klines:
                    parts = line.split(",")
                    if len(parts) >= 6:
                        try:
                            closes.append(float(parts[2]))
                            highs.append(float(parts[3]))
                            lows.append(float(parts[4]))
                        except ValueError:
                            continue
                if len(closes) >= 20:
                    ok = True
        except Exception as e:
            print(f"  [数据层] EM K线接口异常: {e}")

    if not ok or len(closes) < 20:
        return
    if len(closes) < 20:
        return

    def ma(n):
        return sum(closes[-n:]) / n if len(closes) >= n else 0.0
    data.ma5 = ma(5)
    data.ma10 = ma(10)
    data.ma20 = ma(20)
    data.ma60 = ma(60)

    # RSI14
    if len(closes) >= 15:
        gains = []
        losses = []
        for i in range(1, len(closes)):
            delta = closes[i] - closes[i - 1]
            gains.append(max(delta, 0))
            losses.append(max(-delta, 0))
        recent_g = gains[-14:]
        recent_l = losses[-14:]
        avg_g = sum(recent_g) / 14
        avg_l = sum(recent_l) / 14
        rs = avg_g / avg_l if avg_l > 1e-9 else 100
        data.rsi14 = 100 - 100 / (1 + rs)

    # MACD
    ema12 = _ema(closes, 12)
    ema26 = _ema(closes, 26)
    dif = [e12 - e26 for e12, e26 in zip(ema12, ema26)]
    dea = _ema(dif, 9)
    data.macd_dif = dif[-1]
    data.macd_dea = dea[-1] if dea else 0.0
    data.macd_bar = 2 * (dif[-1] - dea[-1]) if dea else 0.0

    # KDJ
    if len(closes) >= 9:
        ks = []
        rsv = []
        for i in range(8, len(closes)):
            h9 = max(highs[i - 8:i + 1])
            l9 = min(lows[i - 8:i + 1])
            r = (closes[i] - l9) / (h9 - l9) * 100 if (h9 - l9) > 1e-9 else 50
            rsv.append(r)
        ks = _sma(rsv, 3, 1)
        ds = _sma(ks, 3, 1) if ks else []
        data.kdj_k = ks[-1] if ks else 50
        data.kdj_d = ds[-1] if ds else 50
        data.kdj_j = 3 * data.kdj_k - 2 * data.kdj_d

    # 60 日位置
    if len(closes) >= 10:
        recent = closes[-min(60, len(closes)):]
        hh = max(recent)
        ll = min(recent)
        data.high_60d = hh
        data.low_60d = ll
        if (hh - ll) > 1e-9:
            data.position_60d = (closes[-1] - ll) / (hh - ll) * 100


def fetch_financial_summary(data: StockRawData):
    """F10 财务摘要（优先东财数据中心，失败则用腾讯行情数据做降级估算）"""
    ok = False
    try:
        # 方案1: 东方财富"数据中心"业绩报表接口（免登录 / 公开 JSONP）
        # sortColumns=REPORT_DATE_DESC: 按报告日期倒序
        secid = code_to_secid(data.code)
        mkt = "SH" if secid.startswith("1.") else "SZ"
        url = (
            "https://datacenter-web.eastmoney.com/api/data/v1/get"
            "?callback=cb&sortColumns=REPORT_DATE&sortTypes=-1&pageSize=4&pageNumber=1"
            "&reportName=RPT_LICO_FN_CPD&columns=ALL"
            f"&filter=(SECURITY_CODE%3D%22{data.code}%22)"
        )
        obj = _fetch_jsonp(url, {
            **HEADERS_EM,
            "Referer": "https://data.eastmoney.com/",
            "Origin": "https://data.eastmoney.com",
        })
        rows = []
        if isinstance(obj, dict):
            res = obj.get("result") or {}
            rows = res.get("data") if isinstance(res, dict) else []
        if rows and isinstance(rows, list):
            for row in rows:
                if not isinstance(row, dict):
                    continue
                rd = (row.get("REPORT_DATE") or "")[:10]
                if rd:
                    data.report_dates.append(rd)
                def _g(k, div=1.0):
                    v = row.get(k)
                    if v is None or v == "-":
                        return 0.0
                    try:
                        return float(v) / div
                    except (TypeError, ValueError):
                        return 0.0
                data.revenue.append(_g("OPERATE_INCOME", 1e8))          # 营业收入
                data.net_profit.append(_g("PARENT_NETPROFIT", 1e8))    # 归母净利
                data.roe = max(data.roe, _g("ROE_WEIGHTAVG_BASIC"))   # 加权ROE
                data.gross_margin = max(data.gross_margin, _g("GROSS_PROFIT_RATIO"))  # 销售毛利率
                data.net_margin = max(data.net_margin, _g("NET_PROFIT_RATIO_YOY") if False else _g("SJLJZSY"))
                data.debt_ratio = max(data.debt_ratio, _g("DEBT_ASSET_RATIO"))
            if data.net_profit and sum(abs(x) for x in data.net_profit) > 1e-3:
                ok = True
                print(f"  [数据层] 财务(EM数据中心): 毛利率 {data.gross_margin:.1f}%  ROE {data.roe:.1f}%  "
                      f"近{len(data.net_profit)}期净利 {[f'{x:.2f}亿' for x in data.net_profit]}")
    except Exception as e:
        print(f"  [数据层] EM数据中心财务异常: {e}")

    if not ok:
        # ===== 降级方案：用 腾讯行情里的 PE / 总市值 反推年化净利润 =====
        try:
            if data.total_mv > 0 and data.pe_ttm > 0:
                annual_np = data.total_mv / data.pe_ttm  # 亿
                # 拆成 4 期（最近两期各占 30%，前两期各占 20%）
                data.net_profit = [annual_np * w for w in (0.20, 0.20, 0.30, 0.30)]
                data.revenue = [annual_np * w * (1 / max(0.01, data.net_margin / 100 if data.net_margin > 0 else 0.10))
                                for w in (0.20, 0.20, 0.30, 0.30)]
                today = datetime.date.today()
                for i in range(4):
                    d = today - datetime.timedelta(days=90 * (3 - i))
                    data.report_dates.append(d.isoformat())
                # 若 ROE 为 0，通过 ROE ≈ 净利/净资产 估算一个近似值
                if data.roe <= 0 and data.pb > 0:
                    # PB = 市值/净资产，净资产 = 市值/PB；ROE ≈ 净利*100/净资产
                    equity = data.total_mv / data.pb
                    if equity > 0:
                        data.roe = annual_np * 100 / equity
                print(f"  [数据层] 财务(降级估算): PE={data.pe_ttm:.2f} 市值={data.total_mv:.0f}亿  "
                      f"年化净利≈{annual_np:.2f}亿  ROE≈{data.roe:.1f}%")
            else:
                print(f"  [数据层] 财务(降级估算): 无法计算（PE或总市值缺失）。当前毛利率={data.gross_margin:.1f}% ROE={data.roe:.1f}%")
        except Exception as e2:
            print(f"  [数据层] 财务降级估算异常: {e2}")


def load_all_data(code: str) -> StockRawData:
    raw = StockRawData(code=code)
    fetch_realtime(raw)
    fetch_klines_and_ta(raw)
    fetch_financial_summary(raw)
    return raw


# ============================================================
#  Agent 角色基类
# ============================================================
@dataclass
class AgentOutput:
    role: str
    score: int                  # 本维度 0~10 打分
    conclusions: List[str]      # 核心结论（3~5 条）
    bull_points: List[str]      # 支持多头的论据
    bear_points: List[str]      # 支持空头的论据
    extra: Dict[str, Any] = field(default_factory=dict)  # 角色专属数据


def print_role_header(role: str, emoji: str):
    ts = datetime.datetime.now().strftime("%H:%M:%S")
    print(f"\n{'='*64}\n [{ts}] {emoji} 【{role}】 开始分析 ...\n{'='*64}")


# ============================================================
#  Agent 1: 估值分析师 (Valuation Analyst)
# ============================================================
class ValuationAgent:
    NAME = "估值分析师"
    EMOJI = "🔢"

    def run(self, data: StockRawData) -> AgentOutput:
        print_role_header(self.NAME, self.EMOJI)
        pe = data.pe_ttm
        pb = data.pb
        mv = data.total_mv

        # PE 分位判断（简化规则，按行业档位：白酒/银行/科技等粗略归类）
        # 这里用绝对刻度：A 股历史 PE 中位数约 20x
        pe_score = 0
        pe_concl = ""
        if pe <= 0:
            pe_score, pe_concl = 5, "[数据缺失] PE 无法判断"
        elif pe <= 8:
            pe_score, pe_concl = 10, f"PE {pe:.1f}x 极度低估，典型红利股水平"
        elif pe <= 15:
            pe_score, pe_concl = 8, f"PE {pe:.1f}x 偏低，价值风格有安全边际"
        elif pe <= 30:
            pe_score, pe_concl = 6, f"PE {pe:.1f}x 合理区间"
        elif pe <= 55:
            pe_score, pe_concl = 4, f"PE {pe:.1f}x 偏高，需成长兑现支撑"
        else:
            pe_score, pe_concl = 2, f"PE {pe:.1f}x 极高估，需警惕回调"

        # PB 估值
        pb_score = 5
        pb_concl = "[数据缺失] PB 无法判断"
        if pb > 0:
            if pb < 0.8:
                pb_score, pb_concl = 10, f"PB {pb:.2f}x 深度破净，资产折价显著"
            elif pb < 1.2:
                pb_score, pb_concl = 8, f"PB {pb:.2f}x 接近破净，估值便宜"
            elif pb < 3:
                pb_score, pb_concl = 6, f"PB {pb:.2f}x 合理"
            elif pb < 8:
                pb_score, pb_concl = 4, f"PB {pb:.2f}x 偏高"
            else:
                pb_score, pb_concl = 2, f"PB {pb:.2f}x 严重高估"

        # ROE 对 PB 的修正（高 ROE 能撑高 PB）
        if data.roe > 0 and pb > 0:
            pb_roe_ratio = pb / (data.roe / 10)  # 近似 PEG 风格
            if 0.8 <= pb_roe_ratio <= 2.0:
                pb_score = min(10, pb_score + 1)
                pb_concl += f"（PB-ROE 匹配良好）"
            elif pb_roe_ratio > 2.5:
                pb_score = max(0, pb_score - 1)
                pb_concl += f"（PB-ROE 略不匹配，PB相对ROE偏高）"

        # 目标价（PE 估值回归 + 相对估值法 + 安全边际约束）
        #   核心思路：不做绝对估值，改用相对当前价的合理区间
        #   对高 PE 成长股，用 PE 收缩空间 × 当前价 给出目标价
        if data.net_profit and data.price > 0 and mv > 0:
            pe_current = data.pe_ttm if data.pe_ttm > 0 else 20

            # ===== 方法 1：PE 回归法 =====
            # 行业合理 PE（科技成长 30-35x，价值周期 15-20x）
            # ROE 越高，行业 PE 允许越高
            industry_pe_high = 35 if data.roe > 8 else 25
            industry_pe_low = 20 if data.roe > 8 else 12

            if pe_current <= 0:
                # PE 无效，用 PB 估值
                tgt_cons = round(data.price * 0.85, 2)
                tgt_neu = round(data.price * 1.05, 2)
                tgt_opt = round(data.price * 1.25, 2)
            else:
                # 保守：PE 收缩 30%（从 49.5x 缩到 34.7x）
                pe_conservative = max(pe_current * 0.65, industry_pe_low)
                # 中性：PE 收缩 15%（从 49.5x 缩到 42x）
                pe_neutral = max(pe_current * 0.85, (industry_pe_high + industry_pe_low) / 2)
                # 乐观：PE 保持或小幅扩张（50x 左右，市场给高成长股溢价）
                # 高 ROE 股：PE 可以扩张；低 ROE 股：PE 至少保持不缩水
                pe_optimistic = max(pe_current * 1.03, industry_pe_high + 5)

                ratio_c = pe_conservative / pe_current
                ratio_n = pe_neutral / pe_current
                ratio_o = pe_optimistic / pe_current

                tgt_cons = round(data.price * ratio_c, 2)
                tgt_neu = round(data.price * ratio_n, 2)
                tgt_opt = round(data.price * ratio_o, 2)

            # ===== 方法 2：安全边际约束 =====
            # 不允许目标价偏离当前价超过 40%（否则模型本身不可信）
            # 保守目标价不低于当前价 * 0.6（最多 40% 回调）
            # 乐观目标价不高于当前价 * 1.5（最多 50% 上涨）
            tgt_conservative = max(tgt_cons, round(data.price * 0.60, 2))
            tgt_neutral = max(tgt_neu, round(data.price * 0.70, 2))
            tgt_optimistic = min(tgt_opt, round(data.price * 1.50, 2))

            # 如果保守目标价仍然高于当前价（低估值股），直接按 10%/20% 空间估算
            if tgt_conservative >= data.price:
                tgt_conservative = round(data.price * 1.10, 2)
                tgt_neutral = round(data.price * 1.20, 2)
                tgt_optimistic = round(data.price * 1.35, 2)
            # 如果中性目标价远低于当前价（>30% 折价），说明 PE 模型不适用
            # 改用"当前价 × 合理 PE / 当前 PE"的中间值
            elif tgt_neutral < data.price * 0.70:
                mid_pe = (pe_current + industry_pe_high) / 2
                tgt_neutral = round(data.price * mid_pe / pe_current, 2)
                tgt_conservative = round(tgt_neutral * 0.88, 2)
                tgt_optimistic = round(tgt_neutral * 1.18, 2)
        else:
            tgt_conservative = round(data.price * 0.9, 2)
            tgt_neutral = round(data.price * 1.05, 2)
            tgt_optimistic = round(data.price * 1.20, 2)

        score = round((pe_score * 0.5 + pb_score * 0.5))
        conclusions = [pe_concl, pb_concl,
                       f"目标价区间：保守 {tgt_conservative} / 中性 {tgt_neutral} / 乐观 {tgt_optimistic}"]
        bulls = []
        bears = []
        if pe_score >= 7: bulls.append(f"PE {pe:.1f}x 偏低/合理，估值安全边际充足")
        else: bears.append(f"PE {pe:.1f}x 偏高，估值天花板低")
        if pb_score >= 7: bulls.append(f"PB {pb:.2f}x 具备资产折价保护")
        else: bears.append(f"PB {pb:.2f}x 估值溢价较高")
        if tgt_conservative > 0 and data.price <= tgt_conservative * 1.05:
            bulls.append(f"当前价 {data.price:.2f} ≤ 保守目标价，安全边际充足")
        # "接近乐观目标价" 实际上是偏空信号（该卖了），归入空头
        if tgt_optimistic > 0 and data.price >= tgt_optimistic * 0.98:
            bears.append(f"当前价已接近乐观目标价 {tgt_optimistic:.2f}，短期向上空间有限")

        extra = {
            "targets": {
                "conservative": round(tgt_conservative, 2),
                "neutral": round(tgt_neutral, 2),
                "optimistic": round(tgt_optimistic, 2),
            },
            "fair_pe_used": pe_neutral if 'pe_neutral' in dir() else 20,
            "pe_current": round(pe_current, 2) if pe_current > 0 else 0,
        }
        out = AgentOutput(role=self.NAME, score=score, conclusions=conclusions,
                          bull_points=bulls, bear_points=bears, extra=extra)
        _print_output(out)
        return out


# ============================================================
#  Agent 2: 财报分析师 (Earnings Analyst)
# ============================================================
class EarningsAgent:
    NAME = "财报分析师"
    EMOJI = "📊"

    def run(self, data: StockRawData) -> AgentOutput:
        print_role_header(self.NAME, self.EMOJI)
        score = 5
        warnings = []
        good = []
        bad = []
        conclusions = []

        # 营收趋势
        if len(data.revenue) >= 2:
            latest_rev = data.revenue[-1]
            prev_rev = data.revenue[-2] if data.revenue[-2] > 1e-9 else latest_rev
            rev_growth = (latest_rev - prev_rev) / prev_rev * 100 if prev_rev > 0 else 0
            conclusions.append(f"营收同比 {rev_growth:+.1f}%（最新报告期）")
            if rev_growth >= 15:
                score += 2; good.append(f"营收强劲增长 +{rev_growth:.1f}%")
            elif rev_growth >= 0:
                score += 1; good.append(f"营收正增长 +{rev_growth:.1f}%")
            else:
                score -= 1; bad.append(f"营收萎缩 {rev_growth:.1f}%")

        # 净利润趋势
        if len(data.net_profit) >= 2:
            latest_np = data.net_profit[-1]
            prev_np = data.net_profit[-2] if abs(data.net_profit[-2]) > 1e-9 else latest_np
            sign = prev_np / abs(prev_np) if abs(prev_np) > 1e-9 else 1
            np_growth = (latest_np - prev_np) / (abs(prev_np) + 1e-6) * 100
            conclusions.append(f"归母净利同比 {np_growth:+.1f}%（最新报告期）")
            if sign > 0 and np_growth >= 20:
                score += 2; good.append(f"净利高速增长 +{np_growth:.1f}%")
            elif sign > 0 and np_growth >= 0:
                score += 1; good.append(f"净利稳健增长 +{np_growth:.1f}%")
            elif sign < 0 and latest_np > 0:
                score += 1; good.append(f"成功扭亏（扭亏为盈 {latest_np:.2f}亿）")
            else:
                score -= 2; bad.append(f"净利下滑 {np_growth:.1f}%")

        # ROE
        if data.roe > 0:
            conclusions.append(f"ROE = {data.roe:.1f}%")
            if data.roe >= 15:
                score += 2; good.append(f"ROE {data.roe:.1f}% 属优秀水平")
            elif data.roe >= 8:
                score += 1; good.append(f"ROE {data.roe:.1f}% 合格")
            elif data.roe >= 3:
                pass
            else:
                score -= 1; bad.append(f"ROE {data.roe:.1f}% 偏低，回报效率差")

        # 毛利率 & 净利率
        if data.gross_margin > 0:
            conclusions.append(f"毛利率 {data.gross_margin:.1f}% / 净利率 {data.net_margin:.1f}%")
            if data.gross_margin >= 40:
                score += 1; good.append(f"高毛利率 {data.gross_margin:.1f}%，品牌/技术溢价显著")
            elif data.gross_margin < 12:
                score -= 1; bad.append(f"低毛利率 {data.gross_margin:.1f}%，抗风险能力弱")

        # 资产负债率
        if data.debt_ratio > 0:
            conclusions.append(f"资产负债率 {data.debt_ratio:.1f}%")
            if data.debt_ratio >= 75:
                score -= 1; warnings.append(f"高负债 {data.debt_ratio:.1f}%（金融机构除外），注意信用风险")
                bad.append(f"负债偏高 {data.debt_ratio:.1f}%")
            elif data.debt_ratio <= 40:
                good.append(f"资产负债结构稳健 {data.debt_ratio:.1f}%")

        score = max(0, min(10, score))
        extra = {"warnings": warnings}
        out = AgentOutput(role=self.NAME, score=score, conclusions=conclusions + warnings,
                          bull_points=good, bear_points=bad, extra=extra)
        _print_output(out)
        return out


# ============================================================
#  Agent 3: 产业策略师 (Industry & Strategy)
# ============================================================
class IndustryAgent:
    NAME = "产业策略师"
    EMOJI = "🏭"

    # 股票代码 -> 行业 / 护城河 / 景气周期 的启发式映射（演示用）
    PROFILE = {
        "600519": {"industry": "白酒 / 消费", "moat": 10, "cycle_pos": 7, "theme": ["白酒提价", "行业筑底", "消费复苏"]},
        "300750": {"industry": "动力电池 / 新能源", "moat": 9, "cycle_pos": 9, "theme": ["储能爆发", "海外扩张", "技术路线领先"]},
        "002594": {"industry": "新能源汽车 / 智能制造", "moat": 8, "cycle_pos": 8, "theme": ["出口高增", "垂直整合", "智能化"]},
        "601318": {"industry": "保险 / 综合金融", "moat": 8, "cycle_pos": 5, "theme": ["NBV修复", "高股息", "利率企稳"]},
        "600036": {"industry": "银行 / 财富管理", "moat": 8, "cycle_pos": 5, "theme": ["财富管理龙头", "高股息防御", "息差收窄趋缓"]},
        "300433": {"industry": "消费电子 / AI硬件", "moat": 6, "cycle_pos": 7, "theme": ["折叠屏大年", "AI眼镜", "苹果链创新", "先进封装"]},
        "600667": {"industry": "半导体封装 / 工程服务", "moat": 5, "cycle_pos": 6, "theme": ["HBM先进封装", "AI算力基建", "工程总包周期性"]},
    }

    def run(self, data: StockRawData) -> AgentOutput:
        print_role_header(self.NAME, self.EMOJI)
        prof = self.PROFILE.get(data.code, {
            "industry": "一般行业",
            "moat": 5,
            "cycle_pos": 5,
            "theme": ["行业主题待补充"]
        })
        industry = prof["industry"]
        moat = prof["moat"]
        cycle = prof["cycle_pos"]
        themes = prof["theme"]

        conclusions = [
            f"所属赛道：{industry}",
            f"护城河（Porter五力综合）：{'⭐'*moat}{'·'*(10-moat)} ({moat}/10)",
            f"景气周期位置：{'🌟'*cycle}{'·'*(10-cycle)} ({cycle}/10)",
            f"主线催化：{', '.join(themes)}",
        ]

        bulls = []
        bears = []
        if moat >= 8:
            bulls.append(f"护城河深厚 {moat}/10，行业龙头地位稳固")
        elif moat <= 4:
            bears.append(f"护城河较弱 {moat}/10，行业竞争激烈")
        if cycle >= 8:
            bulls.append(f"景气上行期 {cycle}/10，短期业绩弹性大")
        elif cycle <= 3:
            bears.append(f"景气下行期 {cycle}/10，基本面承压")
        for t in themes:
            if any(x in t for x in ("爆发", "创新", "修复", "扩张", "领先", "高增")):
                bulls.append(f"主线催化：{t}")
            if any(x in t for x in ("承压", "周期", "收窄", "筑底")):
                bears.append(f"制约因素：{t}")

        # 评分：护城河 60% + 景气 40%
        score = round(moat * 0.6 + cycle * 0.4)
        score = max(0, min(10, score))
        extra = {"industry": industry, "moat_stars": moat, "cycle_stars": cycle, "themes": themes}
        out = AgentOutput(role=self.NAME, score=score, conclusions=conclusions,
                          bull_points=bulls, bear_points=bears, extra=extra)
        _print_output(out)
        return out


# ============================================================
#  Agent 4: 市场信号官 (Technical & Market)
# ============================================================
class TechnicalAgent:
    NAME = "市场信号官"
    EMOJI = "📈"

    def run(self, data: StockRawData) -> AgentOutput:
        print_role_header(self.NAME, self.EMOJI)
        signals = []
        bulls = []
        bears = []
        conclusions = []
        score = 5

        p = data.price
        # 均线排列
        if p > 0 and data.ma5 > 0:
            if data.ma5 > data.ma10 > data.ma20:
                score += 2; signals.append(("均线多头", True, "MA5>MA10>MA20，短中期趋势向上"))
                bulls.append("均线多头排列，趋势明确向上")
            elif data.ma5 < data.ma10 < data.ma20:
                score -= 2; signals.append(("均线空头", False, "MA5<MA10<MA20，趋势向下"))
                bears.append("均线空头排列，趋势向下")
            else:
                signals.append(("均线交织", None, "短期无明确趋势方向"))

            # 相对 MA60
            if data.ma60 > 0:
                if p > data.ma60:
                    score += 1; bulls.append("站稳 MA60，中期结构偏强")
                else:
                    score -= 1; bears.append("失守 MA60，中期结构偏弱")

        # RSI
        if data.rsi14 > 0:
            if data.rsi14 < 30:
                score += 2; bulls.append(f"RSI {data.rsi14:.0f} 进入超卖区，或有反弹")
            elif data.rsi14 > 70:
                score -= 1; bears.append(f"RSI {data.rsi14:.0f} 超买，短期回调风险")
            else:
                pass
            conclusions.append(f"RSI(14) = {data.rsi14:.1f}")

        # MACD
        if data.macd_dif != 0 or data.macd_dea != 0:
            if data.macd_dif > data.macd_dea and data.macd_bar > 0:
                score += 1; bulls.append(f"MACD 金叉，DIF={data.macd_dif:.2f} DEA={data.macd_dea:.2f}")
            elif data.macd_dif < data.macd_dea and data.macd_bar < 0:
                score -= 1; bears.append(f"MACD 死叉，DIF={data.macd_dif:.2f} DEA={data.macd_dea:.2f}")
            conclusions.append(f"MACD柱={data.macd_bar:+.2f}")

        # KDJ
        if data.kdj_j > 100:
            score -= 1; bears.append(f"KDJ J={data.kdj_j:.1f} 超买，短期谨慎")
        elif data.kdj_j < 0:
            score += 1; bulls.append(f"KDJ J={data.kdj_j:.1f} 超卖，反弹窗口")
        conclusions.append(f"KDJ(K/D/J) = {data.kdj_k:.0f}/{data.kdj_d:.0f}/{data.kdj_j:.0f}")

        # 60 日位置
        pos = data.position_60d
        if pos <= 20:
            score += 1; bulls.append(f"60日位置 {pos:.0f}%，接近阶段低点，赔率较高")
        elif pos >= 85:
            score -= 1; bears.append(f"60日位置 {pos:.0f}%，接近阶段高点，性价比下降")
        conclusions.append(f"60日位置 {pos:.0f}%（60日低 {data.low_60d:.2f} / 高 {data.high_60d:.2f}）")

        # 换手率
        if data.turnover > 0:
            if data.turnover >= 15:
                score -= 1; bears.append(f"换手率 {data.turnover:.1f}% 极端高位，筹码剧烈松动")
            elif 3 <= data.turnover <= 10:
                bulls.append(f"换手率 {data.turnover:.1f}% 交投活跃")
            conclusions.append(f"换手率 {data.turnover:.2f}%")

        # 支撑/压力位
        support = round(min(data.ma20, data.ma60, data.low_60d), 2)
        resistance = round(max(data.ma20, data.high_60d), 2)
        conclusions.append(f"短线支撑 ~{support}   压力位 ~{resistance}")

        score = max(0, min(10, score))
        extra = {"signals": signals, "support": support, "resistance": resistance}
        out = AgentOutput(role=self.NAME, score=score, conclusions=conclusions,
                          bull_points=bulls, bear_points=bears, extra=extra)
        _print_output(out)
        return out


# ============================================================
#  Agent 5: 逆向投资人 (Contrarian / Risk Analyst)
# ============================================================
class ContrarianAgent:
    NAME = "逆向投资人"
    EMOJI = "🧨"

    def run(self, data: StockRawData) -> AgentOutput:
        print_role_header(self.NAME, self.EMOJI)
        risks = []
        risk_weight = 0  # 越高越危险（0~10）

        # 估值类风险
        if data.pe_ttm >= 60:
            risks.append(f"PE {data.pe_ttm:.1f}x 极高，估值泡沫化，任何业绩不及预期都可能引发戴维斯双杀")
            risk_weight += 3
        elif data.pe_ttm >= 40:
            risks.append(f"PE {data.pe_ttm:.1f}x 偏高，需要持续高增长才能消化")
            risk_weight += 1
        if data.pb >= 10:
            risks.append(f"PB {data.pb:.2f}x 高溢价，账面价值提供的保护很弱")
            risk_weight += 1

        # 技术面风险
        if data.rsi14 >= 78:
            risks.append(f"RSI {data.rsi14:.0f} 严重超买，短期获利盘抛压随时可能释放")
            risk_weight += 2
        if data.turnover >= 15:
            risks.append(f"换手率 {data.turnover:.1f}% 极端高位，大概率是资金博弈末端")
            risk_weight += 2
        if data.position_60d >= 90:
            risks.append(f"60日位置 {data.position_60d:.0f}% 接近最高点，赔率变差")
            risk_weight += 1

        # 财务风险
        if data.debt_ratio >= 80:
            risks.append(f"资产负债率 {data.debt_ratio:.1f}% 过高，利息负担侵蚀利润")
            risk_weight += 1
        if len(data.net_profit) >= 2 and data.net_profit[-1] < data.net_profit[-2]:
            risks.append("最新报告期归母净利环比/同比下滑，基本面出现负面信号")
            risk_weight += 1
        if data.net_profit and data.net_profit[-1] < 0:
            risks.append("最新报告期归母净利亏损，基本面有实质性恶化风险")
            risk_weight += 2
        if data.gross_margin and data.gross_margin < 8:
            risks.append(f"毛利率 {data.gross_margin:.1f}% 过低，价格战中缺乏缓冲")
            risk_weight += 1

        # 通用黑天鹅
        black_swan = [
            "宏观：经济下行超预期 → 居民消费/企业资本开支收缩",
            "政策：行业监管政策突变（平台/医药/教育式整治）",
            "事件：大股东减持 / 定增解禁 / 管理层变动",
            "外部：地缘冲突升级、汇率大幅波动、海外制裁",
            "模型：历史表现不代表未来，任何技术指标都可能失效",
        ]

        conclusions = []
        if risks:
            conclusions.append(f"⚠️ 已识别 {len(risks)} 条显著风险项（风险权重 {risk_weight}/10）：")
            for i, r in enumerate(risks, 1):
                conclusions.append(f"   {i}. {r}")
        else:
            conclusions.append(f"✅ 未发现显著的结构性风险（风险权重 {risk_weight}/10）")
        conclusions.append("🦢 永远存在的黑天鹅（不可量化）：")
        for s in black_swan[:3]:
            conclusions.append(f"   • {s}")

        # 逆向得分：风险越高，逆向得分越低（逆向投资人 = 看空派）
        contrarian_score = max(0, min(10, 10 - risk_weight))
        extra = {"risk_weight": risk_weight, "black_swan": black_swan}
        # 对逆向角色：bull_points 是"看空论据"，bear_points 是"空头也别太乐观（风险已price in）"
        bears = risks[:]
        bulls = []
        if contrarian_score <= 3:
            bulls.append("市场极度悲观，若预期边际改善则有修复空间")
        out = AgentOutput(role=self.NAME, score=contrarian_score, conclusions=conclusions,
                          bull_points=bulls, bear_points=bears, extra=extra)
        _print_output(out)
        return out


def _print_output(o: AgentOutput):
    rows = [
        ["📌 核心结论", "\n".join(f"• {c}" for c in o.conclusions) or "—"],
        ["🐂 多头论据", "\n".join(f"• {x}" for x in o.bull_points) or "—"],
        ["🐻 空头论据", "\n".join(f"• {x}" for x in o.bear_points) or "—"],
        ["⭐ 本维度评分", f"{o.score} / 10"],
    ]
    print(tabulate(rows, tablefmt="fancy_grid", colalign=("right", "left")))


# ============================================================
#  研究主管（主脑）：汇总裁决 + 最终评级 + 交易方案
# ============================================================
@dataclass
class FinalReport:
    stock_code: str
    stock_name: str
    price: float
    change_pct: float
    pe_ttm: float
    pb: float
    total_mv: float
    # 五维评分
    score_valuation: int
    score_earnings: int
    score_industry: int
    score_technical: int
    score_risk: int
    # 多头/空头聚合
    aggregated_bulls: List[str]
    aggregated_bears: List[str]
    # 评级 & 交易
    rating: str         # BUY / LEAN BUY / HOLD / LEAN SELL / SELL
    rating_score: int   # 综合加权 -10 ~ +10
    entry_low: float
    entry_high: float
    tgt1: float
    tgt2: float
    stop_loss: float
    position_size: str
    catalysts: List[str]
    warnings: List[str]
    agent_outputs: Dict[str, AgentOutput] = field(default_factory=dict)

    def final_score(self) -> float:
        weights = {
            "估值分析师": 0.25,
            "财报分析师": 0.25,
            "产业策略师": 0.20,
            "市场信号官": 0.20,
            "逆向投资人": 0.10,  # 逆向：作为负反馈（得分越低 -> 整体扣分）
        }
        s = 0.0
        for role, w in weights.items():
            a = self.agent_outputs.get(role)
            if not a:
                continue
            if role == "逆向投资人":
                # 逆向得分低 = 风险高 = 对整体是扣分项（与其他Agent方向一致）
                s += w * (a.score - 5) * 2
            else:
                s += w * (a.score - 5) * 2
        return s  # 理论范围 -10 ~ +10


def _rating(score: float) -> str:
    if score >= 5.0: return "BUY"
    if score >= 2.5: return "LEAN BUY"
    if score >= -2.5: return "HOLD"
    if score >= -5.0: return "LEAN SELL"
    return "SELL"


def synthesize(stock: StockRawData, outputs: List[AgentOutput]) -> FinalReport:
    out_map = {o.role: o for o in outputs}
    # 聚合论据
    bulls_all: List[str] = []
    bears_all: List[str] = []
    for o in outputs:
        bulls_all.extend(o.bull_points)
        bears_all.extend(o.bear_points)
    # 去重，保持顺序
    def _uniq(lst):
        seen = set()
        out = []
        for x in lst:
            if x in seen: continue
            seen.add(x); out.append(x)
        return out
    bulls_all = _uniq(bulls_all)
    bears_all = _uniq(bears_all)

    # 评分
    s_val = out_map["估值分析师"].score
    s_ear = out_map["财报分析师"].score
    s_ind = out_map["产业策略师"].score
    s_tec = out_map["市场信号官"].score
    s_ris = out_map["逆向投资人"].score

    report = FinalReport(
        stock_code=stock.code, stock_name=stock.name,
        price=stock.price, change_pct=stock.change_pct,
        pe_ttm=stock.pe_ttm, pb=stock.pb, total_mv=stock.total_mv,
        score_valuation=s_val, score_earnings=s_ear,
        score_industry=s_ind, score_technical=s_tec, score_risk=s_ris,
        aggregated_bulls=bulls_all, aggregated_bears=bears_all,
        rating="HOLD", rating_score=0,
        entry_low=0, entry_high=0, tgt1=0, tgt2=0, stop_loss=0,
        position_size="0%", catalysts=[], warnings=[],
        agent_outputs=out_map,
    )
    report.rating_score = round(report.final_score(), 2)
    report.rating = _rating(report.rating_score)

    # 交易方案：优先用估值分析师的目标价，其次用技术面支撑/压力
    tgts = out_map["估值分析师"].extra.get("targets", {})
    extra_tec = out_map["市场信号官"].extra
    # 目标价有效性检查：中性目标价必须 > 当前价 * 0.3 才算有效（0.0 的兜底）
    _tgts_valid = bool(tgts) and isinstance(tgts.get("neutral"), (int, float)) and tgts["neutral"] > stock.price * 0.3
    if _tgts_valid:
        # 三个目标价排序：保守(最低) ≤ 中性 ≤ 乐观(最高)
        sorted_tgts = sorted([tgts["conservative"], tgts["neutral"], tgts["optimistic"]])
        report.tgt1 = round(sorted_tgts[1], 2)  # 中性
        report.tgt2 = round(sorted_tgts[2], 2)  # 乐观
        # 入场价基于保守目标价（最低值）
        report.entry_low = round(sorted_tgts[0] * 0.92, 2)
        report.entry_high = round(sorted_tgts[0] * 1.00, 2)
    else:
        report.tgt1 = round(stock.price * 1.08, 2)
        report.tgt2 = round(stock.price * 1.18, 2)
        report.entry_low = round(stock.price * 0.95, 2)
        report.entry_high = round(stock.price * 0.98, 2)
    if extra_tec.get("support"):
        sup = extra_tec["support"]
        report.entry_low = min(report.entry_low, round(sup * 1.01, 2))
        report.stop_loss = round(sup * 0.96, 2)
    else:
        report.stop_loss = round(stock.price * 0.92, 2)
    # 仓位
    if report.rating in ("BUY", "LEAN BUY"):
        report.position_size = "15% ~ 25%"
    elif report.rating == "HOLD":
        report.position_size = "5% ~ 15%"
    else:
        report.position_size = "0% ~ 5%"

    # 催化
    cats = out_map["产业策略师"].extra.get("themes", [])[:]
    if stock.report_dates:
        cats.append(f"下一份财报窗口：{stock.report_dates[-1]}")
    # 技术信号
    for name, pos, detail in extra_tec.get("signals", []):
        if pos is True:
            cats.append(f"技术信号：{name}（{detail}）")
    report.catalysts = cats

    # 预警
    report.warnings = out_map["财报分析师"].extra.get("warnings", [])
    ris_ws = out_map["逆向投资人"].extra.get("black_swan", [])
    report.warnings.extend(ris_ws[-2:])

    return report


# ============================================================
#  报告输出（终端 + JSON 文件）
# ============================================================
def print_final_report(report: FinalReport):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    bar = "━" * 64
    print(f"\n{bar}")
    print(f"  🧑‍💼 【研究主管 · 最终裁决报告】")
    print(f"  标的：{report.stock_name} ({report.stock_code})    时间：{ts}")
    print(f"{bar}")

    # 1. 概览
    rating_color = {
        "BUY": "●●● 强烈看多 ●●●",
        "LEAN BUY": "●● 谨慎看多 ●●",
        "HOLD": "● 中性观望 ●",
        "LEAN SELL": "▼▼ 谨慎看空 ▼▼",
        "SELL": "▼▼▼ 强烈看空 ▼▼▼",
    }.get(report.rating, report.rating)

    print(f"\n【股票概览】")
    overview = [
        ["最新价 / 涨跌幅", f"{report.price} 元  /  {report.change_pct:+.2f}%"],
        ["总市值", f"{report.total_mv:.2f} 亿元"],
        ["PE-TTM / PB", f"{report.pe_ttm:.2f}  /  {report.pb:.2f}"],
        ["综合评分", f"{report.rating_score:+.2f}  →  评级：{report.rating}    {rating_color}"],
    ]
    print(tabulate(overview, tablefmt="fancy_grid", colalign=("right", "left")))

    # 2. 五维评分
    print(f"\n【五维评分雷达】")
    radar = [
        ["估值", report.score_valuation, _stars(report.score_valuation)],
        ["财报", report.score_earnings, _stars(report.score_earnings)],
        ["产业", report.score_industry, _stars(report.score_industry)],
        ["技术", report.score_technical, _stars(report.score_technical)],
        ["安全", report.score_risk, _stars(report.score_risk)],  # 安全维度：分数越高=风险越低=越好
    ]
    print(tabulate(radar, headers=["维度", "分数", "图形"], tablefmt="fancy_grid",
                    colalign=("center", "center", "left")))

    # 3. 多空辩论
    print(f"\n【多空辩论 · 汇总】")
    n_bull = len(report.aggregated_bulls)
    n_bear = len(report.aggregated_bears)
    deb = []
    for i in range(max(n_bull, n_bear)):
        b = report.aggregated_bulls[i] if i < n_bull else ""
        s = report.aggregated_bears[i] if i < n_bear else ""
        deb.append([b, s])
    print(tabulate(deb,
                   headers=[f"🐂 多头依据 (共{n_bull}条)", f"🐻 空头依据 (共{n_bear}条)"],
                   tablefmt="fancy_grid", colalign=("left", "left"), maxcolwidths=[40, 40]))

    # 4. 研究主管裁决
    print(f"\n【研究主管 · 裁决结论】")
    bull_weight = min(10, round(4 + report.rating_score))
    bear_weight = max(0, round(6 - report.rating_score))
    verdict_text = (
        f"多/空权重 = {bull_weight}:{bear_weight}  →  {report.rating}\n"
        f"五维加权综合得分 {report.rating_score:+.2f}，"
        f"结合估值目标价区间、技术面支撑压力与风险评估，给出以下建议："
    )
    print(f"  {verdict_text}\n")

    # 5. 交易方案
    print(f"【交易方案】")
    trade = [
        ["入场价区间", f"{report.entry_low}  ~  {report.entry_high} 元"],
        ["目标价一（保守）", f"{report.tgt1} 元"],
        ["目标价二（乐观）", f"{report.tgt2} 元"],
        ["止损价", f"{report.stop_loss} 元（跌破立即离场）"],
        ["建议仓位", f"{report.position_size}"],
    ]
    print(tabulate(trade, tablefmt="fancy_grid", colalign=("right", "left")))

    # 6. 催化日历
    if report.catalysts:
        print(f"\n【关键催化 / 主线】")
        for c in report.catalysts:
            print(f"   • {c}")

    # 7. 预警
    if report.warnings:
        print(f"\n【风险预警】")
        for w in report.warnings:
            print(f"   ⚠️  {w}")

    print(f"\n{bar}")
    print("  ⚠️  本报告仅供研究参考，不构成个人投资建议。")
    print("  ⚠️  市场有风险，入市需谨慎。")
    print(f"{bar}\n")


def _stars(n: int) -> str:
    n = max(0, min(10, int(n)))
    return "★" * n + "☆" * (10 - n) + f"  {n}/10"


def save_report_json(report: FinalReport, data: StockRawData):
    """同时保存 JSON 供后续接入看板使用"""
    obj = {
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "stock": asdict(data),
        "agents": {role: asdict(o) for role, o in report.agent_outputs.items()},
        "final": {
            k: v for k, v in asdict(report).items()
            if k != "agent_outputs"  # 已单独存
        }
    }
    # 输出到 data/ 目录，去掉日期后缀，始终覆盖为最新（供看板页面读取）
    import os
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    os.makedirs(data_dir, exist_ok=True)
    path = os.path.join(data_dir, f"report_{report.stock_code}.json")
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)
        print(f"  [输出] 报告 JSON 已保存：{path}")
    except Exception as e:
        print(f"  [输出] JSON 保存失败: {e}")


def _rating_color(rating: str) -> str:
    """评级 → 颜色"""
    r = rating.upper()
    if "BUY" in r and "LEAN" not in r:
        return "#e74c3c"  # 强买 红色
    if "BUY" in r:
        return "#e67e22"  # 偏多 橙色
    if "SELL" in r and "LEAN" not in r:
        return "#27ae60"  # 强卖 绿色
    if "SELL" in r:
        return "#2ecc71"  # 偏空 浅绿
    return "#95a5a6"      # 中性 灰色


def _score_bar(score: int) -> str:
    """生成 0~10 分的进度条 HTML"""
    pct = max(0, min(100, score * 10))
    color = "#e74c3c" if score >= 7 else "#f39c12" if score >= 4 else "#95a5a6"
    return f'<div class="score-bar"><div class="score-fill" style="width:{pct}%;background:{color}"></div></div>'


def build_html_report(report: FinalReport, data: StockRawData) -> str:
    """生成 HTML 报告字符串（不写文件，供 API / 前端复用）"""
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    rating_c = _rating_color(report.rating)

    # 五维雷达图数据
    radar_labels = ["估值", "财报", "产业", "技术", "安全"]
    radar_values = [
        report.score_valuation, report.score_earnings,
        report.score_industry, report.score_technical, report.score_risk,
    ]
    # 雷达图用 SVG polygon
    cx, cy, R = 150, 150, 100
    angles = [(-90 + i * 72) * 3.14159 / 180 for i in range(5)]
    # 网格层（2,4,6,8,10）
    grid_layers = ""
    for level in [2, 4, 6, 8, 10]:
        pts = []
        for a in angles:
            x = cx + R * (level / 10) * __import__("math").cos(a)
            y = cy + R * (level / 10) * __import__("math").sin(a)
            pts.append(f"{x:.1f},{y:.1f}")
        grid_layers += f'<polygon points="{" ".join(pts)}" class="grid-poly" />'
    # 轴线
    axis_lines = ""
    for a in angles:
        x = cx + R * __import__("math").cos(a)
        y = cy + R * __import__("math").sin(a)
        axis_lines += f'<line x1="{cx}" y1="{cy}" x2="{x:.1f}" y2="{y:.1f}" class="axis-line" />'
    # 数据多边形
    data_pts = []
    for i, a in enumerate(angles):
        v = radar_values[i] / 10
        x = cx + R * v * __import__("math").cos(a)
        y = cy + R * v * __import__("math").sin(a)
        data_pts.append(f"{x:.1f},{y:.1f}")
    radar_polygon = " ".join(data_pts)
    # 标签
    label_positions = []
    for i, a in enumerate(angles):
        x = cx + (R + 22) * __import__("math").cos(a)
        y = cy + (R + 22) * __import__("math").sin(a) + 4
        label_positions.append((x, y, radar_labels[i], radar_values[i]))

    # Agent 详情卡片
    agent_emojis = {"估值分析师": "🔢", "财报分析师": "📊", "产业策略师": "🏭",
                    "市场信号官": "📈", "逆向投资人": "🧨"}
    agent_cards = ""
    for role, out in report.agent_outputs.items():
        emoji = agent_emojis.get(role, "🔍")
        cons_html = "".join(f"<li>{c}</li>" for c in out.conclusions)
        bulls_html = "".join(f"<li>{b}</li>" for b in out.bull_points) or "<li class='empty'>—</li>"
        bears_html = "".join(f"<li>{b}</li>" for b in out.bear_points) or "<li class='empty'>—</li>"
        agent_cards += f"""
        <div class="agent-card">
          <div class="agent-header"><span class="agent-emoji">{emoji}</span> {role}
            <span class="agent-score" style="background:{_rating_color('BUY' if out.score>=7 else 'HOLD' if out.score>=4 else 'SELL')}">{out.score}/10</span>
          </div>
          <div class="agent-body">
            <div class="agent-col"><div class="col-title">📌 核心结论</div><ul>{cons_html}</ul></div>
            <div class="agent-col"><div class="col-title bull">🐂 多头论据</div><ul>{bulls_html}</ul></div>
            <div class="agent-col"><div class="col-title bear">🐻 空头论据</div><ul>{bears_html}</ul></div>
          </div>
        </div>"""

    # 多空辩论表
    max_rows = max(len(report.aggregated_bulls), len(report.aggregated_bears))
    debate_rows = ""
    for i in range(max_rows):
        b = report.aggregated_bulls[i] if i < len(report.aggregated_bulls) else ""
        s = report.aggregated_bears[i] if i < len(report.aggregated_bears) else ""
        debate_rows += f"<tr><td class='bull-cell'>{b}</td><td class='bear-cell'>{s}</td></tr>"

    catalysts_html = "".join(f"<span class='tag'>{c}</span>" for c in report.catalysts)
    warnings_html = "".join(f"<li>⚠️ {w}</li>" for w in report.warnings)

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>股票分析报告 · {report.stock_name}({report.stock_code})</title>
<style>
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  body {{ font-family:"Microsoft YaHei","Segoe UI",sans-serif; background:#0f1117; color:#d0d4dc; padding:20px; }}
  .container {{ max-width:900px; margin:0 auto; }}
  .header {{ text-align:center; padding:30px 20px; background:linear-gradient(135deg,#1a1d28,#2d3548); border-radius:12px; margin-bottom:20px; }}
  .header h1 {{ font-size:28px; color:#fff; margin-bottom:8px; }}
  .header .subtitle {{ font-size:14px; color:#7a8090; }}
  .rating-badge {{ display:inline-block; padding:8px 24px; border-radius:20px; font-size:20px; font-weight:bold;
    color:#fff; background:{rating_c}; margin-top:10px; }}
  .rating-score {{ font-size:14px; color:#a0a4b0; margin-top:6px; }}
  .section {{ background:#1a1d28; border-radius:10px; padding:20px; margin-bottom:16px; }}
  .section-title {{ font-size:18px; font-weight:bold; color:#5dade2; margin-bottom:14px; border-left:3px solid #5dade2; padding-left:10px; }}
  /* 概览卡片 */
  .overview-grid {{ display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }}
  .overview-item {{ background:#252a38; border-radius:8px; padding:14px; text-align:center; }}
  .overview-item .label {{ font-size:12px; color:#7a8090; margin-bottom:4px; }}
  .overview-item .value {{ font-size:18px; font-weight:bold; color:#e8e8e8; }}
  /* 雷达图 */
  .radar-section {{ display:flex; align-items:center; gap:30px; }}
  .radar-svg {{ flex:0 0 320px; }}
  .radar-scores {{ flex:1; }}
  .radar-scores table {{ width:100%; border-collapse:collapse; }}
  .radar-scores th, .radar-scores td {{ padding:8px 10px; border-bottom:1px solid #2a2e3a; }}
  .radar-scores th {{ text-align:left; color:#7a8090; font-size:13px; }}
  .radar-scores td {{ text-align:center; font-weight:bold; font-size:16px; }}
  .grid-poly {{ fill:none; stroke:#2a2e3a; stroke-width:1; }}
  .axis-line {{ stroke:#2a2e3a; stroke-width:1; }}
  .data-poly {{ fill:rgba(93,173,226,0.2); stroke:#5dade2; stroke-width:2; }}
  .data-point {{ fill:#5dade2; r:4; }}
  .radar-label {{ font-size:12px; fill:#d0d4dc; font-weight:bold; }}
  .radar-value {{ font-size:11px; fill:#5dade2; }}
  /* 多空辩论 */
  .debate-table {{ width:100%; border-collapse:collapse; }}
  .debate-table th {{ padding:10px; font-size:14px; }}
  .debate-table th.bull {{ color:#e74c3c; text-align:left; }}
  .debate-table th.bear {{ color:#2ecc71; text-align:left; }}
  .debate-table td {{ padding:10px; border-bottom:1px solid #2a2e3a; font-size:13px; line-height:1.5; }}
  .bull-cell {{ color:#e8a0a0; border-right:1px solid #2a2e3a !important; }}
  .bear-cell {{ color:#a0d8a0; }}
  /* 交易方案 */
  .trade-grid {{ display:grid; grid-template-columns:repeat(2,1fr); gap:12px; }}
  .trade-item {{ background:#252a38; border-radius:8px; padding:14px; }}
  .trade-item .label {{ font-size:12px; color:#7a8090; margin-bottom:4px; }}
  .trade-item .value {{ font-size:16px; font-weight:bold; color:#e8e8e8; }}
  /* Agent 卡片 */
  .agent-card {{ background:#252a38; border-radius:8px; margin-bottom:12px; overflow:hidden; }}
  .agent-header {{ padding:12px 16px; font-weight:bold; font-size:15px; display:flex; align-items:center; gap:8px;
    background:#1e2230; border-bottom:1px solid #2a2e3a; }}
  .agent-score {{ margin-left:auto; padding:2px 10px; border-radius:10px; font-size:12px; color:#fff; }}
  .agent-body {{ display:grid; grid-template-columns:1fr 1fr 1fr; gap:1px; background:#2a2e3a; }}
  .agent-col {{ background:#252a38; padding:12px; }}
  .col-title {{ font-size:12px; font-weight:bold; margin-bottom:6px; }}
  .col-title.bull {{ color:#e74c3c; }}
  .col-title.bear {{ color:#2ecc71; }}
  .agent-col ul {{ list-style:none; padding-left:0; }}
  .agent-col li {{ font-size:12px; line-height:1.6; margin-bottom:3px; }}
  .agent-col li.empty {{ color:#555; }}
  .score-bar {{ width:100%; height:6px; background:#2a2e3a; border-radius:3px; margin-top:4px; }}
  .score-fill {{ height:100%; border-radius:3px; }}
  /* 标签 */
  .tags {{ display:flex; flex-wrap:wrap; gap:8px; }}
  .tag {{ background:#2d3548; color:#5dade2; padding:4px 12px; border-radius:12px; font-size:12px; }}
  /* 风险 */
  .warnings ul {{ list-style:none; padding-left:0; }}
  .warnings li {{ font-size:13px; line-height:1.8; color:#e8c8a0; }}
  .footer {{ text-align:center; padding:20px; font-size:12px; color:#555; }}
</style>
</head>
<body>
<div class="container">

  <!-- 标题 -->
  <div class="header">
    <h1>🧑‍💼 {report.stock_name} ({report.stock_code})</h1>
    <div class="subtitle">5人 Agent 团队分析报告 · {ts}</div>
    <div class="rating-badge">{report.rating}</div>
    <div class="rating-score">综合评分 {report.rating_score:+.2f}（-10 ~ +10）</div>
  </div>

  <!-- 概览 -->
  <div class="section">
    <div class="section-title">📊 股票概览</div>
    <div class="overview-grid">
      <div class="overview-item"><div class="label">最新价 / 涨跌幅</div><div class="value">{report.price:.2f} / {report.change_pct:+.2f}%</div></div>
      <div class="overview-item"><div class="label">总市值</div><div class="value">{report.total_mv:.1f} 亿</div></div>
      <div class="overview-item"><div class="label">PE-TTM / PB</div><div class="value">{report.pe_ttm:.1f} / {report.pb:.2f}</div></div>
      <div class="overview-item"><div class="label">换手率</div><div class="value">{data.turnover:.2f}%</div></div>
    </div>
  </div>

  <!-- 五维雷达 -->
  <div class="section">
    <div class="section-title">🎯 五维评分雷达</div>
    <div class="radar-section">
      <div class="radar-svg">
        <svg width="320" height="320" xmlns="http://www.w3.org/2000/svg">
          {grid_layers}
          {axis_lines}
          <polygon points="{radar_polygon}" class="data-poly" />
          {''.join(f'<circle cx="{cx + R * (radar_values[i]/10) * __import__("math").cos(angles[i]):.1f}" cy="{cy + R * (radar_values[i]/10) * __import__("math").sin(angles[i]):.1f}" r="4" class="data-point" />' for i in range(5))}
          {''.join(f'<text x="{x:.1f}" y="{y:.1f}" class="radar-label" text-anchor="middle">{lbl}</text><text x="{x:.1f}" y="{y+14:.1f}" class="radar-value" text-anchor="middle">{val}/10</text>' for x,y,lbl,val in label_positions)}
        </svg>
      </div>
      <div class="radar-scores">
        <table>
          <tr><th>维度</th><th>分数</th><th>图形</th></tr>
          <tr><td>🔢 估值</td><td>{report.score_valuation}</td><td>{_score_bar(report.score_valuation)}</td></tr>
          <tr><td>📊 财报</td><td>{report.score_earnings}</td><td>{_score_bar(report.score_earnings)}</td></tr>
          <tr><td>🏭 产业</td><td>{report.score_industry}</td><td>{_score_bar(report.score_industry)}</td></tr>
          <tr><td>📈 技术</td><td>{report.score_technical}</td><td>{_score_bar(report.score_technical)}</td></tr>
          <tr><td>🧨 安全</td><td>{report.score_risk}</td><td>{_score_bar(report.score_risk)}</td></tr>
        </table>
      </div>
      <div style="font-size:0.7rem;color:#7a8090;text-align:center;margin-top:6px;">所有维度分数越高越好（安全高分=风险低）</div>
    </div>
  </div>

  <!-- 多空辩论 -->
  <div class="section">
    <div class="section-title">⚔️ 多空辩论 · 汇总</div>
    <table class="debate-table">
      <tr><th class="bull">🐂 多头依据 ({len(report.aggregated_bulls)} 条)</th><th class="bear">🐻 空头依据 ({len(report.aggregated_bears)} 条)</th></tr>
      {debate_rows}
    </table>
  </div>

  <!-- 交易方案 -->
  <div class="section">
    <div class="section-title">💰 交易方案</div>
    <div class="trade-grid">
      <div class="trade-item"><div class="label">入场价区间</div><div class="value">{report.entry_low:.2f} ~ {report.entry_high:.2f} 元</div></div>
      <div class="trade-item"><div class="label">目标价（保守）</div><div class="value">{report.tgt1:.2f} 元</div></div>
      <div class="trade-item"><div class="label">目标价（乐观）</div><div class="value">{report.tgt2:.2f} 元</div></div>
      <div class="trade-item"><div class="label">止损价</div><div class="value" style="color:#e74c3c">{report.stop_loss:.2f} 元</div></div>
      <div class="trade-item"><div class="label">建议仓位</div><div class="value">{report.position_size}</div></div>
      <div class="trade-item"><div class="label">当前价</div><div class="value">{report.price:.2f} 元</div></div>
    </div>
  </div>

  <!-- Agent 详情 -->
  <div class="section">
    <div class="section-title">👥 5 人 Agent 团队详情</div>
    {agent_cards}
  </div>

  <!-- 催化 / 风险 -->
  <div class="section">
    <div class="section-title">🚀 关键催化 / 主线</div>
    <div class="tags">{catalysts_html}</div>
  </div>
  <div class="section warnings">
    <div class="section-title">⚠️ 风险预警</div>
    <ul>{warnings_html}</ul>
  </div>

  <div class="footer">
    本报告由 5 人 Agent 团队自动生成 · 仅供研究参考，不构成投资建议 · 市场有风险，入市需谨慎
  </div>
</div>
</body>
</html>"""
    return html


def generate_html_report(report: FinalReport, data: StockRawData):
    """生成可视化 HTML 报告文件（写盘 + 自动打开，保留原 CLI 行为）"""
    html = build_html_report(report, data)
    html_path = f"report_{report.stock_code}_{datetime.date.today()}.html"
    try:
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"  [输出] 报告 HTML 已保存：{html_path}")
        # 尝试自动打开浏览器
        import webbrowser
        webbrowser.open(html_path)
    except Exception as e:
        print(f"  [输出] HTML 保存失败: {e}")


def analyze_to_html(code: str) -> str:
    """供前端 / API 调用：运行多 Agent 分析并返回完整 HTML 报告字符串。

    与 run_single_stock 的区别：不写盘、不弹浏览器、不依赖 CLI 参数，
    便于被本地 API 服务（server.py）调用后直接返回给浏览器展示。
    """
    raw = load_all_data(code)
    if raw.price <= 0:
        raise ValueError(f"数据采集失败，无法分析 {code}（可能停牌/退市，或为非交易时间）")
    team = [
        ValuationAgent(),
        EarningsAgent(),
        IndustryAgent(),
        TechnicalAgent(),
        ContrarianAgent(),
    ]
    outputs = [agent.run(raw) for agent in team]
    report = synthesize(raw, outputs)
    return build_html_report(report, raw)


# ============================================================
#  主流程：5 个 Agent 并行（伪并行：串行执行，后续可接入 ThreadPool）
# ============================================================
def run_single_stock(code: str) -> FinalReport:
    print(f"\n{'#'*70}")
    print(f"#  开始分析标的：{code}")
    print(f"{'#'*70}")
    t0 = time.time()

    # 1) 统一采集数据
    print(f"\n🧱 [阶段 1/2] 数据层：统一拉取行情/财务/技术面 ...\n")
    raw = load_all_data(code)
    if raw.price <= 0:
        print(f"  ❌ 数据采集失败，跳过 {code}")
        sys.exit(2)

    # 2) 启动 5 个 Agent（顺序执行，可改为 ThreadPoolExecutor 并行）
    print(f"\n🤝 [阶段 2/2] 5人分析团队：各角色独立输出 ...\n")
    team = [
        ValuationAgent(),
        EarningsAgent(),
        IndustryAgent(),
        TechnicalAgent(),
        ContrarianAgent(),
    ]
    outputs: List[AgentOutput] = [agent.run(raw) for agent in team]

    # 3) 研究主管裁决
    report = synthesize(raw, outputs)
    print_final_report(report)
    save_report_json(report, raw)
    generate_html_report(report, raw)
    dt = time.time() - t0
    print(f"  ⏱️  总耗时 {dt:.1f} 秒")
    return report


def main():
    codes = [c for c in sys.argv[1:] if c]
    if not codes:
        codes = ["300433"]  # 默认测试蓝思科技
    for code in codes:
        try:
            run_single_stock(code.strip())
        except Exception as e:
            print(f"  ❌ 分析 {code} 出错: {e}")
            import traceback; traceback.print_exc()


if __name__ == "__main__":
    main()
