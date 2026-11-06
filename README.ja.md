# better-opencode

[English](README.md) | 日本語

コードベースを理解し、予算を守り、自分の作業を検証できるコーディングエージェントを求める開発者のための、[opencode](https://github.com/anomalyco/opencode) のフォーカスしたフォークです。

> better-opencode は独立したフォークであり、Anomaly Innovations とは提携していません。OpenCode は Anomaly Innovations, Inc. の商標です。上流の変更を継続的にマージできるよう、ランタイムと `@opencode/*` パッケージ名前空間は上流のまま維持しています。

## ステータス

初期開発中です。better-opencode は上流の opencode v2 を追従しており、TUI ファーストです。デスクトップアプリと Web UI は削除済みで、ターミナルインターフェースが唯一のクライアントです。TUI の表示言語は既定で日本語です。英語に切り替えるには **設定 → 言語** を使います。

| ブランチ          | 用途                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `main`            | better-opencode の開発ブランチ。フォークの機能はここに入ります。                              |
| `upstream`        | 上流 `anomalyco/opencode` の `dev` をそのまま保持するミラー。フォークのコミットは置きません。 |
| `origin/upstream` | 同期に使う上流の `dev`。                                                                      |

## 機能

バージョン管理ドック、タスクグラフ、ファイルマネージャーはこのフォークで実装した機能です。TUI ツールと新しいデザインは上流由来の機能で、このフォークでは設定画面に表示し、既定で有効にしています。

TUI では以下の機能がすべて既定で有効です。**設定 → 機能**、または「実験的機能」ダイアログから個別にオン・オフできます。

| 機能                 | 内容                                                                                                                                                                                                                                                                                                              | ドキュメント                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| バージョン管理ドック | タブバーの横に jj・Git・Mercurial の状態を表示し、内蔵のバージョン管理ビューを開きます。TUI を離れずに diff の確認、ブックマーク／ブランチの管理、jj チェンジの describe や split、Git のステージ・コミット・fetch・pull・push ができます。`lazyjj`・`jjui`・`lazygit` は任意の外部ツールとして引き続き使えます。 | [docs/vcs-dock.md](docs/vcs-dock.md)         |
| タスクグラフ         | エージェントのタスク、依存関係、実行状況をグラフで表示します。`/divide <指示>` は指示をタスクグラフに分割し、依存順に作業を進めます。jj リポジトリではタスクにブックマークとチェンジを紐付けられます。                                                                                                            | [docs/task-graph.md](docs/task-graph.md)     |
| ファイルマネージャー | 現在のセッションの場所を閲覧し、プレビューする読み取り専用ブラウザです。`<leader>f` または `/files` で開きます。                                                                                                                                                                                                  | [docs/file-manager.md](docs/file-manager.md) |
| TUI ツール           | エージェントが実行中の TUI 内にターミナルを開けるようにします（サーバー側の対応が必要です）。                                                                                                                                                                                                                     | —                                            |
| 新しいデザイン       | 刷新された TUI の画面をプレビューします。                                                                                                                                                                                                                                                                         | —                                            |

このほか、日本語インターフェース、スタンドアロンインストール向けのフォーク対応アップデート確認、デスクトップ／Web クライアントの削除もフォーク固有の変更です。

## インストール

ビルド済みの CLI バイナリは [リリースページ](https://github.com/TeamFlaxia/better-opencode/releases) で公開しています。Linux は `opencode-<version>-<target>.tar.gz`、macOS と Windows は `.zip` を取得し、`SHA256SUMS.txt` で検証してから `opencode` を `PATH` に置いてください。

curl でインストールしたビルド（`~/.opencode/bin/opencode`）は、`opencode upgrade` でこのフォークの GitHub Releases を確認します。既定の更新ポリシーは通知のみです。自動インストールを有効にするには、グローバル設定で `"update": "auto"` を指定します。パッケージマネージャー経由のインストールは、引き続き上流の更新サービスを使います。

ソースから実行する場合は、Bun 1.4.4（`.bun-version` で固定）を導入します。

```bash
curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.4"
bun install
bun run dev
```

## 開発

```bash
bun run dev            # ローカルビルドの V2 CLI / TUI
bun run dev:live       # インストール済み opencode サービスに接続する開発用 TUI
bun run check          # lint + typecheck
```

`dev:live` は選択中のバックグラウンドサーバーを検出し、ローカル資格情報を注入します。対象ディレクトリを指定する場合はスクリプトの後ろに渡します。

```bash
bun run dev:live /path/to/project
```

テストは必ずパッケージディレクトリから実行します。リポジトリルートからの実行はブロックされています。

```bash
cd packages/core
bun run test
bun typecheck
```

`bun run test:fast` はローカル反復向けにテストファイルを並列実行します。CI は直列の `test` を使います。リポジトリルートの `bun run test:affected` は、変更の影響を受けるパッケージだけをテストします。

リポジトリ構成:

| パス                | 役割                                             |
| ------------------- | ------------------------------------------------ |
| `packages/schema`   | 共有スキーマ、永続イベント、設定型               |
| `packages/core`     | ドメインロジック、永続化、ツール、セッション実行 |
| `packages/protocol` | 公開 HTTP API 定義                               |
| `packages/server`   | HTTP サーバーとランタイム合成                    |
| `packages/client`   | 生成クライアントと SDK 向け型                    |
| `packages/cli`      | CLI、サービスライフサイクル、ACP                 |
| `packages/tui`      | ターミナル UI（唯一のクライアント）              |
| `packages/plugin`   | サーバー／TUI プラグイン API                     |
| `docs/`             | フォークの設計ノートと運用ガイド                 |

セットアップの詳細、上流の取り込み手順、CI、リリース、機能の追加場所は [docs/development.md](docs/development.md) を参照してください。

## フォークでの作業

`main` から、3語以内の短いハイフン区切り名でブランチを切ります。

```bash
git switch main
git switch -c code-index
```

コミットと PR のタイトルは `feat(core): add symbol index` や `docs: update roadmap` のような conventional commit 形式にします。ブランチ名には `feat/` などの種別接頭辞を付けません。

新しい振る舞いは experimental から始めます。

- 設定は `experimental.*`
- HTTP は `/api/experimental/...`、OpenAPI 識別子は `experimental.<group>.<method>`
- SDK は `client.experimental.<group>.<method>`
- プラグインフックは `experimental.*`

依存方向は `Schema` → `Core` / `Protocol` → `Server` に従います。クライアントコードは `Schema` と `Protocol` に依存できますが、`Core` と `Server` を参照してはいけません。公開 Protocol または Server の `HttpApi` を変更したら、`packages/client` で `bun run generate` を実行します。生成ファイルは手で編集しません。

このフォークは Changesets を使いません。`.changeset` ファイルを追加しないでください。

## 上流の取り込み

```bash
git fetch origin
git switch main
git merge origin/upstream
```

コンフリクトは上流の構造を保ちながら、このフォークの機能を優先して解消します。`upstream` は上流の参照用に保ち、書き換えません。

## リリース

タグを push すると、対応するすべてのターゲット向けに CLI をビルドし、GitHub Release を公開します。

```bash
git switch main
git pull
git tag v2.2.5-better.1
git push origin v2.2.5-better.1
```

タグは `v<major>.<minor>.<patch>[-prerelease]` の形式で、タグのコミットが `main` の祖先である必要があります。`-` を含むタグは prerelease として公開されます。リリースワークフローは 12 ターゲット分の CLI をビルドし、Linux は `tar.gz`、macOS と Windows は `zip` にまとめ、`SHA256SUMS.txt` と一緒に公開します。ジョブ構成は [docs/development.md](docs/development.md#リリース) を参照してください。

## ドキュメント

- [docs/README.md](docs/README.md) — フォークの方針、現在の機能棚卸し、スコープ
- [docs/development.md](docs/development.md) — セットアップ、ブランチ運用、上流の取り込み、検証、リリース
- [docs/vcs-dock.md](docs/vcs-dock.md) — 内蔵バージョン管理ビュー
- [docs/task-graph.md](docs/task-graph.md) — タスクグラフと `/divide`
- [docs/file-manager.md](docs/file-manager.md) — ファイルブラウザとプレビュー
- [AGENTS.md](AGENTS.md) — 実装とスタイルのルール
- [CONTRIBUTING.md](CONTRIBUTING.md) — コントリビューションの手順

## ライセンス

MIT。[LICENSE](LICENSE) を参照してください。
