# カスタマイズガイド

このテンプレートは「持ち帰って AI で改修する小さな業務アプリ」です。よくある変更の場所をまとめます。
AI エージェント(Claude Code / Codex など)にそのまま渡せる改修プロンプト例は [PROMPTS.md](./PROMPTS.md) にあります。

変更後は必ず次を通してください:

```bash
pnpm check       # format + lint + 型 + test(Vite+ の vp check / vp test)
pnpm typecheck   # 型チェック(画面のコードも含む)
pnpm e2e         # 画面を変えたとき: ブラウザで基本操作を通す(初回は pnpm e2e:install。仕組みは AGENTS.md「e2e」)
```

---

## 1. 種類・使用場所を変える(コード変更不要)

管理者で **マスタ管理** を開き、「種類」「使用場所」のタブで追加・名前の変更・無効化ができます。
CSV 取込で未登録の種類・使用場所を自動で追加することもできます(取込画面の選択肢)。
使わなくなった値は無効にすると新しい登録の選択肢から外れ、登録済みの記録の表示はそのまま残ります。

初期値は [`seed-data/masters.json`](./seed-data/masters.json) です。アプリの起動時に、**まだ 1 件も無い一覧にだけ**
入ります(管理者が名前を変えた値を元に戻すことはありません)。

## 2. 色・書体・表の密度を変える

- **アクセント色(左端の背表紙・主ボタン)**: [`src/app.css`](./src/app.css) 冒頭の `--color-accent` 系 3 行を
  差し替えます。白文字とのコントラスト比 4.5:1 以上の濃さを選んでください(DESIGN.md §5)。
- **書体**: `src/app.css` の `--font-sans` / `--font-mono` と、[`src/app.html`](./src/app.html) の読み込み `<link>`。
  番号・日付用の等幅書体は残してください。
- **表の行の高さ・文字の大きさ**: `src/app.css` の密度トークン(`--row-h` / `--cell-text` / `--chip-text` /
  `--meta-text` など。既定と `.density-dense`)。すべての表とチップがこの値を読みます。
- 紙色・墨色・罫線の値、角丸と影のルール、「一覧は表」は変えない前提です(DESIGN.md §11)。
- ボタン・入力欄・表・タブ・メニューなどのクラスは [`src/lib/ui.ts`](./src/lib/ui.ts) にまとめてあります。共通の部分
  (大きさ・見た目・フォーカスの輪)の定数を直すと、それを使う部品すべてに効きます。組み上がったクラスは `tests/ui.test.ts` が
  固定しているので、意図して変えたらテストの期待値も直してください。

## 3. 物品に項目を 1 つ足す(データベースの変更を含む)

例: 物品に「保証期限」(`warranty_until`、日付、任意)を足す。**下の一覧の場所を、全部**直します。
どれかを飛ばすと、手元のテストは通るのにデプロイ先で壊れる、という事故になります。

どこを触るかの目安: **保存**は 1〜2(migration・`domain/items.ts`)、**入力**は 3〜4(上限・API の本文)、
**外部の入出力**は 5〜6(AI アシスタント・CSV)、**画面**は 7、サンプルとテストは 8〜10 です。

「(型)」と書いた場所は、直し忘れると `pnpm check` / `pnpm typecheck` の型検査が止めます(`ItemFields` か
`CSV_COLUMNS` から型を取っているため)。「(テスト)」と書いた場所は、直し忘れると `pnpm check` の全項目の往復テスト
([`tests/item-fields.test.ts`](./tests/item-fields.test.ts))が止めます。このテストは、全項目に値を入れた物品が
API の登録と編集・CSV の出力と取込・AI アシスタントの `register_item` と `get_item`・編集の履歴を通っても変わらないことを、
`ItemFields` の全項目について確かめます。新しい項目もテストを書き足さずに確かめられます(値は手順 9 で足します)。
印の無い場所(画面のセルと入力欄・`keelson.yaml`・説明文)は型でもテストでも気づけないので、一覧を上から順に確かめてください。

1. **migration**: `migrations/` に新しいファイルを作ります。番号は既存の最大 + 1。
   ```sql
   -- migrations/0003_add_warranty_until.sql
   -- Warranty end date of an item (optional).
   ALTER TABLE items ADD COLUMN warranty_until TEXT;
   ```
