# better-opencode ドキュメント

opencode v2（上流ブランチ `upstream`）を出発点に、開発体験を強化したフォーク **better-opencode** の設計方針、現在の機能、今後の候補をまとめる場所です。

## 開発方針

- 上流（`anomalyco/opencode`）の `dev` ブランチを継続的に取り込み、差分を小さく保つ。
- まずはブランディングと設定だけを分け、パッケージスコープ（`@opencode/*`）は当面変更しない。スコープ改名は上流マージを壊すため、機能が固まってから別途判断する。
- 新しい振る舞い・エンドポイントは既存ルールに従って **experimental** から始める。
  - 設定は `experimental.*`
  - HTTP は `/api/experimental/...`、OpenAPI 識別子は `experimental.<group>.<method>`、SDK は `client.experimental.<group>.<method>`
  - 昇格時は PR の説明とリリースノートに記載する
- 依存方向は `Schema` → `Core` / `Protocol` → `Server`。`Client` は `Schema` と `Protocol` のみに依存し、`Core` / `Server` を参照しない。
- 追加するツールは `packages/core/src/tool/plugin/*` の既存パターン（`export const Plugin = { id, effect }`）で実装し、`Effect.fn` で名前を付ける。

## ブランチ

- `main` … better-opencode の開発基準ブランチ（`upstream` から作成済み）
- `upstream` … 上流 `anomalyco/opencode` の `dev` をそのまま保持するミラー。フォークのコミットは置かない
- 作業ブランチは `main` から切り、最大3語のハイフン区切り（例: `code-index`, `session-search`）
- 上流追従は `origin/upstream` を `main` にマージして行う
- コミット / PR タイトルは `type(scope): summary`

> リポジトリ直下の `AGENTS.md` は上流向けの記述を含むため、フォーク向けの基準（`main`）を冒頭に追記している。上流へ還元できる変更は `origin/upstream` との差分が最小になるよう心がける。

## ドキュメント

- [development.md](development.md) — セットアップ、ブランチ運用、上流の取り込み、検証、CI、リリース
- [vcs-dock.md](vcs-dock.md) — バージョン管理ドックと内蔵 VCS ビュー
- [task-graph.md](task-graph.md) — Task graph と `/divide`
- [file-manager.md](file-manager.md) — ファイルマネージャーとプレビュー

## 現在の機能

| 領域           | 機能                                                                                                                                                                                                                          | 主な実装場所                                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI             | TUI が唯一のクライアント。タブ、ワークスペース、テーマ、音声、統計を備える。表示言語は日本語が既定で、英語へ切り替えられる。デスクトップ / Web UI は削除済み                                                                  | `packages/tui/`, `packages/tui/src/i18n/index.tsx`                                                                                                                |
| バージョン管理 | タブバー横の VCS ドックと内蔵ビュー。jj / Git / Mercurial の状態、diff、ブックマーク / ブランチ、jj の describe / split、Git の stage / commit / fetch / pull / push を扱う。`lazyjj` / `jjui` / `lazygit` は任意の外部ツール | `packages/tui/src/component/vcs-*.tsx`, `packages/tui/src/context/vcs.tsx`, `packages/core/src/vcs/`                                                              |
| タスク         | Task graph と `/divide`。タスク、依存関係、実行状況をライブ表示し、jj のブックマーク / チェンジを紐付けられる                                                                                                                 | `packages/tui/src/component/task-graph-*.tsx`, `packages/tui/src/context/task-graph.tsx`, `packages/core/src/plugin/goal.ts`, `packages/schema/src/task-graph.ts` |
| ファイル       | 読み取り専用のファイルマネージャーとプレビュー。`<leader>f` または `/files` で開く                                                                                                                                            | `packages/tui/src/component/file-manager-*.tsx`, `packages/tui/src/context/file-manager.tsx`, `packages/protocol/src/groups/fs.ts`                                |
| セッション     | セッション、サブエージェント、バックグラウンド実行、compaction、revert、transfer                                                                                                                                              | `packages/core/src/session/`                                                                                                                                      |
| 実行制御       | 実行キュー、再開、最大ステップ、リトライ、モデルフォールバック                                                                                                                                                                | `packages/core/src/session/runner/`, `run-coordinator.ts`                                                                                                         |
| 作業環境       | worktree、スナップショット、diff、VCS 連携                                                                                                                                                                                    | `packages/core/src/worktree.ts`, `snapshot.ts`, `vcs/`                                                                                                            |
| ツール         | read / write / edit / patch / glob / grep / shell / webfetch / websearch / subagent / skill / todo / taskwrite                                                                                                                | `packages/core/src/tool/plugin/`                                                                                                                                  |
| 自動化         | スケジュール実行、ゴール（`/goal`）、サイド質問（`/btw`）                                                                                                                                                                     | `packages/core/src/schedule.ts`, `packages/tui/src/feature-plugins/prompt/goal.tsx`, `btw.tsx`                                                                    |
| 安全性         | パーミッション、管理ポリシー、使用量上限（Console ワークスペース）                                                                                                                                                            | `packages/core/src/permission/`, `managed-policy.ts`, `usage-limits.ts`                                                                                           |
| 更新           | `opencode upgrade` は curl インストール版でフォークの GitHub Releases を参照する。パッケージマネージャー経由は上流の更新サービスを使う                                                                                        | `packages/cli/src/services/updater.ts`, `updater-release.ts`                                                                                                      |
| 拡張           | サーバープラグイン / TUI プラグイン、MCP                                                                                                                                                                                      | `packages/plugin/`, `packages/core/src/mcp/`                                                                                                                      |

### 機能トグル

TUI では次の experimental 機能を既定で有効にしている。

- `vcs-dock` … バージョン管理ドック
- `task-graph` … Task graph と `/divide`
- `file-manager` … ファイルマネージャー
- `client-mcp` … エージェントが TUI 内にターミナルを開く TUI ツール
- `new-designs` … 刷新された TUI デザインのプレビュー

**Settings → Features**（日本語表示では **設定 → 機能**）または Experiments ダイアログから個別にオン / オフできる。core の設定スキーマにある `experimental.task-graph` などは既定で無効なので、TUI 以外のクライアントやテスト fixture では明示的に有効化する。

TUI の組み込み既定値は、日本語、ダークテーマ、縦タブ、上記 experimental 機能の有効化です。テスト用 fixture は従来の既定値を明示して分離しています。

## 今後の候補

以下は今後の候補です。既存機能の拡張を含み、実装したものは「現在の機能」へ移してここから外します。

| #   | 提案                                                            | 柱           | 規模   |
| --- | --------------------------------------------------------------- | ------------ | ------ |
| 1   | コードインテリジェンス層（シンボル索引・依存グラフ・影響範囲）  | コード理解   | L      |
| 2   | 予算・安全ガードレール（トークン/コスト上限、承認ポリシー）     | 安全とコスト | M      |
| 3   | テスト連動ループ（関連テストの自動選択と失敗の差し戻し）        | 検証         | M      |
| 4   | チェックポイント / 一括 undo                                    | 検証         | S–M    |
| 5   | マルチエージェント編成（worktree 分離・並列・統合レビュー）     | 並列化       | L      |
| 6   | 小さく効く改善（履歴検索/エクスポート、注入防御、ルーティング） | 履歴・安全   | S each |

## 非目標（当面）

- 上流のリリースチャネルやテレメトリ基盤の置き換え。
- パッケージ名・バイナリ名の全面改名（機能検証が済むまで保留）。
- 独自クラウドサービスへの依存追加。ローカル完結を優先する。
