@echo off
chcp 65001 >nul
:: Opens TCP port 8768 in Windows Firewall so phones/tablets in your Wi-Fi can connect.
:: Run once. Asks for administrator rights.

net session >nul 2>&1
if errorlevel 1 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

netsh advfirewall firewall delete rule name="Strizhi game 8768" >nul 2>&1
netsh advfirewall firewall add rule name="Strizhi game 8768" dir=in action=allow protocol=TCP localport=8768 profile=private,public
if errorlevel 1 (
    echo [!] Failed to add the firewall rule.
) else (
    echo [+] Port 8768 is open. Phones can now connect to the game server.
)
echo.
echo To remove the rule later run:
echo   netsh advfirewall firewall delete rule name="Strizhi game 8768"
echo.
pause