2. **型と読み書き**: [`src/lib/server/domain/items.ts`](./src/lib/server/domain/items.ts)
   - `ItemFields` に項目を足す(`ItemView` はこれを継承するので、そちらには足さない)
   - `FIELD_COLUMNS` に列名(型)。台帳の SELECT(`ITEM_COLUMNS_SQL`)、登録の INSERT(`itemInsertStatements`)、
     編集の UPDATE と履歴の前後の値は、どれもここから組み立てられるので、SQL を書き足す必要はありません。
     登録・AI アシスタント・CSV 取込・サンプルの投入はすべてこの INSERT を通ります
   - `itemViewOf` に読み取り(型。`warrantyUntil: strOrNull(r, 'warranty_until')`)。列名を書き誤ると、読み取りが例外になります
     (`db/rows.ts` の読み取りは、SELECT に無い列を読むと止まる)
   - 台帳で並べ替えたいときは `ITEM_SORTS` と `SORT_SQL` にも足し、手順 7 の `COLUMNS` の行に `sort` を付ける
   - 別の表を参照する項目(種類の `typeId` のような ID)を足すときは、履歴に名前で残します。`namedChanges` の表(`NAMED_FIELDS`)に
     履歴でのキー(`type` のような名前用のもの)と表を足し、[`EventsTable.svelte`](./src/lib/components/events/EventsTable.svelte) の
     `T.fields` にそのキーの表示名を足します(`type: ITEM_FIELD_LABELS.typeId` と同じ形)
3. **上限(文字列の項目だけ)**: [`src/lib/limits.ts`](./src/lib/limits.ts) の `ITEM_LIMITS` に上限を足します。
   API・CSV 取込・AI アシスタント・画面の `maxlength` がこの値を読みます
4. **API の入力**: [`src/lib/server/http/bodies.ts`](./src/lib/server/http/bodies.ts) の `itemFields`(型)。日付なら `c.date`、
   文字列なら `c.text` と `ITEM_LIMITS`。誤りは項目単位のエラー(`validation_failed`)で返ります
5. **AI アシスタント(MCP)**: 宣言と実装の 2 か所(§9)
   - [`src/lib/server/mcp/tools.ts`](./src/lib/server/mcp/tools.ts): `registerItem` の入力(型。`c.date('warranty_until')`)と
     `getItem` の結果(テスト。`warranty_until`)。項目のエラーは業務処理層の項目名(`warrantyUntil`)から引数名(`warranty_until`)に
     自動で読み替わります(`mcp/refs.ts` の `argName`。引数名が項目名の snake_case でないときだけ `ARG_NAMES` に足す)
   - [`keelson.yaml`](./keelson.yaml) の `register_item` の `input.properties` に `warranty_until`(`type: string`、`format: date`、
     日本語の `description`)。文字列の項目なら `maxLength` を `limits.ts` と同じ値で書きます(`tests/mcp-manifest.test.ts` が一致を確かめる)
6. **CSV 出力・取込**:
   - [`src/lib/server/content.ts`](./src/lib/server/content.ts) の `CSV_COLUMNS`(列名。出力・取込・ひな形で共通)と
     `CSV_TEMPLATE_EXAMPLES`(型)
   - [`src/lib/server/import/csv.ts`](./src/lib/server/import/csv.ts) の `itemsToCsv` の列の値(型)
   - [`src/lib/server/import/importer.ts`](./src/lib/server/import/importer.ts) の `readItem`(行から物品の項目を読む。型。日付なら `row.date('warrantyUntil')`)
   - 取込画面の列名: [`src/routes/(admin)/import/PreviewTable.svelte`](<./src/routes/(admin)/import/PreviewTable.svelte>) の `T.columns`(型)。
     値は手順 7 の表示名の表から取ります(`warrantyUntil: F.warrantyUntil`)。
     プレビュー表と、[`src/routes/(admin)/import/+page.svelte`](<./src/routes/(admin)/import/+page.svelte>) の手順 1「列の対応」の表がこの列名を使います。
     手順 1 の説明文(「管理番号・物品名(必須)、種類・…」)は列名を手で並べているので、そこにも足します。
     日付の列なら、`PreviewTable.svelte` のセルを等幅にする条件(`f === 'purchasedOn' || …`)にも足します
