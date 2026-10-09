# equipment — AI エージェント向けリポジトリガイド

社員への支給品(PC・携帯・セキュリティカードなど)の台帳テンプレートアプリです。改修するときの入口として
このファイルを読んでください。デザインの正は [`DESIGN.md`](./DESIGN.md)、変更の場所別ガイドは
[`CUSTOMIZE.md`](./CUSTOMIZE.md)、改修プロンプト例は [`PROMPTS.md`](./PROMPTS.md) です。

## スタック

- **SvelteKit 3**(`@sveltejs/adapter-node`)+ **Svelte 5**(runes)+ **Tailwind CSS v4**
- **DB**: libSQL(`@libsql/client`)。本番はマネージド libSQL、ローカルはファイル
- **社員**: Keelson Directory API(`@keelsonhq/identity` の `listMembers`)
- **添付**: Keelson のファイルストア(`@keelsonhq/files`)
- **品質ツール**: Vite+(`vp check` = Oxfmt + Oxlint + TS 型検査、`vp test` = Vitest)/ svelte-check(`pnpm typecheck`)/
  Playwright の e2e(`pnpm e2e`。`check` とは別。下の「e2e」)。
  テストの import は `vite-plus/test`(`vitest` 直指定は lint が止める)。`package.json` の `vite` の別名指定(`npm:@voidzero-dev/vite-plus-core`)と
  `overrides` / `pnpm` ブロックは Vite+ の配線なので触らない(版を上げるときは `vite-plus` と別名の版を同時に上げる)
- 版と確認日は [`DEPENDENCIES.md`](./DEPENDENCIES.md)

SvelteKit 3 の注意: 設定は `vite.config.ts` の `sveltekit({...})` に書く(`svelte.config.js` は使わない)。
`$lib` は廃止され、`package.json` の `imports` による **`#lib/*`** を使う。`goto` のオプションは
`replace` / `reset`(旧 `replaceState` / `keepFocus` / `noScroll` ではない)。

## ディレクトリ構成

