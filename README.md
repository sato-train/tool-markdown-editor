# Markdown Editor

Windowsの「プログラムから開く」からMarkdownファイルを開ける、Electron製のエディターです。

## 開発

```powershell
npm install
npm run dev
npm run dev -- "C:\\path\\to\\document.md"
```

## 検証と配布

```powershell
npm test
npm run build
npm run dist
```

`npm run dist` が生成するNSISインストーラーを実行すると、`.md` と `.markdown` のファイル関連付けが登録されます。