7. **画面**:
   - 項目の表示名: [`src/lib/components/items/ItemFormDialog.svelte`](./src/lib/components/items/ItemFormDialog.svelte) の
     `<script module>` の `T.fields`(型)。登録・編集フォームの欄の名前、物品詳細の `<dt>`、取込画面の列名、台帳の列名、
     履歴の編集の前後(`EventsTable.svelte` が表ごと取り込む)がこの表(`ITEM_FIELD_LABELS`)を使うので、名前はここに 1 回だけ書きます
   - 台帳の列: [`src/routes/(admin)/items/LedgerTable.svelte`](<./src/routes/(admin)/items/LedgerTable.svelte>) の `COLUMNS`(優先度を決める。
     3 以上なら既定は非表示)・`T.columns`(列名は表示名の表から `F.warrantyUntil`。列メニューもこの列名を使う)・セルの表示
   - 物品詳細の属性表: [`src/routes/(admin)/items/[id]/+page.svelte`](<./src/routes/(admin)/items/[id]/+page.svelte>) の定義リスト
     (`<dt>` は `{ITEM_FIELD_LABELS.warrantyUntil}`)
   - 登録・編集フォーム: [`src/lib/components/items/ItemFormDialog.svelte`](./src/lib/components/items/ItemFormDialog.svelte) の
     状態(`$state` の初期値は編集する物品から)・項目名の一覧(`ITEM_FIELDS`。欄の直下にエラーを出す項目)・「保存して続けて登録」で空にする値(`nextItem`)・
     送る本文・入力欄。
     入力欄には `<label>` に `{T.fields.warrantyUntil}`、`name` = 項目名、`aria-invalid` と `<FieldError>`、文字列なら
     `maxlength={ITEM_LIMITS.<項目>}` を付けます(既存の欄と同じ形)
   - [DESIGN.md](./DESIGN.md) の項目の列挙: §9-A の台帳の列表、§9-B の属性の定義リスト、§9-E の「物品を登録」、§9-H の「ファイルの形式」
8. **サンプル**: [`seed-data/items.json`](./seed-data/items.json) に値を入れ(任意。日付は `purchasedDaysAgo` のような「何日前」の数で持つ)、
   [`src/lib/server/domain/seed.ts`](./src/lib/server/domain/seed.ts) の `SeedItem` と `fields` の組み立て(型)に足す
9. **テスト**:
   - [`tests/support/helpers.ts`](./tests/support/helpers.ts) の `itemFields()`(物品を作るテストの既定値。型)と
     `completeItemFields()`(全項目の往復テストの値。型。`second` のときは全項目を別の値にする)
   - [`tests/items.test.ts`](./tests/items.test.ts) の `editBody`(編集フォームが送る全項目。型)
   - 登録・編集・CSV・AI アシスタント・履歴で値が往復するかは、全項目の往復テストが確かめるので書き足さなくて済みます。
     項目に固有の規則(日付の検査など)があるときだけ、そのテストを足します
10. **e2e**: CSV の列が増えると [`e2e/fixtures/import.csv`](./e2e/fixtures/import.csv) の見出しがひな形と合わなくなり、
    `pnpm e2e` の CSV 取込(08)が失敗します。見出し行の、ひな形と同じ位置(`CSV_COLUMNS` の順)に列名を足し、
    各行の列数を揃えてください(値は空でも構いません)。
    出力(09)は列数をひな形から数えるので直さなくて済みます。登録と詳細で値を確かめたいときは、
    [`e2e/02-register.spec.ts`](./e2e/02-register.spec.ts) に入力(`[name="warrantyUntil"]`)と確認を足し、
    物品詳細の `<dd>` に `data-testid="item-attr-warranty"` を付けます。e2e のファイルには日本語を書かないでください(AGENTS.md「e2e」)

### 項目を消す

例: 物品の「購入日」(`purchased_on`)を使わなくなった。方法は 2 つあります。

**推奨: 画面・CSV・AI アシスタントから外し、データベースの列は残す。** 列と値が残るので、あとで戻せます。
`ItemFields` から項目を消すと、型検査が「(型)」の場所を教えてくれます。外す場所は、足すときの一覧(上の 2〜10)と同じです:

- `domain/items.ts`: `ItemFields`・`FIELD_COLUMNS`・`itemViewOf`(SELECT・INSERT・UPDATE からは自動で外れます)。
  並べ替えや台帳の検索(`baseWhere` の `LIKE`)に使っていれば、`ITEM_SORTS`・`SORT_SQL` とその条件からも消します
