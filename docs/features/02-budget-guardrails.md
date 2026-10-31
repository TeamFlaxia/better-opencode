# 2. 予算・安全ガードレール

## 概要

セッション / プロジェクト / 日次単位で **トークン数・コスト・実行時間** の上限を設定し、超過前に警告、上限で停止する。あわせて「危険な操作の承認ポリシー」をプロファイル化する。

既存の `UsageLimits` は OpenCode Console ワークスペースの残量を読むだけで、ローカルでの予算管理や自動停止は行わない。ここを補完する。

## なぜ better-opencode か

- 長時間・並列のエージェント実行では、1 セッションの暴走がそのまま課金事故になる。
- 「Plan は安いモデル、Build は高性能モデル」のような運用を、コスト上限とセットで表現できる。
- チームで使う場合、プロジェクトごとの上限を設定ファイルで共有できる。

## 既存資産

| 役割 | 場所 |
| --- | --- |
| 使用量の記録 | `packages/core/src/session/usage.ts`, `packages/schema/src/money.ts` |
| Console の残量 | `packages/core/src/usage-limits.ts`, `packages/server/src/handlers/usage.ts` |
| モデル解決・リトライ | `packages/core/src/model-resolver.ts`, `session/runner/retry.ts` |
| パーミッション | `packages/core/src/permission/`, `packages/schema/src/permission.ts` |
| 管理ポリシー | `packages/core/src/managed-policy.ts`, `config/managed.ts` |
| TUI 表示 | `packages/tui/src/component/usage.tsx`, `feature-plugins/sidebar/limit.tsx` |
| 設定 | `packages/schema/src/config/`, `packages/core/src/config/normalize.ts` |

## 仕様

### 設定

```jsonc
{
  "experimental": {
    "budget": {
      "session": { "tokens": 2_000_000, "cost_usd": 5, "wall_clock_minutes": 120 },
      "daily": { "cost_usd": 25 },
      "on_soft_limit": "warn",   // warn | pause
      "on_hard_limit": "stop"    // stop | ask
    }
  }
}
```

- 優先順位: セッション > プロジェクト > グローバル。`config` の階層解決に乗せる。
- 金額は既存の `Money` スキーマを使い、浮動小数の直接比較を避ける。
- 上限判定は **モデル呼び出しの前**（見積もり）と **後**（実測）の両方で行う。前判定は入力トークンの概算 + 最大出力で見積もる。

### 振る舞い

| 状態 | 動作 |
| --- | --- |
| 50% / 80% | TUI に控えめな通知（設定で無効化可） |
| ソフト上限 | 警告イベントを発行。`pause` なら次のステップ前に停止し、再開コマンドを案内 |
| ハード上限 | 実行を停止し、`session.error` 相当のイベントに `budget_exceeded` を記録。`ask` なら承認ダイアログ |
| 日次上限 | 新規プロンプトの受付を拒否（既存セッションの継続も不可） |

停止は `SessionExecution` の割り込み経路を使い、ツール実行の途中で強制終了しない。ステップ境界で止める。

### CLI / TUI

- `opencode usage` … 今日・セッション別のコスト、残量、上限
- TUI: `/usage` で内訳、ステータスバーに残量バー
- 上限到達時は再開用のコマンド（例: `opencode run --resume <sessionID>`）を提示

### HTTP（experimental）

- `GET /api/experimental/usage/budget`
- `PATCH /api/experimental/usage/budget`（セッション単位の一時上書き）

永続化は既存の `usage` 集計と `KV` を使い、新しい集計基盤は作らない。

## アーキテクチャ

```
config.budget ──▶ Budget.Service ──▶ runner/step (pre-check)
                        │                 │
                        │            usage events
                        ▼                 ▼
                  TUI / HTTP        usage ledger (SQLite)
```

- `Budget` は Location スコープのサービス。`SessionExecution` からは Session ID のみを渡す既存原則を守る。
- 見積もりロジックはモデル定義（`packages/schema/src/model.ts`）の価格表を使う。価格未定義のモデルはトークンのみで判定し、コスト判定をスキップしたことを記録する。
- 既存の `UsageLimits`（Console）は残し、ローカル上限と合算して「厳しい方」を採用する。Console 未接続でもローカル上限は動く。

## 実装ステップ

1. `packages/schema` に `experimental.budget` の設定スキーマとイベントを追加。
2. `packages/core/src/budget.ts` を追加し、設定解決と台帳読み取りを実装。
3. `session/runner/step.ts` の前後で判定を呼ぶ。停止は既存の割り込み経路に乗せる。
4. 使用量イベントに上限判定結果を付与し、TUI の表示を拡張。
5. HTTP / CLI / TUI の読み取り面を実装。
6. 承認ダイアログは既存の permission UI を再利用する。

## リスクと代替案

| リスク | 対策 |
| --- | --- |
| 見積もり誤差で早すぎる停止 | ハード上限は実測後のみ、ソフト上限は見積もりで警告 |
| 価格表の陳腐化 | 価格未定義時はコスト判定を無効化し、トークンで判定 |
| 日次集計のタイムゾーン | ローカルタイムではなく UTC 日付を既定にし、設定で変更可 |
| ユーザーが上限を解除できない | セッション単位の一時上書きと `--no-budget` を用意 |

代替案: プロバイダ側の予算設定に任せる。ただし複数プロバイダをまたぐと一元管理できないため、ローカル台帳を持つ価値がある。

## 受け入れ条件

- 上限に達するとステップ境界で停止し、セッションが再開可能な状態で残る。
- 上限未設定時は従来と完全に同じ挙動（追加のイベントや遅延がない）。
- Console 未接続でもローカル上限が機能する。
- 複数セッションの同時実行で台帳の二重計上がない。

## 規模感

M。設定・判定・表示が中心で、新しい実行基盤は不要。