```
src/
  hooks.server.ts        起動時の準備(ready.ts)と /api の認証(信頼ヘッダ → 401)
  app.html / app.css     書体の読み込み / Tailwind テーマ(DESIGN.md §5 のトークン)
  app.d.ts               event.locals.actor(認証済みの利用者)の型
  routes/
    +layout.svelte       アプリシェル(背表紙・ナビ・バナー・トースト)。ssr=false(+layout.ts)
    +error.svelte        ページが見つからない・表示できないときの画面
    +page.svelte         ホーム(管理者。一般利用者は /me へ)
    me/                  自分のページ(全員。DESIGN.md §9-D)
    (admin)/             管理者の画面(route group: フォルダ名は URL に入らない)。+layout.svelte が管理者でない人に 403 の表示を出す
      items/  members/  history/  import/  masters/   各画面(DESIGN.md §9)。その画面だけの部品(LedgerTable など)も同じフォルダに置く
    api/**/+server.ts    API の薄い入口(入力を読み、業務処理層を呼び、結果を返す)
    api/mcp/[tool]/+server.ts   AI アシスタントのツールの入口(POST /api/mcp/<ツール名>)
    api/[...rest]/+server.ts    どれにも当たらない /api のパスに 404 `{ "error": "not_found" }`
  lib/
    server/              サーバー側。業務処理層(domain/)と、それを API・AI アシスタント・CSV に出す配管
      domain/            業務処理層。認可・整合性・履歴はすべてここ(機能別。components/ の箱と同じ名前)
        home.ts          ホーム
        items.ts         台帳(物品)
        assignments.ts   支給・交換・返却・訂正
        directory.ts     社員の名簿(Directory API)。ほかの層は人についてここに尋ねる
        people.ts        社員の画面が読むもの(社員の検索・社員別一覧・社員ページ・自分のページ)
        events.ts        履歴(操作の記録)
        attachments.ts / files.ts   添付 / ファイルストア
        masters.ts / seed.ts        種類・使用場所 / 初期値とローカル用サンプルの投入
      mcp/               AI アシスタント(MCP)のツール。登録簿は registry.ts、本体は tools.ts
      import/            CSV の形式(csv.ts)と取込(importer.ts)
      http/              API 入口の配管(+server.ts が使う。業務の判断はしない)
      auth/              利用者の解決(actor.ts)・管理者の判定(guard.ts)・GET /api/me(session.ts)
      db/                接続・migration の呼び出し・名前付き引数の規則(named.ts)・行の読み取り(rows.ts。SELECT に無い列を読むと例外)
      content.ts         サーバーが出す日本語(CSV の見出しなど)
      errors.ts          安定エラーコードと HTTP status の表(下の「エラーコード規約」)
      env.ts / dates.ts / ready.ts   環境変数 / 日付 / 起動時の準備
    components/          画面部品。ui/ は業務の語を持たない共通部品、ほかは機能別(server/domain/ と同じ名前)
      PageTitle.svelte   アプリ名とタブの題
      ui/                共通部品(ダイアログ・メニュー・タブ・候補から選ぶ入力欄・表の部品など。下の「部品の見た目と操作は 1 か所に」)
      items/             物品の部品(状態チップ・物品の選択・登録と編集(項目の表示名の表も)・利用停止・添付など)
      assignments/       支給・返却・訂正のダイアログと支給の入力欄(IssueFields.svelte と issueForm.ts)
      people/            社員の表示・メンバー外のチップ・名札ヘッダ・社員の選択
      events/            履歴の表・履歴の種類・履歴の詳細の整形
    state/               画面で共有する状態と、API からの読み込み(loader.svelte.ts)
    messages.ts          エラーコード → 日本語の文言
    limits.ts            入力の上限
    forms.ts             フォームのエラー処理と日付の検査
    api.ts               画面から API を呼ぶ唯一の入口
    ui.ts                DESIGN.md §8 のクラス一式
    format.ts / types.ts   表示の書式 / 画面側の小さな型
    urlstate.ts / urlquery.ts   一覧の条件を URL に残す(URL の組み立てと読み取りは urlquery.ts)
migrations/              データベースの構造(番号付き SQL。スキーマの正はここだけ)
seed-data/               初期値とローカル用サンプル(日本語。正本)
scripts/                 dev.mjs(`pnpm dev` の起動役)/ migrate.mjs(migration ランナー)
tests/                   Vitest(*.test.ts。ルーンを使う状態は *.svelte.test.ts)。サンプルの件数・社員は seed-data/ から読む
  support/               テストの道具(harness.ts: 一時 DB とエラーの検査 / helpers.ts: このアプリの記録 / http.ts: ハンドラの呼び出し)
e2e/                     Playwright の e2e(下の「e2e」)
vite.config.ts / vitest.config.ts / playwright.config.ts   SvelteKit と Vite+ / Vitest / e2e の設定
keelson.yaml             デプロイの設定と、AI アシスタントのツールの宣言(mcp:)
.env.example             設定できる環境変数の一覧(どれも任意。pnpm dev は設定なしで動く)
.keelsonignore           デプロイのアーカイブから除くもの(デプロイの CLI は .gitignore を読まない)
static/                  favicon.svg(文字を含まない図柄)
screenshots/             紹介ページ用の画面写真の置き場所(撮り方は screenshots/README.md)
CHANGELOG.md             版ごとの変更(新しい版を公開するときに追記する)
```

## コマンド

```bash
pnpm install
pnpm dev                 # 開発(keelson dev serve の後ろで UI + API + HMR + サンプル)。既定 http://localhost:5173
                         # 利用者の切り替えは /__keelson/dev。名簿は seed-data/dev-users.json(README「ローカル開発」)
pnpm dev -- --as sample-sato  # 名簿の別の人で始める
pnpm build               # build/ に Node サーバーを出力
pnpm start               # 本番相当(node build/index.js)。信頼ヘッダが無いと 401
pnpm check               # vp check(整形・lint・型)+ vp test run(CI ゲート = これ)
pnpm typecheck           # svelte-kit sync + svelte-check
pnpm e2e:install         # e2e 用の Chromium を入れる(初回と Playwright を上げたとき)
pnpm e2e                 # Playwright の e2e(check とは別。下の「e2e」)
node scripts/migrate.mjs # migration を手で流す(ローカルは local.db。デプロイ時は db.migrate が実行)
```

