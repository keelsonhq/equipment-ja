# 依存バージョン

採用した版と確認日を記録する(記憶で書かず、npm registry で確認して固定する)。

**確認日: 2026-10-03**(`yaml` は 2026-10-04、`@keelsonhq/identity` は 2026-10-07)。`npm view <package> dist-tags` で各パッケージの最新安定版を確認した。

## ランタイム・ツール

- Node.js 24(`package.json` の `engines`。確認時 24.15.0)
- Keelson CLI v0.6.11 以降(任意。`pnpm dev` の `keelson dev serve` で利用者を切り替えるため。`pnpm e2e` には必須)。
  無ければ `pnpm dev` は SDK のローカルモードで起動する
- pnpm 10.33.4(`packageManager`。Corepack 経由)。デプロイ時のビルドは npm(`package-lock.json`)で行われるため、
  lockfile は pnpm と npm の両方を同梱する

## 実行時依存(dependencies)

| パッケージ            | 版     | 用途                                                                                                                                                         |
| --------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@libsql/client`      | 0.18.0 | libSQL クライアント                                                                                                                                          |
| `@keelsonhq/identity` | 0.2.1  | 信頼ヘッダの読み取り(`getRequestUser`)と Directory API(社員一覧・プロフィール画像の URL)。ローカルモードの名簿ファイル(`KEELSON_LOCAL_USERS_FILE`)が入った版 |
| `@keelsonhq/files`    | 0.1.0  | ファイルストア(添付)                                                                                                                                         |

## 開発依存(devDependencies)

| パッケージ                          | 版      | 用途                | 備考                                                                                                               |
| ----------------------------------- | ------- | ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `@sveltejs/kit`                     | 3.0.0   | フレームワーク      | 2026-10-01 公開の latest                                                                                           |
| `@sveltejs/adapter-node`            | 6.0.0   | Node サーバー出力   |                                                                                                                    |
| `@sveltejs/vite-plugin-svelte`      | 7.3.1   | Svelte のビルド統合 |                                                                                                                    |
| `svelte`                            | 5.57.1  | UI                  | Kit 3 の peer が `^5.57.1`                                                                                         |
| `vite-plus`                         | 1.0.0   | ツールチェーン      | Vite 8.1 / Vitest 5.0.1 / Oxlint / Oxfmt を同梱。2026-10-03 採用                                                   |
| `vite`                              | 別名    | Vite+ の配線        | `npm:@voidzero-dev/vite-plus-core@1.0.0`。`overrides` で全依存の `vite` をこれに揃える。`vite-plus` と同じ版にする |
| `tailwindcss` / `@tailwindcss/vite` | 4.3.3   | スタイル            |                                                                                                                    |
| `@lucide/svelte`                    | 1.50.0  | アイコン            |                                                                                                                    |
| `typescript`                        | 6.0.3   | 型                  | latest は 7.0.2 だが、Kit 3.0.0 の peer が `^6.0.0`、svelte-check の peer が `^5 \|\| ^6` のため 6 系の最新        |
| `svelte-check`                      | 4.7.6   | 型チェック          |                                                                                                                    |
| `@types/node`                       | 24.19.1 | Node の型           | 実行環境(Node 24)に合わせて 24 系の最新                                                                            |
| `yaml`                              | 2.9.1   | テスト              | `tests/mcp-manifest.test.ts` が `keelson.yaml` を読む。3.0.0 は next のプレリリース                                |
| `@playwright/test`                  | 1.63.0  | e2e(`pnpm e2e`)     | 2026-09-04 公開の latest。ブラウザ本体は `pnpm e2e:install`(Chromium のみ)で別に入れる(npm の依存には含まれない)   |

## 更新するとき

[CUSTOMIZE.md](./CUSTOMIZE.md) の「依存を更新する」を参照。更新したらこのファイルの版と確認日も直す。
