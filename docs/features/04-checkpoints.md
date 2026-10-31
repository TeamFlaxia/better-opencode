# 4. チェックポイント / 一括 undo

## 概要

任意の時点に **名前付きチェックポイント** を作成し、ファイルとセッション状態をまとめて復元できるようにする。エージェントの変更が意図とずれたとき、git の履歴を汚さずに戻せる。

既存の `Snapshot` / `revert` はステップ単位の差分追跡を持つが、ユーザーが明示的に「ここへ戻す」ための名前付き地点と一覧 UI がない。

## なぜ better-opencode か

- エージェントの暴走や方針転換時に、`git reset` や手動コピーをせずに戻せる。
- 「実装前」「リファクタ後」「テスト通過時」など、レビューの区切りを明示できる。
- 既存の snapshot 基盤の再利用で実装コストが低い（P1 の理由）。

## 既存資産

| 役割 | 場所 |
| --- | --- |
| スナップショット | `packages/core/src/snapshot.ts` |
| 差分 | `packages/core/src/session/diff.ts`, `tool/plugin/file-diff.ts` |
| 巻き戻し | `packages/core/src/session/revert.ts` |
| VCS | `packages/core/src/vcs/`, `git.ts` |
| セッションイベント | `packages/core/src/session/event.ts`, `packages/schema/src/event.ts` |
| TUI 差分ビューア | `packages/tui/src/feature-plugins/system/diff-viewer.tsx` |

## 仕様

### CLI

```
opencode checkpoint create [--name <name>] [--session <id>]
opencode checkpoint list [--session <id>]
opencode checkpoint restore <name|id> [--files-only] [--session-only]
opencode checkpoint delete <name|id>
```

- `--name` 省略時はタイムスタンプ + 連番。
- 復元は既定で「ファイル + セッションの会話位置」の両方。`--files-only` は会話を維持したままファイルだけ戻す。
- 復元前に自動で「復元前チェックポイント」を作成し、取り消し可能にする。

### TUI

- `/checkpoint` … 作成 / 一覧 / 復元のダイアログ。
- 差分ビューアに「ここまで戻す」ボタン相当のキーバインド。
- セッションタブにチェックポイント数を表示（任意）。

### データモデル（案）

- `checkpoint(id, session_id, name, created_at, snapshot_ref, message_id, files_json)`
- `snapshot_ref` は既存 snapshot の識別子。ファイル内容を二重保存しない。
- セッション位置はメッセージ ID で保持し、復元時に `revert` と同じ経路で切り戻す。

### イベント

- `checkpoint.created`, `checkpoint.restored`, `checkpoint.deleted`
- 復元は durable event として記録し、再起動後も一貫させる。

## アーキテクチャ

```
checkpoint.create ──▶ Snapshot.capture ──▶ checkpoint row
checkpoint.restore ─▶ Snapshot.restore ──▶ Session.revert (optional)
```

- 既存の `Snapshot` が保持する範囲（ワークスペース全体か、セッションの変更のみか）を確認し、二重管理を避ける。
- 復元は破壊的操作なので、`Permission` の承認対象にする（既定は確認あり）。
- ファイル復元とセッション復元を分離できるようにし、片方だけのユースケース（会話は続けたい）に対応する。

## 実装ステップ

1. `packages/schema` にチェックポイントの型とイベントを追加。
2. `packages/core/src/checkpoint.ts` を追加し、SQLite テーブルとマイグレーションを実装。
3. CLI コマンドを追加（`packages/cli/src/commands/`）。
4. TUI ダイアログと差分ビューアの導線を追加。
5. 復元の権限チェックと自動バックアップを実装。
6. 失敗時のロールバック（復元途中でエラー）をテストする。

## リスクと代替案

| リスク | 対策 |
| --- | --- |
| スナップショットのストレージ肥大 | 参照カウント + 古いチェックポイントの自動整理（設定） |
| 復元中の部分失敗 | 復元前チェックポイント + アトミックな適用順序 |
| セッション復元で外部副作用が戻らない | 「ファイルのみ」「セッションのみ」を明示し、UI に注意書き |
| git 管理外ファイルの扱い | 既存 snapshot の対象範囲に従い、対象外は一覧に表示 |

代替案: git stash / worktree をユーザーに案内する。ただし会話位置まで戻す体験は git では代替できない。

## 受け入れ条件

- チェックポイント作成 → 数ステップ実行 → 復元で、ファイルと会話位置が作成時点に戻る。
- 復元直前に自動作成されたチェックポイントから、復元操作自体を取り消せる。
- ファイルのみ復元で会話が維持される。
- 再起動後も一覧と復元が機能する。
- 権限設定で復元を拒否できる。

## 規模感

S–M。既存 snapshot / revert の再利用が前提。
