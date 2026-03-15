# 双仓库架构指南

> 本文件仅存在于**私有仓库**。`.privateignore` 已排除此文件，不会同步到公开仓库。

## 一、架构概览

```
私有仓库 (GitHub Private)                    公开仓库 (GitHub Public)
antigravity-history-vscode-dev               antigravity-history-vscode
├── src/                                     ├── src/
│   ├── extension.ts       ── auto sync ──→  │   ├── extension.ts
│   ├── formatter.ts       ── auto sync ──→  │   ├── formatter.ts
│   ├── cache.ts           ── auto sync ──→  │   ├── cache.ts
│   ├── panel-manager.ts   ── auto sync ──→  │   ├── panel-manager.ts
│   ├── webview/           ── auto sync ──→  │   ├── webview/
│   ├── discovery.ts       ── ✖️ 不同步 ──   │   (不存在)
│   ├── ls-client.ts       ── ✖️ 不同步 ──   │   (不存在)
│   ├── parser.ts          ── ✖️ 不同步 ──   │   (不存在)
│   └── recovery.ts        ── ✖️ 不同步 ──   │   (不存在)
├── .github/workflows/                       ├── (无 workflow)
│   ├── publish.yml         (构建+发布)      │
│   └── sync-public.yml     (同步公开仓库)   │
├── .privateignore          (排除列表)       │   (不存在)
├── DUAL_REPO_GUIDE.md      (本文件)         │   (不存在)
├── README.md              ── auto sync ──→  ├── README.md
├── package.json           ── auto sync ──→  ├── package.json
└── esbuild.js             ── auto sync ──→  └── esbuild.js
                                             └── ⭐⭐⭐ (3 stars 保留)
```

## 二、核心原理

### 2.1 为什么做双仓库？

| 需求 | 解决方案 |
|------|---------|
| 核心代码不公开（LS 发现、RPC 调用） | 核心文件只在私有仓库 |
| CI/CD 正常工作（需要完整代码编译） | CI/CD 在私有仓库执行 |
| 保留公开仓库的 Stars 和 URL | 公开仓库保持不变，只接收同步推送 |
| 新增文件时不要手动操作 | `.privateignore` 黑名单机制，新文件自动同步 |

### 2.2 同步机制

**方向**：私有仓库 → 公开仓库（单向，永远不要反向操作）

**触发条件**：每次 push 到私有仓库的 `master` 分支

**过滤原理**：
- 使用 `rsync --exclude-from=.privateignore` 排除敏感文件
- `.privateignore` 使用 rsync 的 exclude 语法（与 .gitignore 类似）
- **黑名单模式**：只列出不同步的文件，其余全部同步

### 2.3 发布机制

**触发条件**：在私有仓库打 `v*` 格式的 tag

**流程**：
1. `npm install` → 安装依赖
2. `npm run build` → esbuild 打包 + javascript-obfuscator 混淆
3. `npx vsce package` → 打 `.vsix`
4. `npx ovsx publish` → 发布到 OpenVSX

### 2.4 代码保护层级

| 层级 | 保护措施 | 保护内容 |
|------|---------|---------|
| 1. Git 历史清理 | `git filter-repo` 已从所有历史 commit 中删除核心文件 | 公开仓库的 git 历史 |
| 2. .privateignore | 同步时排除敏感文件 | 公开仓库的当前文件 |
| 3. esbuild minify | 变量名压缩、console/debugger 移除 | .vsix 中的 extension.js |
| 4. JS Obfuscator | 控制流扁平化 + RC4 字符串加密 + 死代码注入 | .vsix 中的 extension.js |

## 三、初始配置流程

### 3.1 前提条件

- [x] 公开仓库已执行 `git filter-repo` 清理历史
- [x] `.privateignore` 已创建
- [x] `sync-public.yml` 和 `publish.yml` 已编写
- [x] `esbuild.js` 已添加混淆步骤
- [ ] 在 GitHub 上创建私有仓库
- [ ] 配置 GitHub Secrets

### 3.2 创建私有仓库

