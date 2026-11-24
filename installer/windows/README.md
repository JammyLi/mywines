# Windows 安裝檔

## 產生安裝檔（開發者）

```bash
sudo apt install nsis        # macOS：brew install makensis
installer/windows/build.sh   # → installer/windows/out/MyWines-<版本>.zip（給客戶下載）與 MyWines-Setup-<版本>.exe
```

給客戶的是 `MyWines-<版本>.zip`，內含安裝程式、`使用手冊.pdf`、`readme.1st.txt`（第一次安裝與升級說明）。
手冊有更新時，把新的 PDF 覆蓋 `installer/windows/docs/使用手冊.pdf` 再重新產生。

安裝檔內含：Windows 版 Node.js 22、程式、執行套件（含 Windows 版 better-sqlite3）、WinSW 服務程式。
客戶電腦不需要先安裝任何東西。

## 安裝檔做了什麼

| 項目 | 位置 / 內容 |
|---|---|
| 程式 | `C:\Program Files\MyWines` |
| 資料（資料庫、照片、憑證、備份、紀錄） | `C:\ProgramData\MyWines` |
| Windows 服務 | 「MyWines Wine Inventory」，開機自動執行、當掉 10 秒後自動重啟，不需要登入 |
| 防火牆 | 開放 TCP 3000、3443，只限同一個網路（localsubnet） |
| 捷徑 | 桌面「酒窖庫存」；開始功能表 MyWines：酒窖庫存、手機設定、連線位址、資料與備份資料夾、解除安裝 |

- **升級**：直接執行新版安裝檔；會先停止服務、換掉程式、再啟動。資料不動。
- **解除安裝**：控制台 › 應用程式，或開始功能表的「解除安裝」。資料保留在 `C:\ProgramData\MyWines`。
- **搬資料**：把舊電腦 `data/` 裡的 `mywines.db` 與 `photos/` 複製到 `C:\ProgramData\MyWines`
  （先在「服務」裡停止 MyWines，複製完再啟動）。`tls/` 不用複製，會自動重建（手機需要重新安裝憑證）。

## 手機（iPhone / Android）

手機不需要安裝檔。在伺服器電腦按開始功能表「MyWines › 手機設定」，用手機相機掃畫面上的 QR Code，
照著頁面安裝憑證，再「加入主畫面」。之後就像 App 一樣從主畫面開啟。

## 注意

- 安裝檔沒有數位簽章，第一次執行時 Windows 可能顯示「Windows 已保護您的電腦」：按「其他資訊 › 仍要執行」。
- 伺服器電腦最好在路由器設定**固定 IP**，否則 IP 變了，其他電腦與手機的網址也要跟著改。
- 伺服器電腦不能睡眠（設定 › 系統 › 電源 › 螢幕與睡眠 › 接上電源時，睡眠「永不」）。