- 上限(`limits.ts`)・API の入力(`http/bodies.ts`)
- AI アシスタント: `mcp/tools.ts` の `registerItem` と `getItem`、`keelson.yaml` の `register_item` の `input.properties`
- CSV: `content.ts` の `CSV_COLUMNS` と `CSV_TEMPLATE_EXAMPLES`、`itemsToCsv`、`readItem`、取込画面の列名と手順 1 の説明文
- 画面: 表示名の表(下の「履歴の項目名」)、台帳の列、物品詳細、登録・編集フォーム、DESIGN.md の列挙
- サンプルとテスト: `seed-data/items.json` と `seed.ts`、`helpers.ts`、`editBody`、`e2e/fixtures/import.csv` の列

最後に、列名(`purchased_on`)と項目名(`purchasedOn`)で `src/`・`tests/`・`e2e/` を検索し、残りが無いか確かめます。
列を残すと、新しく登録した物品のその列は空(NULL)になります。`NOT NULL` の列(管理番号・物品名)はこの方法では外せません。

**上級: 列ごと消す。** 上の場所に加えて、新しい migration で列を消します。値は戻せません。

```sql
-- migrations/0003_drop_purchased_on.sql
-- The purchase date is no longer kept.
ALTER TABLE items DROP COLUMN purchased_on;
```

SQLite では、インデックス・UNIQUE・外部キー・CHECK などが付いた列(例: 種類の `type_id`)はこの 1 文では消せず、テーブルの作り直しが要ります(下の「migration の規則」)。

**履歴の項目名は、どちらの方法でも残します。** 過去の編集の履歴には、消した項目の前後の値が残っています。表示名が無いと、
履歴の詳細にキー(例: `purchasedOn`)がそのまま出てしまいます。項目の表示名の表(`ItemFormDialog.svelte` の `T.fields`)は
`ItemFields` の項目と一致させる型なので、そこからは消し、その名前を履歴の表
[`src/lib/components/events/EventsTable.svelte`](./src/lib/components/events/EventsTable.svelte) の `T.fields` の末尾
(「A field removed from items keeps its name here」のコメントの下)に移します(例: `purchasedOn: '購入日',`)。

### 項目を並べ替える

- 台帳の列の順: [`LedgerTable.svelte`](<./src/routes/(admin)/items/LedgerTable.svelte>) の `COLUMNS` の並び
- CSV の列の順: [`content.ts`](./src/lib/server/content.ts) の `CSV_COLUMNS` の並び(出力・ひな形・取込画面の列の対応で共通)。
  取込は見出しの名前で列を対応させるので、並べ替えても既存の CSV は読めます。ただし列名(見出し)を変えると、
  古い見出しの CSV はその列を取り込めなくなります
- 登録・編集フォームと物品詳細の順: それぞれのマークアップの並び

### migration の規則

- **データベースの構造(テーブル・列・インデックス)は `migrations/` の SQL ファイルだけで変えます。**
  アプリのコードに `CREATE TABLE` / `ALTER TABLE` を書かないでください。
- ファイル名は `NNNN_<slug>.sql`(4 桁ゼロ埋めの番号 + 英小文字・数字・`_` のスラッグ)。番号順に、前にだけ進みます。
  元に戻す(down)仕組みはありません。戻したいときは、戻す内容の新しいファイルを足します。
- **適用済みのファイルは編集しません。** 内容を変えるとチェックサムが合わなくなり、起動とデプロイが
  `migration_checksum_mismatch` で止まります。直したいときは新しいファイルを足します。
- **文の区切り**: 行末の `;` で 1 文が終わります。`--` で始まる行はコメントとして無視します。
  文の途中に `;` を書かないでください(そのためトリガーは使えません)。
- 1 ファイルは 1 トランザクションで適用され、適用済みの記録(`schema_migrations`)も同じトランザクションで残ります。
  途中で失敗すると、そのファイルの変更はすべて取り消されます。
- **追加系の変更(列・テーブル・インデックスの追加)を優先します。** 列の型や制約を変えるには
  テーブルの作り直し(新しいテーブル → `INSERT INTO ... SELECT` → 入れ替え)が要ります。
  デプロイ先のデータベースはネットワーク越しなので、重い作り直しは 10 秒以内に収まる規模にしてください。