## 日本語を書いてよい場所

- `.svelte` のマークアップ、およびコンポーネント先頭の `const T = { ... }`(型注釈を付けず `const T = {` で書く。`<script module>` の先頭でもよい)
- `src/lib/messages.ts`(エラーコード → 文言)
- `src/lib/server/content.ts`(サーバーが出す人間向けテキスト)
- `seed-data/**`、`e2e/fixtures/**`、`*.md`、`keelson.yaml`、`src/app.html`
- それ以外(サーバーの他のコード・コメント・テスト・e2e・CSS)に日本語を書かない。**識別子・コメントは英語**

## 変更時に必ず守ること

- **エラーコード規約**: API は `{ "error": "<code>" }` だけを返す(文言は返さない)。入力の誤りは項目に紐づけて
  `{ "error": "validation_failed", "fields": { "<項目>": "<理由>" } }`(`server/http/validate.ts` の `Checker` が集め、`server/errors.ts` の `ValidationError` で返す)。
  新しいエラーは `server/errors.ts` にコード(用途のコードは `APP_CODES`)と HTTP status(`STATUS`)、`messages.ts` に文言を足す
  (どれかが抜けると型検査で落ちる)。`new AppError(code)` は status を表から引く。項目のエラーの理由(`FieldReason`)も共通 / 用途に分けてある。
  画面は項目のエラーを欄の直下に出す(DESIGN.md §8.6)。ページ全体のエラー(`ui/ErrorBox.svelte`)に導線を出すコードは、`messages.ts` の表に
  `action`(リンク先と文言)を書く(例: `forbidden_manage_required` → 自分のページ)。画面ごとに導線を渡さない。
- **入力の上限は `src/lib/limits.ts` だけに書く**: API の本文・クエリ・AI アシスタントの引数・CSV 取込・画面の `maxlength` はここを参照する。
  値が同じでも用途が違えば別の名前にする。`keelson.yaml` の `maxLength` は明示のまま書き、ツールが実際に止める長さとの一致を `tests/mcp-manifest.test.ts` が確かめる。
- **認可は業務処理層で**: 管理系の処理は関数の中で `requireAdmin(actor)` を呼ぶ。UI の出し分けだけに頼らない。
  一般利用者に他人の情報を返す関数を作らない(一般利用者に返すものは CUSTOMIZE.md §5)。
- **スキーマ変更は `migrations/` に新しいファイルを足すだけ**: 適用済みのファイルは編集しない(checksum で起動が止まる)。
  規則は [CUSTOMIZE.md](./CUSTOMIZE.md) の「migration の規則」。物品に項目を 1 つ足すときは、CUSTOMIZE.md §3 の一覧の場所を全部直す。
- **サンプルはローカルとテストだけ**: デプロイしたアプリにサンプルデータを出さない。社員は Directory API だけ
  (ローカルでは `keelson dev serve` か SDK のローカルモードが名簿 `seed-data/dev-users.json` を Directory として返す。アプリにローカル用の認証や社員の分岐は無い)。
- **物品に割当状態を持たせない**: 「誰が持っているか」は `assignments` の `returned_on IS NULL` の行だけが正。
  支給・返却を変えるときは `server/domain/assignments.ts` の 1 バッチの形(先頭の文に条件、後続は `changes() = 1` で連鎖)を保つ。
- **履歴**: 物品と割当を変える操作(登録・編集・利用停止・再開・支給・返却・訂正)は、1 操作 = 1 バッチで、
  同じバッチに `eventAfterChangeStatement(...)` を 1 件以上書く。CSV 取込は 100 行ごとのバッチにその行の分を書き、最後に「取込」を 1 件書く。
  種類・使用場所と添付の変更は履歴に残さない。