1. 登录 GitHub
2. 点击 **New Repository**
3. 配置：
   - **名称**: `antigravity-history-vscode-dev`
   - **可见性**: **Private** ✅
   - **不要**勾选 Initialize with README
   - **不要**添加 .gitignore 或 License
4. 点击 **Create repository**

### 3.3 推送完整代码到私有仓库

```bash
cd d:\MATRIX\Neo\XLab\XAnti\antigravity-history-vscode

# 添加私有仓库为新 remote
git remote add private https://github.com/neo1027144-creator/antigravity-history-vscode-dev.git

# 确保核心文件不被 .gitignore 排除（私有仓库要追踪它们）
# 方法：创建私有仓库专用的 .gitignore，不排除核心文件

# 推送到私有仓库
git push private master
```

> ⚠️ **注意**：私有仓库的 `.gitignore` 不应排除核心文件。
> 推送前需要临时修改 `.gitignore`，或使用 `git add -f` 强制添加核心文件。
> 详见下方"双 .gitignore 管理"章节。

### 3.4 创建 Fine-grained PAT

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens**
2. 点击 **Generate new token**
3. 配置：
   - **Token name**: `public-repo-sync`
   - **Expiration**: 建议 1 年或更长
   - **Repository access**: 只选 `antigravity-history-vscode`（公开仓库）
   - **Repository permissions**:
     - `Contents`: **Read and write**
     - 其他全部保持 No access
4. 点击 **Generate token**
5. **立即复制** token（只显示一次）

### 3.5 配置 GitHub Secrets

进入**私有仓库** Settings → Secrets and variables → Actions → **New repository secret**：

| Secret 名称 | 值 | 用途 |
|-------------|---|------|
| `PUBLIC_REPO_TOKEN` | 上面创建的 PAT | sync-public.yml 推送到公开仓库 |
| `OVSX_TOKEN` | OpenVSX 的 access token | publish.yml 发布插件 |

### 3.6 验证

1. 在私有仓库做一个小改动（比如 README 加个空行）
2. Push 到 master
3. 检查 GitHub Actions → `Sync to Public Repo` 是否成功
4. 检查公开仓库是否收到更新
5. 确认公开仓库中**没有** discovery.ts 等核心文件

## 四、日常工作流

### 4.1 日常开发

```
1. 在本地编辑代码（所有文件，包括核心文件）
2. git add + git commit
3. git push private master
   └→ GitHub Actions 自动将非敏感文件同步到公开仓库
```

**你只和私有仓库交互，永远不要手动推送到公开仓库。**

### 4.2 发布新版本

```
1. 更新 package.json 中的 version
2. git commit -m "release: vX.Y.Z"
3. git tag vX.Y.Z
4. git push private master --tags
   ├→ sync-public.yml: 同步到公开仓库
   └→ publish.yml: 构建 + 混淆 + 发布到 OpenVSX
```

### 4.3 新增公开文件

直接创建文件，提交推送。**不需要修改任何配置**。

### 4.4 新增敏感文件

1. 创建文件
2. 在 `.privateignore` 中添加一行
3. 提交推送

### 4.5 处理 Issues

Issues 仍然在**公开仓库**管理（用户会在公开仓库提 Issue）。

## 五、双 .gitignore 管理

这是整个架构中**唯一需要注意的复杂点**。

### 问题

公开仓库的 `.gitignore` 排除了核心文件（防止意外提交），但私有仓库的 `.gitignore` **不应该**排除它们（需要追踪）。

### 解决方案

由于 sync workflow 会把公开仓库的 `.gitignore`（带排除规则的）推过去，**不需要**两个不同的 `.gitignore`。关键是：

1. **私有仓库**：用 `git add -f` 强制添加核心文件（即使 .gitignore 排除了它们）
2. 之后 git 会继续追踪已经添加的文件（.gitignore 只影响未追踪的新文件）

```bash
# 首次设置：在私有仓库中强制添加核心文件
git add -f src/discovery.ts src/ls-client.ts src/parser.ts src/recovery.ts
git commit -m "chore: add core modules to private repo"
git push private master
```

