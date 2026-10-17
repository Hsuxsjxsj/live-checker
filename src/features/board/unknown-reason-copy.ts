const UNKNOWN_REASON_LABELS = {
  TIMEOUT: '检测超时',
  RATE_LIMITED: '请求过于频繁',
  ACCESS_DENIED: '平台访问受限',
  MALFORMED_RESPONSE: '平台响应异常',
  PLATFORM_ERROR: '平台服务异常',
  TRANSPORT_UNAVAILABLE: '检测通道不可用',
  RELAY_REQUIRED: '需要内置中转检测',
} as const

export function formatUnknownReason(reason: string) {
  if (Object.hasOwn(UNKNOWN_REASON_LABELS, reason)) {
    return UNKNOWN_REASON_LABELS[reason as keyof typeof UNKNOWN_REASON_LABELS]
  }
  return '状态暂不可确认'
}