- **画面は API を通す**: `+page.svelte`(と併置コンポーネント)から業務処理層を直接呼ばない(SSR を無効にして `/api` を読む構成)。
  応答の型は業務処理層の型(`ItemList` / `EventList` / `MemberList` など)を `import type` で使い、画面で写さない。
  読み込みは `state/loader.svelte.ts` の `loader(() => url)` で書く(`data` / `loading` / `error` / `reload()`)。一覧は `{ keepPreviousData: true }`
  (条件を変えても読み込み中は前の行を出したまま)、1 件のページは指定しない(別の記録に移ると空から)。一覧の並べ替え・ページ送りの読み取りは `listParams`。
- **ダイアログは開いている間だけ描く**: 呼ぶ側が `{#if issueItem}<IssueDialog item={issueItem} … />{/if}` と書き、閉じるときは条件を戻す
  (`ui/Dialog.svelte` はマウントで開き、外れるときに開いたボタンへフォーカスを返す)。ダイアログの入力の初期値は `$state(...)` の宣言に書き、
  prop や `$derived` から取るときは `untrack(() => …)` で包む。開くたびに戻す `$effect` は書かない(開くたびに作り直される)。
  今日の日付・管理者かどうかは `session`(`state/session.svelte.ts`)から読み、props で渡さない。
  日付の入力の検査(必須・未来の日付・支給日より前)は `forms.ts` の `dateProblem()` で書く(ダイアログごとに比較を書かない)。
- **管理者の画面は `src/routes/(admin)/` に置く**: 権限の表示はそこの `+layout.svelte` が出す。画面ごとに `isAdmin` を確かめない
  (API は業務処理層で `requireAdmin` が守る。上の「認可は業務処理層で」)。
- **部品の見た目と操作は 1 か所に**: DESIGN.md §8 のクラスは `src/lib/ui.ts` のレシピを使い、画面に直書きしない(足りなければ `ui.ts` に足す)。
  表の読み込み中・エラー・空は `ui/TableState.svelte`(表の中に出す)、データを待つ画面全体は `ui/PageLoading.svelte`。
  行を押して別の画面へ移る表は `<tr {@attach rowLink(href)}>`(`ui/rowLink.ts`)。タブの題は `<PageTitle title="…" />`(アプリ名を付けるのはこの部品)。
  メニューは `ui/Menu.svelte`、タブは `ui/Tabs.svelte`、候補から選ぶ入力欄は `ui/Combobox.svelte` の上に作る
  (検索は呼ぶ側が `loader` で読む。例: `items/ItemPicker.svelte`・`people/MemberCombobox.svelte`)。
  操作の仕様(閉じ方・キー操作・フォーカス)は各部品の冒頭のコメントにある。
- **画面でも同じ知識を写さない**: いくつもの画面に出る表示名(物品の状態・物品の項目名・履歴の種類・台帳の列名など)は、描画するコンポーネントの
  `<script module>` が export する表を import する(どの表がどこにあるかは CUSTOMIZE.md §4)。返却ダイアログの対象は
  `components/assignments/returnTarget.ts`(物品から / 保有物から)で作り、支給の入力欄(社員・使用場所・日付・備考)は
  `components/assignments/IssueFields.svelte`、その初期値・検査・送信データは隣の `issueForm.ts` を使う。
- **ロジックと型は隣の `.ts` に**: `.ts`(テスト)から `.svelte` の `<script module>` の export は名前付きで
  import できない(`vp check` の型検査は `.svelte` を default export だけと見なす)。日本語を含まないロジックと型は隣の `.ts` に置き
  (例: `assignments/issueForm.ts`)、テストはそれを普通に import する。`<script module>` に置くのは日本語の表示名の表とそれに直に付くもの
  (台帳の列の定義など)だけにし、テストから読むときは `tests/components.test.ts` のように名前空間で import して型を書いて読む。
- **人の所属(メンバーかどうか)の項目名は、隣の画像の項目と同じ接頭辞にする**: `imageUrl` の隣は `membership`(`Holder`・`MemberRow`・`PersonPage.person`)、
  割当の行の `userImageUrl` の隣は `userMembership`。どちらも `peopleIndex` から表示のたびに引き、画面は `former` の人の隣にチップを出す(DESIGN.md §8.10)。