之后修改这些文件，`git add -p` 或 `git add src/discovery.ts` 就能正常工作。

### 验证

```bash
# 检查哪些文件被 git 追踪
git ls-files src/
# 应该看到所有 .ts 文件，包括核心文件
```

## 六、常见问题与故障排除

### Q1: sync workflow 失败，报 "Permission denied"

**原因**：`PUBLIC_REPO_TOKEN` 过期或权限不足

**解决**：
1. 去 GitHub Settings → Personal access tokens
2. 检查 token 是否有效
3. 确认 token 对公开仓库有 `Contents: Read and write` 权限
4. 更新私有仓库的 Secret

### Q2: 公开仓库出现了不该有的文件

**原因**：`.privateignore` 中忘记添加该文件

**解决**：
1. 在 `.privateignore` 中添加该文件路径
2. 提交推送
3. 下次 sync 会自动排除

**注意**：已经推送到公开仓库的文件不会被自动删除。需要手动在公开仓库删除：
```bash
git clone https://github.com/.../antigravity-history-vscode.git /tmp/public
cd /tmp/public
git rm 敏感文件.ts
git commit -m "fix: remove accidentally synced file"
git push
```

### Q3: publish workflow 失败，"OVSX_TOKEN invalid"

**原因**：OpenVSX token 过期

**解决**：
1. 去 https://open-vsx.org/user-settings/tokens
2. 生成新 token
3. 更新私有仓库的 `OVSX_TOKEN` Secret

### Q4: 本地 git push 到了公开仓库

**这是严重错误！** 如果你不小心把核心文件推到公开仓库：

1. **立即**在公开仓库执行 `git filter-repo` 清理历史
2. `git push --force` 覆盖远程

**预防措施**：确保本地 `origin` remote 指向私有仓库：
```bash
# 确认 remote 配置
git remote -v
# origin 应该指向 antigravity-history-vscode-DEV (私有)
# 不应该指向 antigravity-history-vscode (公开)
```

### Q5: 我能在公开仓库接受 PR 吗？

可以，但需要手动操作：
1. 在公开仓库 Review + Merge PR
2. 将公开仓库的改动手动 cherry-pick 到私有仓库
3. 推送到私有仓库（会触发下次 sync 覆盖掉公开仓库的其他变化）

**建议**：让贡献者提 Issue 而不是 PR，由你在私有仓库实现。

### Q6: rsync 不可用怎么办？

GitHub Actions 的 `ubuntu-latest` 默认自带 rsync，一般不会出问题。如果遇到，可以换成纯 shell 实现：

```bash
# 替代方案：cp + 手动排除
cp -r . /tmp/public
rm -rf /tmp/public/.git
rm -rf /tmp/public/.github
while IFS= read -r pattern; do
  [[ "$pattern" == \#* ]] || [[ -z "$pattern" ]] && continue
  rm -rf "/tmp/public/$pattern"
done < .privateignore
```

## 七、安全清单

定期（每季度）检查以下项目：

- [ ] `PUBLIC_REPO_TOKEN` 是否过期？
- [ ] `OVSX_TOKEN` 是否过期？
- [ ] 公开仓库是否出现了不该有的文件？（检查 src/ 目录）
- [ ] 公开仓库的 git 历史中是否有核心文件的痕迹？（`git log --all -- src/discovery.ts`）
- [ ] `.privateignore` 是否包含所有敏感文件？
- [ ] 本地的 `origin` remote 是否指向私有仓库？

## 八、文件清单

| 文件 | 仓库 | 作用 |
|------|------|------|
| `.privateignore` | 私有 only | 列出不同步到公开仓库的文件 |
| `.gitignore` | 两个仓库都有 | 排除 node_modules/dist 等构建产物 |
| `.github/workflows/sync-public.yml` | 私有 only | 自动同步到公开仓库 |
| `.github/workflows/publish.yml` | 私有 only | 构建+混淆+发布到 OpenVSX |
| `DUAL_REPO_GUIDE.md` | 私有 only | 本文件 |
| `esbuild.js` | 两个仓库都有 | 包含混淆配置 |