- 0001 だけは `IF NOT EXISTS` 付きです(migration 導入前に作られたデータベースに、記録だけを残すため)。
  0002 以降は普通の DDL で書きます。作り直しの実例は `0002_import_event.sql`(履歴の種類に「取込」を足すため、
  CHECK 制約を持つ `events` を作り直している)。
- 適用のタイミング: デプロイ時に `keelson.yaml` の `db.migrate`(`node scripts/migrate.mjs`)が新しい版の動き出す前に
  1 回実行され、アプリの起動時にも同じ処理が走ります(ローカル・テストでも同じ)。手で流すときは
  `node scripts/migrate.mjs`(アプリのディレクトリで実行。ローカルでは `local.db` が対象)。

## 4. 画面の文言を変える

- 画面のラベル: 各 `.svelte` のマークアップ、またはコンポーネント先頭の `const T = { ... }`
- ナビの項目名: [`src/routes/+layout.svelte`](./src/routes/+layout.svelte) の `T.nav`(並びは `ADMIN_NAV` の配列)
- いくつもの画面に出る名前は、それを描画するコンポーネントの `<script module>` の `T` に 1 か所だけあります。
  ほかの画面はそこから export された表を import しているので、ここを直せば全部の画面に効きます
  - 物品の状態・利用停止の理由: [`src/lib/components/items/StatusChip.svelte`](./src/lib/components/items/StatusChip.svelte)
    (`STATUS_LABELS` / `REASON_LABELS`。台帳の集計と絞り込み、ホーム、物品詳細、履歴の詳細、利用停止と返却のダイアログの選択肢が使う)
  - 履歴の種類: [`src/lib/components/events/EventKind.svelte`](./src/lib/components/events/EventKind.svelte)(`KIND_LABELS`。履歴の絞り込みも使う)
  - 「(種類なし)」: [`src/lib/components/items/TypeName.svelte`](./src/lib/components/items/TypeName.svelte)(`NO_TYPE_LABEL`。ホームの在庫と台帳の絞り込み)
  - 物品の項目の名前(管理番号・物品名・種類・製造番号・購入日・保管場所・備考): [`src/lib/components/items/ItemFormDialog.svelte`](./src/lib/components/items/ItemFormDialog.svelte)
    (`ITEM_FIELD_LABELS`。登録・編集フォーム、物品詳細、台帳の列名、取込画面の列名、履歴の編集の前後が使う)。消した項目の名前は §3「項目を消す」
  - 台帳の列名: [`src/routes/(admin)/items/LedgerTable.svelte`](<./src/routes/(admin)/items/LedgerTable.svelte>)(`COLUMN_LABELS`。列メニューも使う)。
    物品の項目の列(物品名・種類・製造番号)は上の表から取り、状態・支給先・支給日・使用場所・更新はここに書いてあります
  - 朱印の文言(返却済・回収済): [`src/lib/components/assignments/AssignmentLedger.svelte`](./src/lib/components/assignments/AssignmentLedger.svelte) の `T.seals`。
    朱印の部品(`ui/Seal.svelte`)は文言を持たず、呼ぶ側が `label` で渡します
- エラーの文言: [`src/lib/messages.ts`](./src/lib/messages.ts)(コード → 見出し + 原因と対処。入力欄の直下に出す
  1 文は `fieldMessage`(項目 + 理由)、CSV 取込の判定は `importIssueMessage`)。ページ全体のエラーに出すリンクもコードごとにここに書きます
  (`action`。例: 管理権限がないとき(`forbidden_manage_required`)の「自分のページへ」)
- CSV の見出し・ひな形の例・状態名: [`src/lib/server/content.ts`](./src/lib/server/content.ts)。CSV の状態名・利用停止の理由は画面の名前
  (`StatusChip.svelte`)とは別に書いてあるので、揃えたいときは両方を直します(サーバーの文言と画面の文言は置き場所が分かれているため)

日本語を書けるのは決まった場所だけです(一覧は [AGENTS.md](./AGENTS.md) の「日本語を書いてよい場所」)。
e2e は画面の文言で要素を探さないので、文言を変えても壊れません(要素を作り替えるときの約束は AGENTS.md「e2e」)。

### アプリ名を変える

