#!/bin/sh
set -eu

MODEL_ID="deepseek/deepseek-v4-flash"

if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
  echo "错误：未配置 DEEPSEEK_API_KEY，OpenCode 无法使用 DeepSeek V4 Flash。" >&2
  exit 1
fi

if ! opencode models deepseek 2>/dev/null | grep -Fxq "$MODEL_ID"; then
  echo "错误：OpenCode 模型目录中未找到 $MODEL_ID，请检查网络和 DeepSeek 提供商配置。" >&2
  exit 1
fi

echo "OpenCode 默认模型：DeepSeek V4 Flash ($MODEL_ID)"
exec "$@"
