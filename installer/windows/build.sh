#!/usr/bin/env bash
# 產生 Windows 安裝檔：installer/windows/out/MyWines-Setup-<版本>.exe
# 需要：Linux 或 macOS、Node 22、makensis（apt install nsis / brew install makensis）、可連 GitHub 與 npm
set -euo pipefail
cd "$(dirname "$0")"
HERE=$(pwd); REPO=$(cd ../.. && pwd)
NODE_VER=22.23.4          # 內附的 Windows 版 Node（ABI 127）
WINSW_VER=2.12.0
VERSION=$(node -p "require('$REPO/package.json').version")
CACHE="$HERE/.cache"; STAGE="$HERE/.stage"; OUT="$HERE/out"
mkdir -p "$CACHE" "$OUT"; rm -rf "$STAGE"; mkdir -p "$STAGE/app"

echo "1/5 建置網頁"
(cd "$REPO" && npm run build >/dev/null)

echo "2/5 複製程式"
cp -R "$REPO/server" "$REPO/dist" "$REPO/package.json" "$STAGE/app/"
[ -f "$REPO/package-lock.json" ] && cp "$REPO/package-lock.json" "$STAGE/app/"
mkdir -p "$STAGE/app/scripts" && cp "$REPO/scripts/"*.js "$STAGE/app/scripts/"

echo "3/5 安裝執行套件（Windows 版）"
(cd "$STAGE/app" && npm install --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null)
BS3=$(node -p "require('$STAGE/app/node_modules/better-sqlite3/package.json').version")
ABI=$(node -p "process.versions.modules")
[ "$(node -v)" = "v$NODE_VER" ] || ABI=127
BS3_TGZ="$CACHE/better-sqlite3-$BS3-win.tgz"
[ -f "$BS3_TGZ" ] || curl -fsSL -o "$BS3_TGZ" "https://github.com/WiseLibs/better-sqlite3/releases/download/v$BS3/better-sqlite3-v$BS3-node-v$ABI-win32-x64.tar.gz"
rm -rf "$STAGE/app/node_modules/better-sqlite3/build"
tar xzf "$BS3_TGZ" -C "$STAGE/app/node_modules/better-sqlite3"
find "$STAGE/app/node_modules" -name "*.node" ! -path "*better-sqlite3/build/Release/*" -delete

echo "4/5 下載 Node.exe 與服務程式"
if [ ! -f "$CACHE/node-$NODE_VER.exe" ]; then
  (cd "$CACHE" && npm pack "node-win-x64@$NODE_VER" >/dev/null && tar xzf "node-win-x64-$NODE_VER.tgz" package/bin/node.exe && mv package/bin/node.exe "node-$NODE_VER.exe" && rm -rf package "node-win-x64-$NODE_VER.tgz")
fi
cp "$CACHE/node-$NODE_VER.exe" "$STAGE/node.exe"
[ -f "$CACHE/WinSW-$WINSW_VER.exe" ] || curl -fsSL -o "$CACHE/WinSW-$WINSW_VER.exe" "https://github.com/winsw/winsw/releases/download/v$WINSW_VER/WinSW-x64.exe"
cp "$CACHE/WinSW-$WINSW_VER.exe" "$STAGE/MyWinesService.exe"
cp "$HERE/files/"* "$STAGE/"
cp "$REPO/public/icon-512.png" "$STAGE/" 2>/dev/null || true

echo "5/5 打包安裝檔"
makensis -V2 -DVERSION="$VERSION" -DSTAGE="$STAGE" -DOUTFILE="$OUT/MyWines-Setup-$VERSION.exe" "$HERE/mywines.nsi"
ls -lh "$OUT/MyWines-Setup-$VERSION.exe"
