# better-opencode ドキュメント

opencode v2（上流ブランチ `upstream`）を出発点に、開発体験を強化したフォーク **better-opencode** の設計・ロードマップをまとめる場所です。

## 開発方針

- 上流（`anomalyco/opencode`）の `dev` ブランチを継続的に取り込み、差分を小さく保つ。
- まずはブランディングと設定だけを分け、パッケージスコープ（`@opencode/*`）は当面変更しない。スコープ改名は上流マージを壊すため、機能が固まってから別途判断する。
- 新しい振る舞い・エンドポイントは既存ルールに従って **experimental** から始める。
  - 設定は `experimental.*`
  - HTTP は `/api/experimental/...`、OpenAPI 識別子は `experimental.<group>.<method>`、SDK は `client.experimental.<group>.<method>`
  - 昇格時に `CHANGELOG.md` へ記載する
- 依存方向は `Schema` → `Core` / `Protocol` → `Server`。`Client` は `Schema` と `Protocol` のみに依存し、`Core` / `Server` を参照しない。
- 追加するツールは `packages/core/src/tool/plugin/*` の既存パターン（`export const Plugin = { id, effect }`）で実装し、`Effect.fn` で名前を付ける。

## ブランチ

- `main` … better-opencode の開発基準ブランチ（`upstream` から作成済み）
- `upstream` … 上流 `anomalyco/opencode` の `dev` をそのまま保持するミラー。フォークのコミットは置かない
- 作業ブランチは `main` から切り、最大3語のハイフン区切り（例: `code-index`, `session-search`）
- 上流追従は `origin/upstream` を `main` にマージして行う
- コミット / PR タイトルは `type(scope): summary`

> リポジトリ直下の `AGENTS.md` は上流向けの記述を含むため、フォーク向けの基準（`main`）を冒頭に追記している。上流へ還元できる変更は `origin/upstream` との差分が最小になるよう心がける。

開発手順の詳細は [development.md](development.md) を参照。

## 現在の機能棚卸し（重複提案を避けるため）

すでに存在する主な機能:

| 領域 | 既存機能 | 主な実装場所 |
| --- | --- | --- |
| セッション | セッション、サブエージェント、バックグラウンド実行、compaction、revert、transfer | `packages/core/src/session/` |
| 実行制御 | 実行キュー、再開、最大ステップ、リトライ、モデルフォールバック | `packages/core/src/session/runner/`, `run-coordinator.ts` |
| 作業環境 | worktree、スナップショット、diff、VCS 連携 | `packages/core/src/worktree.ts`, `snapshot.ts`, `vcs/` |
| ツール | read / write / edit / patch / glob / grep / shell / webfetch / websearch / subagent / skill / todo | `packages/core/src/tool/plugin/` |
| 自動化 | スケジュール実行、ゴール（`/goal`）、サイド質問（`/btw`） | `packages/core/src/schedule.ts`, `packages/gui-plugins/src/goal`, `btw` |
| 安全性 | パーミッション、管理ポリシー、使用量上限（Console ワークスペース） | `packages/core/src/permission/`, `managed-policy.ts`, `usage-limits.ts` |
| UI | TUI（タブ、ワークスペース、テーマ、音声、統計）、デスクトップ、Web | `packages/tui/`, `packages/desktop/`, `packages/app/` |
| 拡張 | サーバープラグイン / TUI プラグイン / GUI プラグイン、MCP | `packages/plugin/`, `packages/gui-plugins/`, `packages/core/src/mcp/` |

このため本ドキュメントの提案は「既存機能の焼き直し」ではなく、**コード理解・コスト制御・検証・並列化・履歴の資産化**という5本の柱に絞っている。

## 提案一覧

| # | 提案 | 柱 | 規模 | ドキュメント |
| --- | --- | --- | --- | --- |
| 1 | コードインテリジェンス層（シンボル索引・依存グラフ・影響範囲） | コード理解 | L | [features/01-code-intelligence.md](features/01-code-intelligence.md) |
| 2 | 予算・安全ガードレール（トークン/コスト上限、承認ポリシー） | 安全とコスト | M | [features/02-budget-guardrails.md](features/02-budget-guardrails.md) |
| 3 | テスト連動ループ（関連テストの自動選択と失敗の差し戻し） | 検証 | M | [features/03-test-loop.md](features/03-test-loop.md) |
| 4 | チェックポイント / 一括 undo | 検証 | S–M | [features/04-checkpoints.md](features/04-checkpoints.md) |
| 5 | マルチエージェント編成（worktree 分離・並列・統合レビュー） | 並列化 | L | [features/05-multi-agent.md](features/05-multi-agent.md) |
| 6 | 小さく効く改善（履歴検索/エクスポート、注入防御、ルーティング） | 履歴・安全 | S each | [features/06-quick-wins.md](features/06-quick-wins.md) |

優先順位とフェーズ計画は [roadmap.md](roadmap.md) を参照。

## 非目標（当面）

- 上流のリリースチャネルやテレメトリ基盤の置き換え。
- パッケージ名・バイナリ名の全面改名（機能検証が済むまで保留）。
- 独自クラウドサービスへの依存追加。ローカル完結を優先する。