画面に出るアプリ名(左の背表紙の上、狭い画面の上部バー、ブラウザのタブの題)は、コードでは
[`src/lib/components/PageTitle.svelte`](./src/lib/components/PageTitle.svelte) の `T.app` の 1 か所だけです。
タブの題(「台帳 | 備品管理」)は各画面がこの部品で付けるので、画面ごとに直す場所はありません。コードの外では次も直します:

- [`keelson.yaml`](./keelson.yaml) の `mcp.instructions` の 1 行目(AI アシスタントへの説明。「台帳(備品管理)です」)と、
  必要なら `description`(アプリの説明)
- [`README.md`](./README.md) の見出し(DESIGN.md の表題も同じ名前です)
- [`src/app.html`](./src/app.html) にはアプリ名を書いていません(`<title>` は `PageTitle` が付けます)。アイコン
  (`static/favicon.svg`)は文字を含まない図柄です

## 5. 一般の社員に見せる範囲を変える

一般の社員(`manage` なし)に返すデータは次の 2 か所で決まります。広げるときは、他人の情報を返して
よいかを先に決めてください。

- 自分の支給品と履歴: [`src/lib/server/domain/people.ts`](./src/lib/server/domain/people.ts) の `getMe`
- 利用可能な物品: [`src/lib/server/domain/items.ts`](./src/lib/server/domain/items.ts) の `listAvailableItems`(返す列を限定している)

管理者だけの処理は、関数の中で `requireAdmin(actor)` を呼んでいます。画面のボタンを隠すだけでは守れません。

## 6. 添付の形式・上限を変える

形式の判定は [`src/lib/server/domain/attachments.ts`](./src/lib/server/domain/attachments.ts) の `detectKind`、上限は
[`src/lib/limits.ts`](./src/lib/limits.ts) の `ATTACHMENT_BYTES_MAX` / `ATTACHMENTS_PER_ITEM_MAX` です。1 ファイルの上限はファイルストアの上限(10 MiB)を
超えられません。上限を上げるときは `keelson.yaml` の `BODY_SIZE_LIMIT` も合わせます。上限を文で書いている文言
(添付欄の案内 `src/lib/components/items/AttachmentList.svelte` と `src/lib/messages.ts` の `attachment_too_large` / `attachment_limit_reached`)も直します。

## 7. サンプルデータを変える

[`seed-data/`](./seed-data/) の JSON を編集します(構成は [seed-data/README.md](./seed-data/README.md))。
サンプルはローカル開発(`pnpm dev`)とテスト・画面写真の撮影用です。`pnpm dev` が、ローカルのデータベースに
物品が 1 件も無いときにだけ入れます。入れ直すときは `local.db` を消してから `pnpm dev` を起動してください。
デプロイしたアプリと `pnpm start` には入りません。
テスト(`tests/`・`e2e/`)はサンプルの件数と社員を `seed-data/` から読むので、行を増減してもテストは直さずに通ります(支給中・未割当・交換中・
返却期限超過・利用停止の物品、何も持たないメンバー外の人を 1 件ずつと、名簿 `dev-users.json` の一般の社員 7 人以上は残してください)。
名簿 `dev-users.json` は `pnpm dev` でログインする人と社員の一覧です(先頭の管理者が既定の利用者)。割当・履歴の `user` は名簿の ID か、
`assignments.json` の `former`(メンバー外)の ID にしてください。

## 8. 依存を更新する

採用している版と確認日は [DEPENDENCIES.md](./DEPENDENCIES.md) にあります。**記憶で書かず、npm registry で
最新の安定版を確認してから**固定します。

```bash
pnpm outdated
pnpm up <package>@<version>   # 安定版のみ。RC / next は避ける
npm install --package-lock-only   # デプロイ用の package-lock.json も合わせる
pnpm check && pnpm typecheck && pnpm build
```

`@playwright/test` を上げたときは、対応するブラウザを入れ直すため `pnpm e2e:install` のあと `pnpm e2e` を通してください。
更新したら DEPENDENCIES.md の版と確認日も直してください。SvelteKit を上げるときは peer の範囲
(TypeScript など)を確認してください。

## 9. AI 向けのツールを足す・変える(MCP)

AI アシスタント(Claude・ChatGPT など)から使うツールは、**2 か所**で宣言します。名前・種別・権限がずれると
`pnpm check` のテスト(`tests/mcp-manifest.test.ts`)が失敗します。ツールの動きのテストは `tests/mcp.test.ts` です。

