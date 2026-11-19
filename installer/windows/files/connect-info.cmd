@echo off
chcp 65001 >nul
title MyWines 連線位址
echo.
echo  酒窖庫存系統正在這台電腦上執行。
echo.
echo  這台電腦：  http://localhost:3000
echo.
echo  其他電腦（同一個網路）：
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do for /f "tokens=*" %%b in ("%%a") do echo     http://%%b:3000
echo.
echo  手機第一次使用，請用手機開：
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do for /f "tokens=*" %%b in ("%%a") do echo     http://%%b:3000/setup
echo.
echo  （有好幾個位址時，用和手機同一個 Wi-Fi 的那一個，通常是 192.168 開頭）
echo.
pause
