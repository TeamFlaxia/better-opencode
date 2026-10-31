# 5. マルチエージェント編成

## 概要

1 つのゴールを複数のサブタスクに分解し、**worktree を分けたサブエージェントを並列実行**する。最後に差分をレビューし、統合（または個別採用）できるようにする。

既存の `subagent` ツールはバックグラウンド実行・フォローアップ・完了通知まで持つが、複数エージェントの作業ディレクトリ分離と、結果の統合レビューはユーザー / 親エージェントの裁量に任されている。

## なぜ better-opencode か

- 独立した変更（例: フロントとバック、複数パッケージの移行）を並列化できる。
- worktree 分離により、並列エージェント同士のファイル競合を防げる。
- 統合レビューを 1 画面に集約し、「どの変更を採用するか」を人間が判断できる。

## 既存資産

| 役割 | 場所 |
| --- | --- |
| サブエージェント | `packages/core/src/tool/plugin/subagent.ts`, `session/subagent-job.ts`, `subagent-completion.ts` |
| worktree | `packages/core/src/worktree.ts`, `worktree/strategies.ts` |
| セッション配置 | `packages/core/src/location.ts`, `session/` |
| 差分 / レビュー | `packages/core/src/session/diff.ts`, `packages/gui-plugins/src/review/` |
| 実行コーディネータ | `packages/core/src/session/run-coordinator.ts` |
| ゴール | `packages/gui-plugins/src/goal/`, `packages/schema/src/goal.ts` |

## 仕様

### ツール（experimental）

`orchestrate` ツールを追加する。

```jsonc
{
  "goal": "認証をセッショントークン方式へ移行する",
  "tasks": [
    { "id": "server", "agent": "build", "prompt": "サーバー側の検証を..." },
    { "id": "client", "agent": "build", "prompt": "クライアントの..." },
    { "id": "tests", "agent": "general", "prompt": "移行後のテストを..." }
  ],
  "isolation": "worktree",   // none | worktree
  "merge": "manual"           // manual | auto-if-clean
}
```

- 各タスクは独立したサブエージェントセッションとして起動する。
- `isolation: "worktree"` のとき、タスクごとに `Worktree` を作成し、そのディレクトリを Location として子セッションを開始する。
- 依存関係（`dependsOn`）を指定できる。依存があるタスクは前段の完了後に開始する。

### 実行フロー

1. 親セッションが計画を作成（ユーザー承認を挟める）。
2. タスクごとに worktree と子セッションを作成。
3. 並列実行。進捗は親の TUI / GUI に集約表示。
4. 完了後、各 worktree の差分を収集。
5. レビュー画面で「採用 / 破棄 / 修正依頼」を選ぶ。
6. 採用した差分を統合ブランチへ適用。競合時は自動マージせずユーザーに返す。

### 統合ポリシー

- `manual`: 各差分をユーザーが確認して採用。
- `auto-if-clean`: ベースと競合せず、テスト（[03](03-test-loop.md)）が通る場合のみ自動適用。失敗時は manual にフォールバック。
- 適用は `git apply` 相当ではなく、既存の `Git` / worktree 戦略を使い、失敗時に元へ戻せるようにする。

### UI

- TUI: `/orchestrate` で計画の確認、進捗一覧、結果の選択。
- デスクトップ / Web: `review` プラグインに「Orchestration」タブを追加し、タスクごとの差分を並べる。
- 子セッションへは既存のセッションタブから移動できる。

## アーキテクチャ

```
orchestrate(goal, tasks)
        │
        ├─ Worktree.create × N
        ├─ Session.start(location=worktree) × N   ← 既存の subagent 経路
        ├─ Job / SubagentCompletion で完了待ち
        └─ Diff.collect → Review UI → Apply
```

- 親子関係は既存の `SubagentJob` / `SubagentCompletion` の仕組みに乗せる。新しい実行エンジンは作らない。
- `SessionExecution` はプロセス全体で Session ID ベースのまま。worktree ごとに別プロセスを立てない。
- 子セッションの Location が worktree を指すことで、ファイルアクセス・権限・スナップショットが自然に分離される。

## 実装ステップ

1. `subagent` に `isolation` オプションを追加（まずは単体で worktree 分離できるようにする）。
2. `packages/core/src/orchestration/` に計画・依存解決・並列起動・完了集約を実装。
3. 差分収集と適用ポリシーを実装。失敗時のロールバックをテスト。
4. `orchestrate` ツールと experimental HTTP を追加。
5. TUI の進捗ビューとレビュー導線を追加。
6. GUI の `review` プラグインに統合タブを追加。

## リスクと代替案

| リスク | 対策 |
| --- | --- |
| 並列数が多くリソースを食う | 同時実行数の上限（既定 3）、キューイング |
| worktree の後始末漏れ | セッション終了・失敗時に自動削除、一覧で可視化 |
| 統合時の競合 | 自動マージしない。競合はユーザーに返す |
| 子エージェントの暴走 | 予算ガードレール（[02](02-budget-guardrails.md)）と最大ステップを継承 |
| 親のコンテキスト肥大 | 子の結果は要約 + 差分参照のみを返す |

代替案: ユーザーが手動で worktree と `/btw` を並べる。体験として重いため、計画・進捗・統合だけを自動化する価値がある。

## 受け入れ条件

- 2 つの独立タスクが別 worktree で並列実行され、互いのファイルを変更しない。
- 完了後に両方の差分が一覧でき、片方だけ採用できる。
- 適用に失敗した場合、ベースブランチが元の状態に戻る。
- 同時実行数の上限を超えるタスクがキューで待機する。
- 子セッションのコストが親の集計に含まれる。

## 規模感

L。worktree 分離と統合レビューが主な新規部分。
