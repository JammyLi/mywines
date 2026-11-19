; MyWines 酒窖庫存 — Windows 安裝程式（NSIS 3, Unicode）
; 由 build.sh 呼叫：makensis -DVERSION=… -DSTAGE=… -DOUTFILE=… mywines.nsi
Unicode true
ManifestDPIAware true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!define APP "MyWines"
!define APPNAME "MyWines 酒窖庫存"
!define SVC "MyWines"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\MyWines"

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\MyWines"
InstallDirRegKey HKLM "${UNINST_KEY}" "InstallLocation"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
BrandingText "${APPNAME} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "MyWines"
VIAddVersionKey "FileDescription" "MyWines Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" " "

!define MUI_ICON "${STAGE}\mywines.ico"
!define MUI_UNICON "${STAGE}\mywines.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "這個程式會把「酒窖庫存系統」安裝在這台電腦上，並設定成開機自動執行。$\r$\n$\r$\n公司裡的其他電腦和手機，只要連上同一個網路，就能用瀏覽器開啟，不需要另外安裝。$\r$\n$\r$\n資料只存在這台電腦（C:\ProgramData\MyWines），不會上傳到網路。"
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "現在開啟酒窖庫存系統"
!define MUI_FINISHPAGE_RUN_FUNCTION OpenApp
!define MUI_FINISHPAGE_SHOWREADME
!define MUI_FINISHPAGE_SHOWREADME_TEXT "顯示手機設定頁（給手機掃描）"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION OpenSetup
!define MUI_FINISHPAGE_TEXT "安裝完成。$\r$\n$\r$\n初始帳號：jammy　密碼：123456（第一次登入後請到「設定 › 使用者」修改）。$\r$\n$\r$\n開始功能表的「MyWines › 連線位址」會顯示其他電腦和手機要輸入的網址。"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "TradChinese"

Var DATA

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "這個程式需要 64 位元的 Windows 10 或 11。"
    Abort
  ${EndIf}
  SetRegView 64
FunctionEnd

Function OpenApp
  Sleep 1500
  ExecShell "open" "http://localhost:3000"
FunctionEnd
Function OpenSetup
  ExecShell "open" "http://localhost:3000/setup"
FunctionEnd

!macro StopService
  IfFileExists "$INSTDIR\MyWinesService.exe" 0 +4
    nsExec::ExecToLog '"$INSTDIR\MyWinesService.exe" stop'
    nsExec::ExecToLog '"$INSTDIR\MyWinesService.exe" uninstall'
    Sleep 2000
!macroend

