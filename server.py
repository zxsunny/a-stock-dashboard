#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地 API 服务：在提供静态文件（看板前端）的同时，暴露 /api/analyze 接口，
调用 multi_agent_stock_analysis.analyze_to_html 运行多 Agent 分析并把完整
HTML 报告返回给浏览器展示，从而打通此前割裂的前端看板与后端分析引擎。

用法：
    python server.py [port]        # 默认端口 8888
然后浏览器打开 http://localhost:8888/a-stock-dashboard.html

说明：
    - 静态文件服务基于标准库 http.server，零第三方依赖。
    - /api/analyze?code=600519 会同步运行分析（含网络请求，约 10~30 秒），
      因此使用 ThreadingHTTPServer，避免阻塞其它静态资源请求。
    - 同一股票当天结果内存缓存 1 小时，避免重复打行情接口。
"""
import os
import sys
import json
import time
import urllib.parse
import http.server
from http.server import SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import multi_agent_stock_analysis as msa


# 简单内存缓存：同一股票当天只跑一次分析，避免重复打接口
_cache = {}
_CACHE_TTL = 3600  # 秒


def _analyze(code: str) -> str:
    key = (code, time.strftime("%Y-%m-%d"))
    now = time.time()
    cached = _cache.get(key)
    if cached and (now - cached[0]) < _CACHE_TTL:
        return cached[1]
    html = msa.analyze_to_html(code)
    _cache[key] = (now, html)
    return html


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def _send(self, status: int, body: bytes, content_type: str):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status: int, obj):
        self._send(
            status,
            json.dumps(obj, ensure_ascii=False).encode("utf-8"),
            "application/json; charset=utf-8",
        )

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/analyze":
            self._handle_analyze(parsed)
            return
        if parsed.path == "/api/valuation_history":
            self._handle_valuation_history(parsed)
            return
        if parsed.path == "/api/health":
            self._send_json(200, {"ok": True})
            return
        # 默认：静态文件
        super().do_GET()

    def _handle_valuation_history(self, parsed):
        """返回近5年估值序列（PE/PB/收盘价）与百分位，供前端画历史估值走势（改进#12）"""
        qs = urllib.parse.parse_qs(parsed.query)
        code = (qs.get("code") or [""])[0].strip()
        if not code or not code.isdigit() or len(code) != 6:
            self._send_json(400, {"ok": False, "error": "请提供 6 位股票代码，例如 ?code=600519"})
            return
        try:
            raw = msa.StockRawData(code=code)
            msa.fetch_valuation_history(raw)
        except Exception as e:  # noqa: BLE001
            self._send_json(502, {"ok": False, "error": f"估值历史获取失败：{e}"})
            return
        if not raw.valuation_history:
            self._send_json(404, {"ok": False, "error": "估值历史数据暂不可用（可能停牌/新股/接口异常）"})
            return
        series = [
            {"date": h["date"], "pe": h["pe"], "pb": h["pb"], "close": h["close"]}
            for h in raw.valuation_history
        ]
        self._send_json(200, {
            "ok": True,
            "code": code,
            "history_len": len(series),
            "series": series,
            "pe_5y_pct": raw.pe_5y_pct,
            "pb_5y_pct": raw.pb_5y_pct,
            "pe_5y_range": [raw.pe_5y_min, raw.pe_5y_max],
            "pb_5y_range": [raw.pb_5y_min, raw.pb_5y_max],
            "high_5y": raw.high_5y,
            "low_5y": raw.low_5y,
        })

    def _handle_analyze(self, parsed):
        qs = urllib.parse.parse_qs(parsed.query)
        code = (qs.get("code") or [""])[0].strip()
        fmt = (qs.get("format") or ["html"])[0].strip().lower()
        if not code or not code.isdigit() or len(code) != 6:
            self._send_json(
                400,
                {"ok": False, "error": "请提供 6 位股票代码，例如 ?code=600519"},
            )
            return
        try:
            html = _analyze(code)
        except Exception as e:  # noqa: BLE001 - 把任何异常转成友好页面
            msg = f"分析失败：{e}"
            if fmt == "json":
                self._send_json(502, {"ok": False, "error": msg})
                return
            err_html = (
                "<!DOCTYPE html><html lang='zh-CN'><head><meta charset='UTF-8'>"
                "<title>分析失败</title><style>body{font-family:sans-serif;"
                "background:#0f1117;color:#d0d4dc;padding:40px;}"
                ".box{background:#1a1d28;border-radius:10px;padding:24px;"
                "max-width:640px;margin:auto;line-height:1.6;}"
                "h2{color:#e74c3c;}code{color:#5dade2;}"
                ".tip{color:#7a8090;font-size:13px;}</style></head><body>"
                "<div class='box'><h2>⚠️ 分析未能完成</h2>"
                f"<p>{msg}</p>"
                "<p class='tip'>可能原因：该股票停牌/退市、当前为非交易时间，"
                "或网络无法访问行情接口。可稍后重试，或在命令行运行 "
                "<code>python multi_agent_stock_analysis.py " + code + "</code> "
                "查看详细日志。</p></div></body></html>"
            )
            self._send(502, err_html.encode("utf-8"), "text/html; charset=utf-8")
            return
        if fmt == "json":
            self._send_json(200, {"ok": True, "code": code, "format": "html"})
            return
        self._send(200, html.encode("utf-8"), "text/html; charset=utf-8")

    def log_message(self, fmt, *args):
        # 过滤静态资源的噪音日志，只保留 API 请求
        if self.path.startswith("/api/"):
            sys.stderr.write("[API] " + (fmt % args) + "\n")


def main():
    port = 8888
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    httpd = http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"✅ 本地看板服务已启动： http://localhost:{port}/a-stock-dashboard.html")
    print(f"   AI 分析接口：          http://localhost:{port}/api/analyze?code=600519")
    print("   按 Ctrl+C 停止。")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")


if __name__ == "__main__":
    main()
