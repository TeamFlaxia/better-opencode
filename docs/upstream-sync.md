# 上流ミラーの同期

`script/sync-upstream.ts` は上流 `anomalyco/opencode` の `dev` をローカルの `upstream`
ブランチへ fast-forward で取り込み、その内容を `main` にマージするヘルパーです。作業は
リポジトリ直下のクリーンな `main` で始めます。

```bash
bun run sync:upstream                      # upstream/dev を取り込む
bun run sync:upstream --tag v2.4.2         # タグを指定
bun run sync:upstream --ref <git-ref>      # 任意の ref を指定（--tag が優先）
bun run sync:upstream --dry-run            # 実行する git コマンドだけを表示
```

## 処理の流れ

1. 作業ツリーがクリーンであることと、現在地が `main` であることを確認します。
2. `upstream` リモートが無ければ追加し、URL が
   `https://github.com/anomalyco/opencode.git` と異なる場合は失敗します。
3. `git fetch upstream --tags dev` を実行します。
4. ローカルの `upstream` が `upstream/dev` の祖先であることを確認してから
   fast-forward します。フォークのコミットが入っているなど分岐している場合は
   停止し、強制更新は行いません。
5. `upstream-sync` ブランチを作成して対象を `--no-ff` でマージし、成功すれば
   `main` に戻って同じく `--no-ff` でマージします。

`--push-mirror` を付けると、ミラーの更新後かつ `origin/upstream` がその先端の
祖先であることを確認できた場合だけ `upstream:upstream` を origin に push します。
確認できない場合は push しません。

```bash
bun run sync:upstream --push-mirror
```

## コンフリクト

マージが衝突した場合、スクリプトは衝突ファイルを表示してマージ途中の状態で終了します。
上流のディレクトリ構成や API を優先し、フォーク固有の機能は必要な範囲だけ上流の形に
合わせて再適用します。解決してステージしたら `--continue` で再開します。
このモードは `upstream-sync` ブランチ上でマージ途中にあることを要求します。

```bash
git status
git add <resolved-files>
bun run sync:upstream --continue
```

## マージ後

最後に次のチェックリストが表示されます。Protocol に変更があった場合は
`packages/client` でクライアントを再生成してから検証し、
`v<base>-theia.N`（例: `v2.4.2-theia.1`）のタグを付けます。

```bash
bun install
cd packages/client && bun run generate   # Protocol を変更した場合
cd ../.. && bun run check
```

`--dry-run` は引数と参照だけを確認して実行予定の git コマンドを表示します。
fetch・ブランチ作成・マージ・push は一切行いません。

## 自動同期PR

`.github/workflows/upstream-sync-pr.yml` が毎日 03:17 UTC に上流を確認し、手動実行
（`workflow_dispatch`）では任意の安定タグを指定できます。

1. 上流を fetch し、ルート `package.json` のバージョン（最後に同期した上流ベース）より
   新しい安定タグ（`vX.Y.Z`）を選ぶ。上流の maintenance ブランチにあるタグは `main` の
   祖先とは限らないため、祖先判定ではなくバージョンで比較する。
2. `main` から `upstream-sync-<version>` ブランチを作り、`--no-ff` でマージする。
3. 生成クライアント / OpenAPI を再生成し、`bun run check`、`bun run typecheck:tsc`、生成物の差分確認を実行する。
4. ブランチを push し、`main` 宛の PR を作成または更新する。

- コンフリクトした場合は**自動解消せず**、 dedicated issue を更新して失敗します。ローカルの
  `bun run sync:upstream --tag <tag>` で解消してください。
- この workflow は `main` への push、タグの作成、GitHub Release の公開を行いません。
  PR をマージした後に、`v<base>-theia.1` を push してリリースします。
- ミラー（`origin/upstream`）は更新しません。必要なら手動で `--push-mirror` を使ってください。
