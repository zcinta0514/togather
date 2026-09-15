/**
 * 设备能力探测 —— 决定要不要降级视觉效果。
 *
 * 玻璃的 backdrop-filter 是手机 GPU 上最贵的操作之一，再叠加动效，
 * 中低端安卓会明显掉帧。用户想要的是「丝滑」，不是「看起来很贵但卡」。
 *
 * 策略：好机器看完整效果，差机器看简化版。两个都不难看，都不卡。
 */

interface NavigatorWithHints extends Navigator {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
}

export interface DeviceProfile {
  /** 关掉实时模糊，改用不透明近似色 */
  lite: boolean;
  /** 关掉装饰性动效（系统级「减少动态效果」也会触发） */
  reducedMotion: boolean;
  /** 降级的原因，仅用于调试和说明 */
  reason: string;
}

export function detectDevice(): DeviceProfile {
  if (typeof window === 'undefined') {
    return { lite: true, reducedMotion: true, reason: '服务端渲染' };
  }

  const nav = navigator as NavigatorWithHints;

  // 系统明确要求减少动态效果 —— 这是无障碍要求，必须尊重，不是可选项
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return { lite: false, reducedMotion: true, reason: '系统开启了减少动态效果' };
  }

  // 用户开了省流量模式，多半也在意性能
  if (nav.connection?.saveData) {
    return { lite: true, reducedMotion: true, reason: '省流量模式' };
  }

  // 网络很差时也别上重特效
  const ect = nav.connection?.effectiveType;
  if (ect === 'slow-2g' || ect === '2g') {
    return { lite: true, reducedMotion: true, reason: '网络很慢' };
  }

  const cores = nav.hardwareConcurrency ?? 4;
  const mem = nav.deviceMemory;

  // deviceMemory 只有 Chromium 系支持，拿不到就不作为判据 ——
  // 宁可给完整效果，也不要因为探测不到就把所有人都降级
  if (cores <= 4 && mem !== undefined && mem <= 4) {
    return { lite: true, reducedMotion: false, reason: `低配设备（${cores} 核 / ${mem}GB）` };
  }
  if (cores <= 2) {
    return { lite: true, reducedMotion: true, reason: `核心很少（${cores} 核）` };
  }

  return { lite: false, reducedMotion: false, reason: '设备可以跑完整效果' };
}

/** 把探测结果写到 <html> 的 class 上，CSS 据此降级 */
export function applyDeviceProfile(profile: DeviceProfile) {
  const root = document.documentElement;
  root.classList.toggle('lite', profile.lite);
  root.classList.toggle('reduced-motion', profile.reducedMotion);
  root.dataset.perfReason = profile.reason;
}