- **AI アシスタントのツール(`server/mcp/`)は domain を呼ぶだけ**: SQL を書かない(要る読み取りは `domain/` に足す)。
  足し方(`keelson.yaml` の `mcp.tools` と `mcp/registry.ts` の両方を直す)と書き方(人の解決・結果の大きさ)は [CUSTOMIZE.md](./CUSTOMIZE.md) §9。
- **一覧は表**: カード・タイル・リストにしない。ページング・ソート・絞り込みはサーバー側(DESIGN.md §2, §3)。
  行の高さ・文字の大きさは `src/app.css` の密度トークンと `src/lib/ui.ts` の `table` を使う。
- **定期実行(`keelson.yaml` の `crons:`)のジョブを足すとき**: ジョブは Node が型を取り除くだけで直接実行する(`node src/lib/server/jobs/<name>.ts`)。
  ジョブから import で辿るモジュールに、取り除けない TypeScript(parameter property を使う `http/validate.ts` の `Checker` など)や
  属性なしの JSON の import(`domain/seed.ts`・`domain/directory.ts`)を含めない。テストでジョブを実際に起動して確かめる。

## e2e

`pnpm e2e`(Playwright)は基本操作の正常系を chromium(headless)で通す(異常系は網羅しない)。1 ファイル = 1 シナリオで、
ファイル名がその内容(例: `03-register-and-issue.spec.ts` = 登録と同時に支給)。`pnpm check` には含まれない。

`playwright.config.ts` の `webServer` が `scripts/dev.mjs --port 5190`(`E2E_PORT` で変更)を、実行ごとに新しい一時ディレクトリの DB(`LOCAL_DB_URL`)・ファイル置き場と
`LOCAL_SAMPLE_DATA=1` で起動する(`.env` の DB・デプロイの設定と SDK のローカルモードは空にして無効化。`local.db` を使わないので `pnpm dev` と並べて動かせる)。
launcher は `keelson dev serve` の後ろで開発サーバーを動かすので、e2e には Keelson CLI(v0.6.11 以降)が要る。無いときは `playwright.config.ts` が
入れ方を示すエラーで止まる(CI の e2e ジョブは公開のインストーラで CLI を入れてから走る)。
テストは API が応答してから(`webServer.url`)、`e2e/global-setup.ts` が全画面を 1 回開き終えてから始まる(開発サーバーは画面を初めて開かれたときに組み立てる)。
管理者は名簿(`seed-data/dev-users.json`)の先頭の管理者(`keelson dev serve` の既定の利用者)、一般利用者は別のブラウザコンテキストに
`X-Keelson-Dev-As: <名簿の最初の一般の社員の ID>` を付けて作る(`e2e/support/harness.ts`)。

- **画面の文言では要素を探さない・確かめない**(英語版の公開でも同じテストが通るように)。e2e のソースは日本語を書けない場所なので、
  日本語が要る入力(取込用 CSV)は `e2e/fixtures/` に置く
- 要素は `data-testid`(`kebab-case`。例: `item-register`、`field-error-assetTag`)、role、フォームの `name` 属性(= API の項目名)で取る。
  状態チップ・朱印・履歴の種類は `data-status` / `data-kind`(英語の値)で確かめる。画面を作り替えるときはこれらの属性を残す
- シナリオは互いに独立させる: 前提データは管理者の API で作り、管理番号は `uniqueTag()` で実行ごとに固有にする。支給先の名簿の人も
  シナリオごとに分ける(並列に走るため。`e2e/support/app.ts` の `holderFor`)。fixture の中で実行ごとに変わる値・サンプルから決まる値は
  `{{PREFIX}}` などの置き換えにして spec が `fillFixture()` で埋める(同じ DB で繰り返しても通るように。`pnpm e2e --repeat-each=3` で確かめる)
- 失敗時だけ screenshot と trace を `test-results/` に残す(`pnpm exec playwright show-trace <zip>` で見る)

変更後は `pnpm check` と `pnpm typecheck` を通してください。画面を変えたら `pnpm e2e` も通してください。
