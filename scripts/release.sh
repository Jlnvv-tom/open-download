#!/usr/bin/env bash
# 本地发布脚本：测试 → 打包 → 打 tag 推送（触发 Release 工作流）→ 推送 master（触发文档部署）
# 用法：npm run release

set -euo pipefail

cd "$(dirname "$0")/.."

# 1. 工作区必须干净，避免把未提交内容打进发布
if [ -n "$(git status --porcelain)" ]; then
  echo "✖ 工作区有未提交的变更，请先提交后再发布。"
  git status --short
  exit 1
fi

# 2. 读取版本号
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"

# 3. 本地测试 + 打包
echo "▶ 运行测试..."
npm test

echo "▶ 构建 $TAG 安装包..."
npm run pack

# 4. tag 已存在则终止
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "✖ 标签 $TAG 已存在。如需重新发布，请先更新 package.json / src/manifest.json 的版本号。"
  exit 1
fi

# 5. 打 tag 并推送：tag 触发 Release 工作流，master 推送触发文档部署
echo "▶ 创建并推送标签 $TAG..."
git tag "$TAG"
git push origin "$TAG"

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" = "master" ]; then
  echo "▶ 推送 master（自动部署 docs 落地页）..."
  git push origin master
else
  echo "ℹ 当前分支为 $CURRENT_BRANCH，跳过 master 推送；文档部署仅在 master 更新时触发。"
fi

echo "✅ 发布完成：$TAG"
echo "   - Release 工作流：https://github.com/$(git remote get-url origin | sed -E 's#.*github.com[:/]##; s#\.git$##')/actions"
echo "   - 安装包：packages/open-download-$VERSION.zip"
