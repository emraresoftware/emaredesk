@echo off
REM RemoteView - Baslatma Scripti (Windows)

cd /d "%~dp0"

echo RemoteView bagimliliklari kontrol ediliyor...

REM Python kontrolu
python --version >nul 2>&1
if errorlevel 1 (
    python3 --version >nul 2>&1
    if errorlevel 1 (
        echo X Python bulunamadi. Lutfen yukleyin: https://python.org
        pause
        exit /b 1
    )
    set PYTHON=python3
) else (
    set PYTHON=python
)

REM pip bagimliliklari
%PYTHON% -m pip install -q -r requirements.txt 2>nul

echo.
echo RemoteView sunucusu baslatiliyor...
echo.

%PYTHON% server.py

pause
