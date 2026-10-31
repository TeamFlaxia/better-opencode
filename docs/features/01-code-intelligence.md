# 1. コードインテリジェンス層

## 概要

リポジトリの **シンボル（定義）・参照・import/呼び出し関係・ファイル所有関係** をローカルに索引し、エージェントとユーザーが「読むべき場所」を構造的に特定できるようにする。

既存の `grep` / `glob` はテキスト検索として残す。本機能はその上に「意味のある単位」を与えるレイヤーであり、置き換えではない。

## なぜ better-opencode か

- 大規模リポジトリでは、LLM が闇雲に `grep` を繰り返すだけで入力トークンを消費する。シンボル単位の定義・参照・呼び出し元が引けると、探索の初手が変わる。
- 変更時に「影響を受けるファイル・テスト」を機械的に列挙できる。テスト連動ループ（[03](03-test-loop.md)）の土台にもなる。
- 完全ローカル（SQLite + tree-sitter）で完結し、外部サービスや埋め込み API を必須にしない。埋め込みは後から任意で追加できる。

## 既存資産

| 役割 | 場所 |
| --- | --- |
| ツール登録パターン | `packages/core/src/tool/plugin/read.ts` ほか |
| テキスト検索 | `packages/core/src/ripgrep.ts`, `packages/core/src/tool/plugin/grep.ts` |
| ファイル監視 | `packages/core/src/filesystem/watcher.ts`, `file-watch.ts` |
| SQLite / Drizzle | `packages/core/src/database/`, `packages/core/src/database/migration/` |
| 永続イベント | `packages/core/src/event/`, `packages/schema/src/event.ts` |
| tree-sitter | `packages/cli/package.json` の `web-tree-sitter` |
| 設定スキーマ | `packages/schema/src/config/`, `packages/core/src/config/normalize.ts` |
| TUI ステータス表示 | `packages/tui/src/feature-plugins/sidebar/` |

## 仕様

### CLI

```
opencode index status            # 索引済みファイル数、最終更新、言語別内訳
opencode index build [--force]   # 同期構築（開発・CI 用）
opencode index clear             # 索引削除
```

通常はセッション開始後にバックグラウンドで増分構築する。`opencode index build` はデバッグと CI 用。

### ツール（experimental）

`code_index` ツールを追加する。入力は判別可能なユニオン:

- `outline` … ファイル / ディレクトリのシンボル一覧
- `definition` … シンボル名から定義位置
- `references` … 参照位置
- `callers` … 呼び出し元（関数・メソッド）
- `impact` … 変更ファイルから影響範囲（逆依存）
- `search` … 名前・部分一致・種類でのシンボル検索

出力は `path`, `range`, `kind`, `name`, `signature`（取得できる場合）に統一し、読みやすさのため Markdown ではなく構造化データを返す。ツール説明には「まず `code_index` で当たりを付け、必要なら `read` で本文を読む」と明記する。

### HTTP（experimental）

- `GET /api/experimental/index/status`
- `POST /api/experimental/index/rebuild`
- `GET /api/experimental/index/symbols?query=...`
- `GET /api/experimental/index/impact?path=...`

OpenAPI 識別子は `experimental.index.*`、SDK は `client.experimental.index.*`。ルート追加後は `packages/client` で `bun run generate` を実行する。

### 設定

```jsonc
{
  "experimental": {
    "code_index": {
      "enabled": true,
      "languages": ["typescript", "javascript", "python", "go", "rust"],
      "max_files": 20000,
      "exclude": ["**/node_modules/**", "**/dist/**"]
    }
  }
}
```

## アーキテクチャ

```
filesystem watcher ──▶ Indexer ──▶ SQLite (index_*)
                                   │
                     code_index ◀──┘
                          │
              TUI / HTTP / subagents
```

### データモデル（案）

Drizzle の snake_case 規約に従う。

- `index_file(id, path, language, size, mtime, hash, indexed_at)`
- `index_symbol(id, file_id, name, kind, start_line, start_col, end_line, end_col, signature)`
- `index_edge(id, from_symbol_id, to_symbol_id, kind, file_id, line)` … `kind`: `import` / `call` / `reference` / `inherit`
- `index_meta(key, value)` … スキーマ版、最終フルビルド時刻

`index_symbol(name)`、`index_edge(from_symbol_id)`、`index_file(path)` に索引を張る。FTS5 は任意（SQLite ビルド差を吸収できる場合のみ）。

### 構築戦略

1. 起動時: `index_meta` とファイル mtime/hash を比較し、差分だけ再解析。
2. 実行中: 既存 `Watcher` の更新をデバウンスして 1 ファイル単位で再解析。
3. 解析は CPU バウンドなので、`Job` / ワーカーで実行しセッション実行をブロックしない。
4. 上限（`max_files`）を超える場合は索引を無効化し、ツールは明示的なエラーではなく「索引が無効。grep を使って」と返す。

### tree-sitter の扱い

- `web-tree-sitter` を利用し、言語ごとの WASM を遅延ロードする。
- 初期対応は TypeScript / JavaScript / Python / Go / Rust。未対応言語はファイル一覧と import 行の正規表現抽出にフォールバックする。
- パーサのロード失敗は致命的にせず、その言語だけスキップして状態に記録する。

## 実装ステップ

1. `packages/schema` に索引の入出力スキーマを追加。
2. `packages/core/src/index/` に `Indexer` サービスと SQLite テーブル・マイグレーションを追加。
3. `Watcher` と接続した増分更新、起動時バックフィルを実装。
4. `tool/plugin/code-index.ts` を追加し、`packages/core/src/tool/runtime.ts` に登録。
5. `packages/protocol` に experimental グループを追加し、`packages/server` のハンドラを実装。`bun run generate` で SDK を更新。
6. TUI に `/index`（ステータス + 再構築）を追加。サイドバーに小さな進捗表示。
7. ベンチマーク用フィクスチャ（小・中・大）で構築時間とクエリ時間を計測。

## リスクと代替案

| リスク | 対策 |
| --- | --- |
| 言語ごとのパーサ保守コスト | 初期言語を絞り、未対応はフォールバック |
| 大規模 monorepo で構築が重い | 上限・除外設定、差分更新、バックグラウンド化 |
| 索引の不整合（編集中のファイル） | mtime + hash で検証、Watcher 更新で無効化 |
| ツール乱用でコンテキストを圧迫 | 出力件数上限とページング、`read` 併用の指示 |

代替案として LSP 連携があるが、現状このリポジトリに LSP クライアント実装はなく、言語サーバーの起動管理が別途必要になる。まずは tree-sitter で自己完結させる。

## 受け入れ条件

- 1 万ファイル規模のフィクスチャで初回構築がバックグラウンドで完了し、セッションがブロックされない。
- ファイル変更後、次回クエリで定義・参照が更新されている。
- `code_index` の各クエリが件数上限を守り、索引無効時に明確なメッセージを返す。
- サーバー API と SDK が生成物を含めて型チェックを通る。
- 索引削除後も通常の grep / read が影響を受けない。

## 規模感

L。コア（索引 + ツール）が大半。HTTP / TUI は薄い。