1. **[`keelson.yaml`](./keelson.yaml) の `mcp.tools`** — AI に見せる側。`name`(英小文字・数字・`_`)、`description`、
   `input`(引数の JSON Schema。`type: object`)、`access`(`read` / `write`)、`permission`(`view` / `manage`)
2. **[`src/lib/server/mcp/registry.ts`](./src/lib/server/mcp/registry.ts) の `MCP_TOOLS`** — 動く側。同じ名前で
   `access` / `permission` / `run` を登録し、`run` の本体は [`src/lib/server/mcp/tools.ts`](./src/lib/server/mcp/tools.ts) に書きます
   (関数名はツール名の camelCase。`issue_item` → `issueItem`)

書き方:

- **`description` は AI への説明書きです。** 何をするか、いつ使うか、言い回しの例(「〜して」→ 引数)を 1〜2 個、
  日本語で書きます(1,024 文字まで)。全体に共通する約束(物品は管理番号で指定する、日付を省くと今日、エラーの読み方)は
  `mcp.instructions` に書きます
- **`input` の各項目に `description` を付けます。** 選択肢は英語の値を `enum` にして、意味を `description` に日本語で併記します。
  日付は `format: date`、人は `person`(名前かメールアドレス)、物品は `asset_tag`。`required` は本当に必須のものだけ。
  `additionalProperties: false` を付けます(引数名の誤りを AI に気づかせるため)
- **文字列の引数には `maxLength` を付けます。** 値は [`src/lib/limits.ts`](./src/lib/limits.ts) の上限と同じにし、ツールの実装も
  同じ定数で読みます(`c.text('note', { max: ISSUE_NOTE_MAX })`)。宣言とツールが止める長さの一致は `tests/mcp-manifest.test.ts` が確かめます
- **ツールは業務処理層(`src/lib/server/domain/`)を呼ぶだけ**にします。SQL を書かず、要る読み取りは `domain/` に関数を足します。
  権限の確認(`requireAdmin`)・整合性・履歴は `domain/` がこれまでどおり行います
- 人の指定は [`src/lib/server/mcp/people.ts`](./src/lib/server/mcp/people.ts) の `resolvePersonRef`、種類・使用場所の名前は
  [`src/lib/server/mcp/refs.ts`](./src/lib/server/mcp/refs.ts) の `masterByName` / `placeOrFirst` で引きます
  (曖昧なら候補を返す。推測で選ばない)
- **結果は小さく**: 一覧は `limit`(既定 20・最大 50。`limits.ts` の `MCP_LIST_LIMIT`)と `total` / `truncated`、行は要点の列だけ。
  長い文章や履歴の全件は返しません
- サーバーが返すのはエラーコードだけです(文言は返さない。新しいコードの足し方は AGENTS.md「変更時に必ず守ること」のエラーコード規約)。
  ツールが新しいコードを返すようになったら、その意味を `mcp.instructions` か `description` に書きます

ローカルでは `pnpm dev` を起動して、`curl -s -X POST localhost:5173/api/mcp/<ツール名> -H 'content-type: application/json' -d '{...}'`
で試せます。宣言の変更が AI アシスタントに届くのは再デプロイの後です(AI アシスタントによっては、接続し直すまで前の一覧を使います)。

---

## 10. Keelson 以外で動かす

このアプリは Keelson で動かすことを前提に作っていますが、Keelson でしか動かないわけではありません。
中身はふつうの SvelteKit(Node.js)アプリで、`pnpm build` と `pnpm start` で起動できます。

Keelson が受け持っているのは次の 2 つです。ほかの環境で運用するときは、自社の仕組みにつなぎ替えてください。

- **ログイン** — Keelson のゲートウェイがログインを済ませ、利用者を `X-Keelson-User-*` ヘッダでアプリに渡しています
  ([`src/lib/server/auth/`](./src/lib/server/auth/))。アプリはこのヘッダをそのまま信頼し、ヘッダが無いと API は 401 を返します
- **社員の一覧** — Keelson の Directory API から読んでいます([`src/lib/server/domain/directory.ts`](./src/lib/server/domain/directory.ts))

データベース(設定が無ければローカルのファイル)と添付(設定が無ければローカルのフォルダ)は、そのままでも動きます。
