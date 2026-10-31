# 3. テスト連動ループ

## 概要

エージェントがファイルを変更したとき、**変更内容から関連テストを特定して実行し、失敗を次のステップに差し戻す**。ユーザーが毎回テストコマンドを指示しなくても、検証まで含めてタスクが完了する。

## なぜ better-opencode か

- 現状は「実装 → ユーザーがテスト実行 → 失敗を貼り付け」のループを人が回している。ここを自動化すると手戻りが減る。
- 既存の `shell` ツールとサブエージェントで実現は可能だが、毎回モデルがテスト発見・実行・ログ解釈を行うためトークンを消費する。決定論的な部分をランタイムに移す。
- コードインテリジェンス層（[01](01-code-intelligence.md)）があると、テスト選択の精度が上がる。なくてもパス規約とテストランナー検出で動く。

## 既存資産

| 役割 | 場所 |
| --- | --- |
| シェル実行 | `packages/core/src/shell/`, `tool/plugin/shell.ts` |
| 変更検出 | `packages/core/src/session/diff.ts`, `snapshot.ts` |
| ツール出力の切り詰め | `packages/core/src/tool-output.ts` |
| ジョブ | `packages/core/src/job.ts`, `job/` |
| 設定 | `packages/schema/src/config/` |
| テスト規約のスキル | `.opencode/skills/unit-tests`, `tui-tests`, `app-e2e-tests`, `component-tests` |

## 仕様

### 設定

```jsonc
{
  "experimental": {
    "test_loop": {
      "enabled": true,
      "mode": "related",          // off | related | affected | all
      "command": null,             // 未指定なら自動検出
      "timeout_seconds": 300,
      "max_failures_to_report": 3,
      "run_on": ["edit", "write", "patch"]
    }
  }
}
```

### テストランナー検出

リポジトリルートから次の順で検出する。

1. 設定の `command`
2. `package.json` の `scripts.test`（bun / pnpm / npm / yarn をロックファイルで判定）
3. `Makefile` の `test`
4. `pytest.ini` / `pyproject.toml`、`go.mod`、`Cargo.toml`
5. 見つからなければ無効（エラーにはしない）

### 関連テストの選択（mode = `related`）

- 変更ファイル `foo.ts` に対し、次の候補をスコア順に選ぶ。
  - 同名テスト: `foo.test.ts`, `foo.spec.ts`, `test_foo.py`, `foo_test.go`
  - 同ディレクトリの `__tests__/`
  - コードインテリジェンスの逆依存（`impact`）に含まれるテストファイル
- 候補が多すぎる場合は上限（既定 10 ファイル）で切る。
- `affected` は逆依存全体、`all` はリポジトリ全体。

### 実行と差し戻し

1. ステップ完了時に変更ファイルを集計。
2. 対象テストを決定し、`Job` で実行。ユーザー入力をブロックしないよう、結果は次のステップの冒頭に差し込む。
3. 失敗時は **要約** を作る。
   - 失敗したテスト名
   - 最初のエラーメッセージ（スタックトレースは先頭 N 行）
   - 関連ファイルと行
4. 要約を `session` の合成メッセージとして追加し、エージェントに修正を促す。無限ループ防止のため、同一テストの再失敗回数に上限を設ける（既定 3 回）。
5. 成功時は静かに記録し、TUI のステータスに「テスト通過」を表示する。

### TUI

- サイドバーに「Test」セクション（実行中 / 成功 / 失敗）。
- `/test` で手動実行。引数でファイルやパターンを指定可能。
- 失敗時は `diff` ビューアから該当テストへジャンプできると望ましい（Phase 2 以降）。

## アーキテクチャ

```
step end ──▶ changed files ──▶ TestPlanner ──▶ Job(run)
                                    │             │
                              index impact        ▼
                                            TestResult
                                    │
                     ┌──────────────┴──────────────┐
                 pass: status                     fail: synthetic message
```

- `TestLoop` は Location スコープ。セッション ID は渡さず、呼び出し元が結果をセッションに紐付ける。
- テスト実行は既存の `Shell` サービスを使い、新しいプロセス管理を増やさない。
- 出力は `tool-output.ts` の切り詰めポリシーを再利用し、巨大なログでコンテキストを圧迫しない。

## 実装ステップ

1. `packages/schema` に `experimental.test_loop` を追加。
2. `packages/core/src/test-loop/` に検出・選択・実行・要約を実装。
3. ステップ完了イベントにフックし、結果を次ステップの合成メッセージとして投入。
4. `/test` コマンドと TUI ステータスを追加。
5. リポジトリ自身（`packages/core`, `packages/tui`）で dogfooding し、テスト規約スキルとの整合を確認。

## リスクと代替案

| リスク | 対策 |
| --- | --- |
| テストが遅くセッションが待たされる | バックグラウンド実行、結果は次ステップで合流 |
| 誤ったテスト選択で無関係な失敗を混ぜる | `related` を既定にし、失敗要約に関連度を明記 |
| テストが環境依存で常に落ちる | 同一失敗の再試行上限、`--no-test-loop` で無効化 |
| 出力が巨大 | 要約 + 先頭 N 行、全文はログファイル参照 |

代替案: フック（plugin）でユーザーが自由に実装する。ただし「関連テスト選択」と「失敗の差し戻し」は共通価値が大きいため、組み込み + 設定で無効化の形がよい。

## 受け入れ条件

- `bun test` を持つリポジトリで、`foo.ts` 変更時に `foo.test.ts` が自動選択される。
- 失敗時に、原因ファイルと失敗テスト名を含む要約が次ステップに渡る。
- 成功時は追加のモデル呼び出しが発生しない。
- テスト未検出のリポジトリで無効時に、余計なイベントや遅延がない。
- 無限ループしない（同一テストの再実行回数が上限で止まる）。

## 規模感

M。検出と選択は決定的なロジックが中心。UI は薄い。
