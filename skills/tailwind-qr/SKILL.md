---
name: tailwind-qr
description: HTML/CSSサンプルをTailwind QR Playgroundで開けるQR一覧画像（PNG/SVG）に変換する。紙面掲載用のQR作成、分割QRを一枚にまとめる出力、複数サンプルの一括生成を依頼されたときに使う。
---

# Tailwind QR

HTML/CSSファイルから、公開中のTailwind QR Playgroundで復元できるQR一覧画像を生成する。標準の編集画面を操作する必要はない。

## 単体生成

Node.js 22.12以上とGitが必要。既存のHTML/CSSファイルを利用し、コードの作成・変更は依頼に含まれる場合だけ行う。入力ファイルはUTF-8。HTMLはプレビューに表示したい断片、CSSは別ファイルにする。外部CSS・画像などの依存ファイルはCLIでは取り込まれない。

```sh
npx --yes github:kght6123/tailwind-qr-playground \
  --html ./sample.html \
  --css ./sample.css \
  --title "サンプル" \
  --out ./output/sample.png \
  --json
```

`--css` は省略可。PNGを標準とし、SVG指定なら出力拡張子を `.svg` にする。分割数にかかわらず、一つのサンプルのQRは一枚の画像にまとまる。引数にはシェルとして適切にクォートしたパスやタイトルを渡す。

## 一括生成

複数サンプルにはJSONマニフェストを使う。ファイルパスはマニフェストのあるディレクトリ基準。

```json
[
  { "html": "card.html", "css": "card.css", "title": "カード", "out": "output/card.png" },
  { "html": "button.html", "title": "ボタン", "out": "output/button.svg" }
]
```

```sh
npx --yes github:kght6123/tailwind-qr-playground --manifest ./samples.json --json
```

`--manifest` と `--html` / `--css` / `--title` / `--out` は併用しない。標準出力の `{ "results": [...] }` を読み取り、各結果の `output`、`qrCount`、`width`、`height` を確認する。`urls` には全QRのURLが入る。終了コードが0であることと生成ファイルを確認し、ユーザーへ画像のリンクと必要な場合だけ分割数を伝える。PNGは可能なら画像を開き、日本語タイトルの欠けを確認する。

## 出力条件・エラー時

- 読み取り先は `https://kght6123.github.io/tailwind-qr-playground/`。ユーザーが別の配信先を指定した場合だけ `--base-url`（一括では各項目の `baseUrl` も可）を使う。HTTP(S)のページURLを指定し、認証情報・クエリ・フラグメントは付けない。
- PNGのタイトルには環境のフォントを使う。日本語フォントがない場合は利用可能なTTF/OTF/TTCを `--font /path/to/font.ttf` で渡す。SVGのフォントは閲覧環境に依存する。
- HTML/CSSを含むJSONは64 KiB以内、QRは最大16分割。超過したら理由を報告し、ユーザーのコードを勝手に削除・切り詰めしない。
- 既存出力は通常上書きされない。出力の更新が依頼されている場合に `--force` を使う。入力ファイルと出力先を同じにしない。
- エラーは標準エラー、終了コード1。原因に対応して再実行し、同じ失敗を無条件に繰り返さない。
- コードは端末内で処理される。初回npx実行時はCLIと依存パッケージを取得するためネット接続が必要。
- 再現性が必要ならGitHub指定に `#<コミットSHA>` を付ける。引数の詳細はCLIの `--help`、[リポジトリのREADME](https://github.com/kght6123/tailwind-qr-playground#readme)を参照する。
