# 開発ガイド

## 前提

- Bun 1.4.4（`.bun-version` で固定、`packageManager` も `bun@1.4.4`）
- Git
- ripgrep（`rg`）。`packages/core` の検索テストが使う。無いと多数のテストが失敗する
- 任意: `lsof`（サービス系テストのポート所有者表示）
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
| `packages/tui` | ターミナル UI（唯一のクライアント） |
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
bun run test:fast      # テストファイルを並列実行（直列より約 2.8 倍速い）
bun run script/test.ts test/session-runner.test.ts   # 1ファイルだけ
```

`test:fast` は Bun の `--parallel=4 --no-isolate` でテストファイルを並列実行する。CI は従来どおり直列の `test` を使うため、並列化はローカル専用の高速パスとして扱う。複数パッケージをまとめて回す場合は、リポジトリルートで `bun run test:affected` を使う（`bun turbo test --affected --concurrency=2 -- --parallel=4 --no-isolate`）。

変更したファイルに関係するテストだけを回す場合は、パッケージディレクトリで `bun test --changed` を使う。1ファイルを監視する場合は `bun test example.test.ts --watch`、テスト名で絞る場合は `-t <pattern>` を使う。

- テストは必ずパッケージディレクトリから実行する（ルートからの `bun test` はブロックされる）。
- `packages/core` は HOME / XDG / TMPDIR を隔離するため、直接 `bun test` せず `bun run script/test.ts` を使う（`--changed` も `bun run script/test.ts --changed`）。
- 公開 Protocol / Server `HttpApi` を変えたら `packages/client` で `bun run generate`。
- `bun check` と `bun run typecheck:tsc` が食い違う場合は `tsc` を正とする。
- Changesets は使わない。

## CI

`.github/workflows/pr-check.yml` は `main` 向け PR と手動実行（`workflow_dispatch`）で動く。`main` への通常の push では動かない。GitHub ホストの `ubuntu-latest` を使い、次の3ジョブを並列で実行する。

| ジョブ | 内容 |
| --- | --- |
| `check` | `bun run lint`、`bun turbo typecheck:tsc --affected`、変更ファイルの lint、生成クライアント / OpenAPI の差分確認 |
| `test` | 変更の影響を受けるパッケージのユニットテスト（`bun turbo test --affected --concurrency=2 -- --parallel=2 --no-isolate`） |
| `build` | CLI / app が依存するワークスペースライブラリのビルド（`--affected`） |

- ドラフト PR ではジョブをスキップする。`ready_for_review` で再実行される。
- 同じ PR への追加コミットは古い実行をキャンセルする。
- `workflow_dispatch` では影響範囲を絞らず、全パッケージの型チェック・全テスト・全ビルドを実行する。
- PR の `check` / `test` / `build` は変更されたパッケージとその依存先だけを対象にする。未変更パッケージは `main` で検証済みという前提。
- 上流由来のリリース・デプロイ・トリアージ workflow は削除済み。現在の CI は `pr-check.yml`、`release-tag.yml`、`check-process-daemon.yml` のみ。

ブランチ保護で `check` / `test` / `build` を必須チェックにすると、PR のマージ前に検証を強制できる。

## リリース

`v` で始まるタグを push すると `.github/workflows/release-tag.yml` が動作する。

```bash
git switch main
git pull
git tag v2.2.5-better.1
git push origin v2.2.5-better.1
```

- タグは `v<major>.<minor>.<patch>[-prerelease]` の形式のみ受け付ける。
- `-` を含むタグは GitHub Release 上で prerelease として扱う。
- タグのコミットが `main` の祖先であることを確認する（`main` 以外からのリリースを防ぐ）。
- `verify` … lint、`typecheck:tsc`、生成物の差分確認、全ユニットテスト
- `build` … 12ターゲット分の CLI バイナリをビルドし、Linux は `tar.gz`、macOS / Windows は `zip` にまとめる
- `publish` … `SHA256SUMS.txt` と一緒に GitHub Release を作成する。既存 Release にはアセットを上書きアップロードする
- 手動で再実行する場合は `workflow_dispatch` に既存タグを指定する

現時点のリリース対象は CLI のみ。npm publish は含まない。

## 機能を追加する場所

| 追加するもの | 場所 |
| --- | --- |
| エージェントツール | `packages/core/src/tool/plugin/` + `packages/core/src/tool/runtime.ts` への登録 |
| 設定 | `packages/schema/src/config/` + `packages/core/src/config/normalize.ts` |
| 永続化 | `packages/core/src/database/`（Drizzle、snake_case） |
| HTTP API | `packages/protocol/src/groups/` + `packages/server/src/handlers/` |
| TUI | `packages/tui/src/feature-plugins/`、`packages/tui/src/component/` |
| TUI プラグイン | `packages/plugin/src/tui/` |

新しい振る舞いは experimental から始める。設定は `experimental.*`、HTTP は `/api/experimental/...`、SDK は `client.experimental.*`。

## 日本語化

TUI の日本語訳は `packages/tui/src/i18n/index.tsx` の `ja` 辞書にある。

- キーは英語の原文そのもの。`t("Settings")` のように呼び出す。
- 未訳の文字列は英語のまま表示されるため、翻訳を少しずつ追加できる。
- `{{name}}` などのプレースホルダーは `t("...", { name })` で渡す。
- 既定の表示言語は日本語。`~/.config/opencode/cli.json` の `language` を `"en"` にすると英語へ切り替わる。
- 設定画面では **Settings → Language** からも切り替えられる。
- `DialogHeader` / `DialogSelect` はタイトル・説明・カテゴリを自動で翻訳するので、個別のダイアログに毎回 `t` を足す必要はない。

変更後の確認:

```bash
cd packages/tui
bun typecheck
bun test --timeout 30000 test/cli/tui/dialog-select.test.tsx test/config.test.tsx
```

## ブランディングの境界

現時点では **ドキュメントとリポジトリメタデータだけを better-opencode に合わせる**。

意図的に変更しないもの:

- `@opencode/*` のパッケージスコープ
- `opencode` バイナリ名、設定ディレクトリ、環境変数（`OPENCODE_*`）
- 上流のモデルプロバイダ名（`OpenCode` / `Anomaly / OpenCode`）
- `.github/workflows` の上流由来リリース設定（フォークのリリースは `release-tag.yml`）

これらは上流とのマージコストと、モデルプロバイダ名との混同を避けるための判断。全面改名は機能が固まった後に別ブランチで行う。

デスクトップアプリと Web UI は削除済み。UI の変更は TUI のみを対象にする。

## 困ったとき

- `dev:live` が別サーバーに繋がる: `--server "$(opencode service status)"` を明示する。
- 型チェックが遅い/差分が出る: `packages/<name>` で `bun typecheck`、必要なら `bun run typecheck:tsc`。
- テストがタイムアウトする: `.opencode/skills/unit-tests` と `tui-tests` の待機方法を確認する。
- 生成物の差分: `packages/client` で `bun run generate` を実行し、手編集を戻す。
