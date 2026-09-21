# Tailwind QR Playground

スマホ・PC対応のステートレスTailwind CSSプレイグラウンド。HTMLとTailwind CSSをURLに埋め込み、分割QRを**一枚のPNG/SVG**として紙面やスライドに掲載できます。保存サーバー、DB、ログインはありません。

## 前提・起動

- Node.js 22.12以上、npm
- 本番配信はHTTPS。カメラのテストではlocalhostも利用可能
- Tailwind CSSは4.3.3を固定し、ビルド成果物に同梱

```sh
git clone https://github.com/kght6123/tailwind-qr-playground.git
cd tailwind-qr-playground
npm ci
npm run dev
```

HTML/CSSを編集し「QR一覧を作る」を押します。「QR一覧を画像で保存（PNG）」または「SVGで保存」で、全QR・番号・説明を含む一枚の画像を取得できます。個別保存は不要です。

最初のQRを端末カメラで開き、残りはページ内の「残りのQRをカメラで読む」で撮影します。PCのWebカメラにも対応。順不同・重複読取が可能です。カメラを使わず、元の一覧PNGを選択して全断片をまとめて復元することもできます。一般の写真はQR一つを大きく写してください。

## ビルド・配置

```sh
npm run build
npm run preview
```

`dist/` をHTTPSの静的ホスティングへ配置します。相対アセットパスなのでサブディレクトリ配信にも対応。URLは開いているページから生成されます。localhostで作ったQRは別端末では利用できません。公開前に最終配信先でQRを生成してください。mainへのpushでGitHub Actionsがテスト・ビルドし、GitHub Pagesへ自動デプロイします。

## 共有仕様 v1

```text
https://<配信先>/#v1.<SHA-256 hex>.<1始まり番号>.<総数>.<断片>
```

`{html,css}` をJSON → UTF-8 → raw DEFLATE → Base64URL（paddingなし）に変換して分割。ハッシュは圧縮バイト列全体を対象とします。v1の描画環境はTailwind 4.3.3です。将来の更新は形式バージョンを分け、旧形式の読取環境を維持してください。

- URL全体800バイト以下／枚、誤り訂正M、最大16枚
- 展開後JSONは64 KiB以下。展開途中でも上限を確認
- 単一QRも同じ形式で総数1。各断片に完全な起動URLを含む
- 同一オリジン・パスのQRだけを受け入れ、読取URLへの自動遷移はしない
- 読取状態はメモリだけ。再読み込みでは現在のURLに含まれる断片から読み直す
- サンプル名は画像見出し・ファイル名用で、共有コードには含まれない

## 一枚画像の仕様

1枚は1列、2〜4枚は2列、5〜9枚は3列、10〜16枚は4列。左上から行順に配置します。全QRのバージョンを最大のものに揃え、セルの寸法を統一します。

- 白背景・黒いQR、1モジュール8 px、各辺4モジュールの余白
- 外側・セル間の余白32 px、上部説明144 px、番号欄72 px
- サンプル名は先頭24文字。画像幅に合わせて見出しサイズを調整
- PNGは整数ピクセルで描画。SVGも同じ配置
- 元のPNGは寸法からグリッドを識別し、全セルを個別解析して復元
- 加工・縮小済み画像や写真での複数QR自動復元は保証しない
- 入力画像は32 MiB以下・3200万画素以内、PNG/JPEG/WebP。SVG入力は対象外

## 安全性・制限

プレビューはopaque originのsandbox iframeで実行。HTMLをDOMPurifyで処理し、任意スクリプト、イベント属性、外部リソース、リンク遷移を除去。CSPで通信・フォーム送信を禁止し、Tailwindランタイムだけnonceで許可します。カメラ権限は親画面のみ、音声は取得せず、終了・非表示時に停止します。画像は端末内で解析し、アップロードしません。

任意JavaScript・React・外部画像・フォント・追加プラグイン・ファイルインポートは対象外。初回取得には通信が必要です。コードは暗号化されず、QRの取得者は復元できます。配信URL・旧形式を維持しないと印刷済みQRは利用できなくなります。

800バイトは初期の読取サイズ設定で、紙面や投影に対する保証値ではありません。実際の掲載サイズ・距離・端末で全QRを検証してください。Tailwindの新しいCSS機能にはブラウザ差があります。

