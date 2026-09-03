@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === 한화에몽 사이트 배포 ===
git add -A
git diff --cached --quiet && (echo 변경 사항 없음. & pause & exit /b 0)
set /p msg="커밋 메시지 (엔터=자동): "
if "%msg%"=="" set msg=update %date% %time%
git commit -m "%msg%"
git push
echo.
echo 완료. 1~2분 뒤 https://jueun1231-create.github.io/hanwha-emong/ 에 반영됩니다.
pause
