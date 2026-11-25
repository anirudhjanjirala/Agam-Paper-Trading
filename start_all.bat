@echo off
title Agam Paper Trading Platform
python "%~dp0start_agam.py" %*
if errorlevel 1 pause