## 検証

```sh
npm test
npx playwright install chromium firefox webkit
npm run test:e2e
npm run build
```

ユニットテスト6件は往復復元、順不同・重複、不正断片、上限、配置閾値、過大な展開を確認。ブラウザテストはChromium・Firefox・WebKitでTailwind表示と実行分離、PNGダウンロードからの復元、1/2/4/5/9/10/16枚グリッド、スマホ幅とカメラ拒否を確認します。Chromiumでは疑似カメラ映像で連続読取と完了時の停止も検証します（他2エンジンではこの疑似映像テストをスキップ）。

実物カメラ、iPhone/Android実機、紙面・投影の読取性能は手動検証が必要です。自動テストの成功を実機確認の代わりにはしません。

## コーディングエージェント向けCLI（npx）

Node.js **22.12以上**とGitが必要です。npmレジストリへの公開は行わず、GitHubから直接実行できます。

```sh
npx --yes github:kght6123/tailwind-qr-playground \
  --html ./sample.html \
  --css ./sample.css \
  --title "カードのサンプル" \
  --out ./output/card.png \
  --json
```

- `--html` はHTMLコードのUTF-8ファイル。`--css` は省略可能です。HTML内の外部CSSファイルなどは自動では取り込みません。
- `.png` / `.svg` を `--out` の拡張子で選択します。省略時は `qr.png`。
- 分割されたQRも、一つのサンプルにつき**一枚の一覧画像**になります。
- 読み取り先は公開中の `https://kght6123.github.io/tailwind-qr-playground/`。独自ドメインなどを使う場合は `--base-url https://example.com/` を指定します。
- コードはローカルで処理し、アップロードしません。初回のnpx実行にはツールと依存パッケージのダウンロードが必要です。
- Web版と同じ64 KiB・最大16分割の制限です。
- 出力先ディレクトリは自動作成します。既存ファイルは `--force` を付けた場合だけ上書きします。
- 成功時は終了コード0、失敗時は1。`--json` は標準出力にJSONだけを出し、エラーは標準エラー出力に出します。
- PNG内の文字は実行環境のフォントを使います。日本語フォントがない環境では `--font ./JapaneseFont.ttf`（OTF/TTCも可）を指定してください。SVGは閲覧・掲載環境のフォントで描画されます。
- 再現性が必要な運用では `github:kght6123/tailwind-qr-playground#<コミットSHA>` としてバージョンを固定できます。

### 複数サンプルの一括生成

`samples.json`:

```json
[
  { "html": "card.html", "css": "card.css", "title": "カード", "out": "output/card.png" },
  { "html": "button.html", "title": "ボタン", "out": "output/button.svg" }
]
```

```sh
npx --yes github:kght6123/tailwind-qr-playground --manifest ./samples.json --json
```

一覧中のファイルパスは**JSONファイルのあるディレクトリ基準**です。各項目には `baseUrl` も指定できます。全項目の入力・出力を検証してから生成を開始します。

JSON出力は `{ "results": [...] }` で、各結果に `output`（絶対パス）、`format`、`title`、`qrCount`、`width`、`height`、`urls`（全QRのURL）を含みます。コーディングエージェントはHTML/CSSをファイルに保存し、このコマンドを一度実行すれば画像まで生成できます。

### CLIのローカル開発

```sh
npm ci
npm run build:cli
node cli-dist/index.mjs --help
npm test
```

GitHubからのnpxインストール時は `prepare` でCLIをビルドします。配布ファイルは `cli-dist`、README、LICENSE、package.jsonに限定し、Web用の開発ツールは実行時依存に含めません。

## エージェント用スキル

`skills/tailwind-qr` に、このCLIでQR画像を作成するAgent Skillを同梱しています。単体・一括生成、PNG/SVGの選択、出力結果の確認に対応します。

```sh
npx skills add kght6123/tailwind-qr-playground --skill tailwind-qr
```

Codexへユーザー単位で入れる場合:

```sh
npx skills add kght6123/tailwind-qr-playground --skill tailwind-qr --agent codex --global
```

使用例: `$tailwind-qr を使って、sample.htmlとsample.cssから掲載用のQR一覧PNGを作成してください。`
