# 開発ガイド

## 前提

- Bun 1.4.4（`.bun-version` で固定、`packageManager` も `bun@1.4.4`）
- Git
- 任意: インストール済みの `opencode`（`bun run dev:live` を使う場合）

初回は Bun を導入してから依存をインストールする。

```bash
curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.4"
bun install
```

`postinstall` で `packages/core` の `node-pty` 修正が走る。失敗した場合は Bun のバージョンを確認する。

## 起動

```bash
bun run dev              # ローカルビルドの CLI / TUI
bun run dev:live         # インストール済み opencode サービスに接続
bun run dev:live /path   # 対象ディレクトリを指定
bun run dev:web          # Web UI
bun run dev:desktop      # デスクトップ
```

`dev:live` は `opencode service status` でサーバーを探し、`opencode service get password` の資格情報を注入する。TUI のストレージチャネルは `dev` を使うため、インストール済みクライアントとタブ状態が揃う。

明示的に `--server` を渡した場合は、クライアントバージョン差でサービスが置き換えられない。暗黙接続では置き換わることがあるため、ライブセッションを守りたいときは `dev:live` を使う。

## リポジトリ構成

| パス | 役割 |
| --- | --- |
| `packages/schema` | 共有スキーマ・永続イベント・設定型 |
| `packages/core` | ドメインロジックと永続化 |
| `packages/protocol` | 公開 HTTP API 定義 |
| `packages/server` | HTTP サーバーとランタイム合成 |
| `packages/client` | 生成クライアント |
| `packages/cli` | CLI とサービスライフサイクル |
| `packages/tui` | ターミナル UI |
| `packages/app` | Web UI |
| `packages/desktop` | Electron デスクトップ |
| `packages/plugin` | プラグイン API |
| `docs/` | このフォークの設計・ロードマップ |

## ブランチ

| ブランチ | 用途 |
| --- | --- |
| `main` | better-opencode の開発基準。機能追加はここから分岐する |
| `upstream` | 上流 `anomalyco/opencode` の `dev` を保持するミラー。フォークのコミットを置かない |
| `origin/upstream` | 上流の `dev`。同期に使う |

作業ブランチは `main` から切り、3語以内のハイフン区切りにする（例: `code-index`, `test-loop`, `session-search`）。`feat/` や `fix/` の接頭辞は使わない。

ワークツリーを使う場合も基準は `main`:

```bash
git worktree add ../better-opencode-code-index -b code-index main
```

## 上流の取り込み

```bash
git fetch origin
git switch main
git merge origin/upstream
```

- コンフリクトは「上流の構造 + フォークの機能」を保つように解消する。
- `upstream` は上流の参照用に保ち、書き換えない。
- 大きな設計判断が変わった場合は `docs/roadmap.md` の意思決定ログに残す。

## 検証

```bash
bun run check          # lint + typecheck（リポジトリ全体）
```

反復中はパッケージ単位で実行する。

```bash
cd packages/core
bun typecheck
bun run test
```

- テストは必ずパッケージディレクトリから実行する（ルートからの `bun test` はブロックされる）。
- 公開 Protocol / Server `HttpApi` を変えたら `packages/client` で `bun run generate`。
- `bun check` と `bun run typecheck:tsc` が食い違う場合は `tsc` を正とする。
- Changesets は使わない。

## 機能を追加する場所

| 追加するもの | 場所 |
| --- | --- |
| エージェントツール | `packages/core/src/tool/plugin/` + `packages/core/src/tool/runtime.ts` への登録 |
| 設定 | `packages/schema/src/config/` + `packages/core/src/config/normalize.ts` |
| 永続化 | `packages/core/src/database/`（Drizzle、snake_case） |
| HTTP API | `packages/protocol/src/groups/` + `packages/server/src/handlers/` |
| TUI | `packages/tui/src/feature-plugins/`、`packages/tui/src/component/` |
| TUI プラグイン | `packages/plugin/src/tui/` |
| GUI プラグイン | `packages/gui-plugins/src/` |

新しい振る舞いは experimental から始める。設定は `experimental.*`、HTTP は `/api/experimental/...`、SDK は `client.experimental.*`。

## ブランディングの境界

現時点では **ドキュメントとリポジトリメタデータだけを better-opencode に合わせる**。

意図的に変更しないもの:

- `@opencode/*` のパッケージスコープ
- `opencode` バイナリ名、設定ディレクトリ、環境変数（`OPENCODE_*`）
- 上流のモデルプロバイダ名（`OpenCode` / `Anomaly / OpenCode`）
- デスクトップの productName と i18n 文言
- `.github/workflows` のリリース設定（上流のまま保持）

これらは上流とのマージコストと、モデルプロバイダ名との混同を避けるための判断。全面改名は機能が固まった後に別ブランチで行う。

## 困ったとき

- `dev:live` が別サーバーに繋がる: `--server "$(opencode service status)"` を明示する。
- 型チェックが遅い/差分が出る: `packages/<name>` で `bun typecheck`、必要なら `bun run typecheck:tsc`。
- テストがタイムアウトする: `.opencode/skills/unit-tests` と `tui-tests` の待機方法を確認する。
- 生成物の差分: `packages/client` で `bun run generate` を実行し、手編集を戻す。
