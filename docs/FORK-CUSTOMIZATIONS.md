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

## 4. 已知遗留（非合并引入）

- `pnpm check-content`：26 个 zh 页面正文链接缺 `zh/` 前缀。
- `pnpm check-links`：628 条跨语言正文链接未带当前语言前缀（主要在 de/es/fr/nl/pt/ru 机器翻译页）。
- 修复方向：按源页面 locale 批量补前缀；目标页在该语言不存在时改链到英文并标注语言。

## 5. 备份

- 合并前 tag：`backup/pre-upstream-v2.38`
- 合并分支：`sync/v2.38.0`（保留，便于回溯）
