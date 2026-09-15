/**
 * 一个极小的 CDP 客户端 —— 只做三件事：开页面、截图、跑一段 JS。
 *
 * 为什么不直接用现成的：
 *   - 常驻的浏览器实例会占住 profile，换个会话就连不上，还得去杀进程。
 *   - puppeteer 要多装几十兆依赖，而这里真正需要的只有三个 CDP 命令。
 *
 * 每次调用自己起一个无头浏览器、结束前杀干净，不依赖任何常驻状态。
 *
 * 【为什么值得单独抽一个文件】
 * 上一轮验证时间网格时，检测脚本是临时写在别处的，改完就丢了 ——
 * 结果「重叠从 16 处降到 0」这个结论没有任何人能复现。
 * 验证工具必须跟代码一起进仓库，否则下次改动没有东西能挡住回归。
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

function findBrowser() {
  for (const c of CANDIDATES) if (c && existsSync(c)) return c;
  throw new Error('找不到 Edge 或 Chrome，可用 BROWSER_PATH 环境变量指定');
}

/**
 * 起一个无头浏览器并连上它的第一个页面。
 * 返回的对象里，send() 发 CDP 命令，close() 负责把整棵进程树杀掉。
 */
export async function launch({ width = 390, height = 844, scale = 2 } = {}) {
  const exe = findBrowser();
  const profile = mkdtempSync(path.join(tmpdir(), 'hh-shot-'));
  const port = 9000 + Math.floor(Math.random() * 900);

  const proc = spawn(
    exe,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  // 等调试端口起来。刚启动时 /json/version 会连不上，所以轮询。
  const base = `http://127.0.0.1:${port}`;
  let target = null;
  for (let i = 0; i < 100; i++) {
    try {
      const list = await fetch(`${base}/json/list`).then((r) => r.json());
      target = list.find((t) => t.type === 'page');
      if (target?.webSocketDebuggerUrl) break;
    } catch {
      /* 还没起来，继续等 */
    }
    await sleep(100);
  }
  if (!target?.webSocketDebuggerUrl) {
    proc.kill();
    throw new Error('浏览器起来了但没暴露调试端口');
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  let seq = 0;
  const pending = new Map();

  // 页面控制台里说过的话。React 的「兄弟节点 key 重复」「受控组件没给 onChange」
  // 这类问题只在控制台里出现，界面看上去一切正常 —— 不看这里就等于没测。
  const consoleLog = [];

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args ?? [])
        .map((a) => a.value ?? a.description ?? a.type)
        .join(' ');
      consoleLog.push({ type: msg.params.type, text });
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleLog.push({
        type: 'exception',
        text: msg.params.exceptionDetails?.exception?.description ?? '未知异常',
      });
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.rej(new Error(`${msg.error.message} (${p.method})`)) : p.res(msg.result);
  });

  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq;
      pending.set(id, { res, rej, method });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Page.enable');
  await send('Runtime.enable');
  // 设备像素比设成 2 —— 按 1 倍截出来的中文是糊的，看不出字号和间距的问题
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: scale,
    mobile: true,
  });

  return {
    send,

    /** 打开一个地址并等它稳定下来（React 渲染完 + 图片就位） */
    async goto(url) {
      await send('Page.navigate', { url });
      await sleep(400);
      // 等 document.readyState 变成 complete，最多等 10 秒
      for (let i = 0; i < 50; i++) {
        const { result } = await send('Runtime.evaluate', {
          expression: 'document.readyState',
          returnByValue: true,
        });
        if (result.value === 'complete') break;
        await sleep(200);
      }
      // SPA 的首屏渲染是 readyState 之后才发生的，再给一拍的余量
      await sleep(700);
    },

    /** 在页面里跑一段表达式，返回值传回来 */
    async eval(expression) {
      const { result, exceptionDetails } = await send('Runtime.evaluate', {
        expression: `(() => { ${expression} })()`,
        returnByValue: true,
        awaitPromise: true,
      });
      if (exceptionDetails) {
        throw new Error(exceptionDetails.exception?.description ?? '页面里报错了');
      }
      return result.value;
    },

    /** 滚到某个位置并截图，返回图片的 base64 */
    async shotAt(y, format = 'png', quality = 88) {
      await this.eval(`window.scrollTo(0, ${y}); return 1;`);
      await sleep(350); // 等滚动结束和入场动画播完
      const { data } = await send('Page.captureScreenshot', {
        format,
        ...(format === 'jpeg' ? { quality } : {}),
      });
      return data;
    },

    /** 整个页面有多高 */
    async pageHeight() {
      return this.eval(
        `return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);`,
      );
    },

    /** 页面控制台到目前为止说过的话 */
    consoleMessages() {
      return consoleLog;
    },

    /** 用真实的鼠标事件点一个坐标 —— 走完整的事件链，不是合成 click */
    async clickAt(x, y) {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', {
          type,
          x,
          y,
          button: 'left',
          clickCount: 1,
        });
      }
      await sleep(120);
    },

    async close() {
      try {
        ws.close();
      } catch {
        /* 已经断了就算了 */
      }
      // Windows 上浏览器是个进程树，只杀父进程会留下孤儿子进程占着 profile。
      // 这个坑之前踩过（后台 dev server 也一样的毛病）。
      if (process.platform === 'win32') {
        spawn('taskkill', ['/T', '/F', '/PID', String(proc.pid)], { stdio: 'ignore' });
      } else {
        proc.kill('SIGKILL');
      }
      await sleep(400);
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        /* 删不掉就留给系统清理临时目录 */
      }
    },
  };
}
