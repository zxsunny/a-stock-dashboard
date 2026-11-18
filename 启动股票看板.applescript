-- A股智能分析看板 · 桌面启动器（AppleScript 版）
-- 编译（顺序不能错，沿用 code16 学习助手 2026-10-18 踩坑记录）：
--   1) osacompile -o "$HOME/Desktop/Creat tools/股票看板.app" 启动股票看板.applescript
--   2) PlistBuddy 加 LSBackgroundOnly = true   ← osacompile 默认不带
--   3) codesign --force --deep --sign - <app>   ← 必须带 --deep，漏了会静默失败
--   4) codesign --verify <app>                  ← 必须校验通过才能交付
--
-- 🔴 坑（写这个脚本别改回去，详见 code16 启动学习助手.applescript）：
--   1. 变量名禁用保留字 `url` / `port`（会报 -10006）。
--   2. 判活只看 curl 退出码（-f + 0 = 通），不能 -o /dev/null 后 grep。
--   3. 不能用 lsof -ti 判活：端口被占 ≠ 服务可用。
--   4. 本机没有 /usr/bin/test，`test` 不写绝对路径（用 sh 内建）。
--   5. `display alert` 参数是 `as informational`，写成 informative 会 -2753。
--   6. 后台启动必须 `( nohup … & )` 包一层，否则 do shell script 永不返回、App 卡死。
--
-- 服务：~/.local/venvs/ex03-stock313/bin/python server.py 8888（需 Python ≥ 3.10）
-- 页面：http://localhost:8888/a-stock-dashboard.html   判活：/api/health
on run
	set appDir to "/Users/zhangxu/2.1 学习 AI 笔记与练习/3. code_project/执行3 股票看板 a-stock-dashboard （Trae）"
	set homeUrl to "http://127.0.0.1:8888/a-stock-dashboard.html"
	set healthUrl to "http://127.0.0.1:8888/api/health"
	set pyPath to "/Users/zhangxu/.local/venvs/ex03-stock313/bin/python"
	set logDir to appDir & "/.tmp"

	-- 虚拟环境不存在 → 直接弹窗说明
	if not my FileExists(pyPath) then
		display alert "启动失败" message ("找不到 Python 3.13 虚拟环境，请确认路径：" & return & pyPath) as informational
		return
	end if

	-- 1) 已经能用？直接开浏览器（秒退，不等、不占 Dock）
	if my IsAlive(healthUrl) then
		do shell script "/usr/bin/open -a Safari " & quoted form of homeUrl
		return
	end if

	-- 2) 没在跑但端口被残留进程占着？先清掉，否则新服务起不来
	try
		set stale to do shell script "/usr/sbin/lsof -ti :8888"
		if stale is not "" then
			do shell script "/bin/kill " & stale
			delay 1.5
		end if
	end try

	-- 3) 后台静默启动（主进程立刻退出，不占 Dock）
	--    🔴 必须用 `( … & )` 把后台任务再包一层，否则 do shell script 永不返回
	do shell script "mkdir -p " & quoted form of logDir
	do shell script "cd " & quoted form of appDir & " && ( /usr/bin/nohup " & quoted form of pyPath & " server.py 8888 > .tmp/serve.log 2>&1 < /dev/null & )"

	-- 4) 等服务就绪后再开浏览器（最多等 40 秒）
	repeat 80 times
		delay 0.5
		if my IsAlive(healthUrl) then
			do shell script "/usr/bin/open -a Safari " & quoted form of homeUrl
			return
		end if
	end repeat

	-- 5) 超时 → 弹窗告知，不静默失败
	display alert "启动失败" message ("服务在 40 秒内没起来。日志见：" & return & logDir & "/serve.log") as informational
end run

on IsAlive(theUrl)
	try
		do shell script "/usr/bin/curl -s --noproxy '*' -f --max-time 2 -o /dev/null " & quoted form of theUrl
		return true
	on error
		return false
	end try
end IsAlive

on FileExists(p)
	try
		-- 🔴 不写绝对路径：本机没有 /usr/bin/test，用 sh 内建的 test
		do shell script "test -x " & quoted form of p
		return true
	on error
		return false
	end try
end FileExists
