#!/bin/zsh
# クライアントとサーバーのTypeScriptを同時にwatchモードでビルド
cd "$(dirname $0)"
npx concurrently "cd client && npm run watch" "cd server && npm run watch"
