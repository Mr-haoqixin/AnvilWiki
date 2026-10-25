# Fork 定制台账 / Upstream Sync Ledger

本文件记录本 fork 相对上游 `PNGTRID/AnvilWiki` 的**框架层**改动与冲突处理规则。
内容层（`src/content/`）不在此列——按上游约定，Config/Content 冲突永远保留本站值。

## 1. 站点事实（合并时按此判断）

| 项 | 本站取值 |
| --- | --- |
| 上游 remote | `upstream` → `https://github.com/PNGTRID/AnvilWiki.git` |
| 当前同步基线 | `v2.38.0`（2026-10-22，已合入 CM `0bb4373`） |
| 默认语言 | `en`（根路径无前缀）；`zh` 及其余 8 个语言带前缀 |
| 语言列表 | `src/i18n/routing.ts`：en, zh, ja, es, fr, de, pt, nl, zh-hant, ru |
| Landing 层 | 已删除（`landingLinkEnabled = false`）；保留 `RootGateway.astro` 仅为 import 存活 |
| `wrangler.toml` | 已删除，平台 env 走 Cloudflare Dashboard |
| 广告 | `public/ads/*.html` 为完整 HTML 文档（noindex + data-pagefind-ignore），env 门控 |
| 域名 | `SITE_URL` env 优先，`src/config/site.ts` 为回退；统一走 `siteUrl`/`siteHost` |
| 封面 | `gen-covers` 输出 WebP；`postbuild-imgckr.mjs` 处理 imgckr 图片 |
| 法务页 | `LegalContent.astro` 为本站中文文案 |

## 2. 冲突处理规则

| 文件 | 规则 |
| --- | --- |
| `src/pages/index.astro` | 取上游（`landingLinkEnabled=false` 时走 HomePage，与本站一致） |
| `src/components/RootGateway.astro` | **永不删除**（`index.astro` 静态 import） |
| `src/config/project.ts` | 取上游后确认 `landingLinkEnabled = false` |
| `astro.config.ts` | 上游为底；保留 `siteUrl`、删除 handbook lastmod、保留 `/en` sitemap 过滤 |
| `public/_redirects` | 保留本站两行（`/en/ /`、`/en /`）；**禁止**引入上游 `/ → /zh/landing/` |
| landing 路由 / `demo.astro` | 保持删除（上游 modify/delete 冲突时用 `git rm`） |
| `wrangler.toml` | 保持删除 |
| `src/content/wiki/*/codes/all-codes.mdx` | 保持删除（本站无 codes 页） |
| `src/locales/{en,ja}.json` | 保留本站 `home.explore` 内容；上游新增 UI key 才取上游 |
| `LegalContent.astro` | 取上游逻辑/修复，贴回本站中文法务文案 |
| `SiteHeader.astro` | 保留本站紧凑语言切换布局；路径计算取上游 `homeUrl` 版本 |
| `tests/*` | 断言必须匹配本站「en 默认 + 10 语言 + 无 landing + 有广告」；不得为变绿删测试 |

## 3. 每次同步步骤

```powershell
git fetch upstream --tags --prune
git switch -c sync/vX.Y.Z
git merge --no-ff upstream/main
# 按上表解冲突；modify/delete 一律确认是「本站已删」还是「上游新增」
pnpm check-config
pnpm typecheck
pnpm lint
pnpm test
pnpm build
git commit
git switch wiki/20261012
git merge --ff-only sync/vX.Y.Z
```

## 4. 内容同步与已知遗留

内容层已按 weki.gg 的 en / zh-hans 页面补齐，并生成 8 个非 en/zh 语言的索引页。数据与生成脚本：

```powershell
# 1) 抓取事实字段（只存短字段，正文由本站改写）
node scripts/weki-scrape.mjs --only=quests
node scripts/weki-scrape.mjs --only=items --items

# 2) 生成/补全 en、zh 详情页和总览页
node scripts/weki-generate.mjs
node scripts/weki-generate.mjs --only=directories

# 3) 生成其余 8 个语言的本地化索引页
node scripts/weki-localized.mjs

pnpm check-content
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm check-links
```

- `pnpm check-links`：已修复百分号编码 CJK 链接的误报；当前 0 条断链。
- `pnpm check-content`：当前 1212 个 MDX 文件全部通过，0 条错误/警告。
- 非 en/zh 语言目前提供本地化标题、导语和表头的索引页；详情页回退到英文或中文内容。
- 部分任务步骤解析由于来源页面编号重复（如选择分支编号）导致步骤显示异常（出现重复或错乱的步骤号）。为直接解决此问题，对以下任务在正文中补充了来源页面的步骤说明图片：
  - `sorrowspore-experience`
  - `fairy-ring`
  - `forests-and-fairies`
  （图片取自对应来源页面的 og:image 或首图，内嵌于正文，帮助用户直观查看正确步骤。）
- `pnpm check-content`：当前 1212 个 MDX 文件全部通过，0 条错误/警告。
- 非 en/zh 语言目前提供本地化标题、导语和表头的索引页；详情页回退到英文或中文内容。
- 部分任务步骤解析由于来源页面编号重复（如选择分支编号）导致步骤显示异常（出现重复或错乱的步骤号）。为直接解决此问题，对以下任务在正文中补充了来源页面的步骤说明图片：
  - `sorrowspore-experience`
  - `fairy-ring`
  - `forests-and-fairies`
  （图片取自对应来源页面的 og:image 或首图，内嵌于正文，帮助用户直观查看正确步骤。）
