@echo off
chcp 65001 >nul
title BAKUGAN - Battle Brawlers
cd /d "%~dp0"
echo Запускаю сервер...
start "" http://localhost:8123
python server.py
pause
