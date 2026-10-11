const fs = require('fs');
const path = require('path');

const ZH_DIR = 'src/content/wiki/zh';
const DISCLAIMER = `
## 内容声明

你看到的内容可能由第三方 AI 基于[新的小菜](https://xindeca.blog/)文章提炼总结而成，可能与原文真实意图存在偏差。不代表新的小菜观点和立场。请点击[本站中文首页](/zh/)或原文链接阅读原文细致比对和校验。
`.trim();

let count = 0;
const files = [];

function walk(dir) {
  for (const e of fs.readdirSync(dir)) {
    const f = path.join(dir, e);
    if (fs.statSync(f).isDirectory()) walk(f);
    else if (f.endsWith('.mdx')) files.push(f);
  }
}
walk(ZH_DIR);

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  
  // Skip if already has disclaimer
  if (content.includes('## 内容声明')) {
    continue;
  }
  
  // Append disclaimer at the end
  content = content.trimEnd() + '\n\n' + DISCLAIMER + '\n';
  fs.writeFileSync(file, content, 'utf8');
  count++;
}

console.log(`Added disclaimer to ${count} files (skipped ${files.length - count} already had it).`);