Section "Install"
  SetShellVarContext all
  StrCpy $DATA "$APPDATA\MyWines"   ; = C:\ProgramData\MyWines

  DetailPrint "停止舊版服務（如果有）…"
  !insertmacro StopService
  RMDir /r "$INSTDIR\app\server"
  RMDir /r "$INSTDIR\app\dist"
  RMDir /r "$INSTDIR\app\node_modules"

  SetOutPath "$INSTDIR"
  File "${STAGE}\node.exe"
  File "${STAGE}\MyWinesService.exe"
  File "${STAGE}\mywines.ico"
  File "${STAGE}\connect-info.cmd"
  File /r "${STAGE}\app"

  CreateDirectory "$DATA"
  CreateDirectory "$DATA\logs"
  CreateDirectory "$DATA\backup"

  DetailPrint "設定 Windows 服務…"
  FileOpen $0 "$INSTDIR\MyWinesService.xml" w
  FileWrite $0 '<service>$\r$\n'
  FileWrite $0 '  <id>${SVC}</id>$\r$\n'
  FileWrite $0 '  <name>MyWines Wine Inventory</name>$\r$\n'
  FileWrite $0 '  <description>MyWines wine inventory server (http 3000, https 3443)</description>$\r$\n'
  FileWrite $0 '  <executable>$INSTDIR\node.exe</executable>$\r$\n'
  FileWrite $0 '  <arguments>"$INSTDIR\app\server\index.js"</arguments>$\r$\n'
  FileWrite $0 '  <workingdirectory>$INSTDIR\app</workingdirectory>$\r$\n'
  FileWrite $0 '  <env name="MYWINES_DATA" value="$DATA"/>$\r$\n'
  FileWrite $0 '  <env name="MYWINES_DB" value="$DATA\mywines.db"/>$\r$\n'
  FileWrite $0 '  <env name="NODE_ENV" value="production"/>$\r$\n'
  FileWrite $0 '  <startmode>Automatic</startmode>$\r$\n'
  FileWrite $0 '  <onfailure action="restart" delay="10 sec"/>$\r$\n'
  FileWrite $0 '  <stoptimeout>15 sec</stoptimeout>$\r$\n'
  FileWrite $0 '  <logpath>$DATA\logs</logpath>$\r$\n'
  FileWrite $0 '  <log mode="roll-by-size"><sizeThreshold>2048</sizeThreshold><keepFiles>5</keepFiles></log>$\r$\n'
  FileWrite $0 '</service>$\r$\n'
  FileClose $0
  nsExec::ExecToLog '"$INSTDIR\MyWinesService.exe" install'
  nsExec::ExecToLog '"$INSTDIR\MyWinesService.exe" start'

  DetailPrint "開放防火牆（只限同一個網路）…"
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="MyWines"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="MyWines" dir=in action=allow protocol=TCP localport=3000,3443 remoteip=localsubnet profile=any'

  DetailPrint "建立捷徑…"
  CreateDirectory "$SMPROGRAMS\MyWines"
  WriteINIStr "$SMPROGRAMS\MyWines\酒窖庫存.url" "InternetShortcut" "URL" "http://localhost:3000"
  WriteINIStr "$SMPROGRAMS\MyWines\酒窖庫存.url" "InternetShortcut" "IconFile" "$INSTDIR\mywines.ico"
  WriteINIStr "$SMPROGRAMS\MyWines\酒窖庫存.url" "InternetShortcut" "IconIndex" "0"
  WriteINIStr "$SMPROGRAMS\MyWines\手機設定.url" "InternetShortcut" "URL" "http://localhost:3000/setup"
  WriteINIStr "$SMPROGRAMS\MyWines\手機設定.url" "InternetShortcut" "IconFile" "$INSTDIR\mywines.ico"
  WriteINIStr "$SMPROGRAMS\MyWines\手機設定.url" "InternetShortcut" "IconIndex" "0"
  CreateShortCut "$SMPROGRAMS\MyWines\連線位址.lnk" "$INSTDIR\connect-info.cmd" "" "$INSTDIR\mywines.ico"
  CreateShortCut "$SMPROGRAMS\MyWines\資料與備份資料夾.lnk" "$DATA"
  CreateShortCut "$SMPROGRAMS\MyWines\解除安裝.lnk" "$INSTDIR\Uninstall.exe"
  WriteINIStr "$DESKTOP\酒窖庫存.url" "InternetShortcut" "URL" "http://localhost:3000"
  WriteINIStr "$DESKTOP\酒窖庫存.url" "InternetShortcut" "IconFile" "$INSTDIR\mywines.ico"
  WriteINIStr "$DESKTOP\酒窖庫存.url" "InternetShortcut" "IconIndex" "0"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "Publisher" "MyWines"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\mywines.ico"
  WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Function un.onInit
  SetRegView 64
FunctionEnd

Section "Uninstall"
  SetShellVarContext all
  nsExec::ExecToLog '"$INSTDIR\MyWinesService.exe" stop'
  nsExec::ExecToLog '"$INSTDIR\MyWinesService.exe" uninstall'
  Sleep 2000
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="MyWines"'
  RMDir /r "$SMPROGRAMS\MyWines"
  Delete "$DESKTOP\酒窖庫存.url"
  RMDir /r "$INSTDIR\app"
  Delete "$INSTDIR\node.exe"
  Delete "$INSTDIR\MyWinesService.exe"
  Delete "$INSTDIR\MyWinesService.xml"
  Delete "$INSTDIR\mywines.ico"
  Delete "$INSTDIR\connect-info.cmd"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKLM "${UNINST_KEY}"
  MessageBox MB_ICONINFORMATION "已解除安裝程式。$\r$\n$\r$\n資料沒有刪除，仍保存在 $APPDATA\MyWines。重新安裝後會自動接續使用。"
SectionEnd
