import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getMyEvents } from '../lib/storage';

/**
 * 首页 / 落地页。
 *
 * 以前 `/` 直接跳到 `/new`，第一次来的人一进门就是个表单，
 * 不知道这是干什么的、也不知道填完会发生什么。这里负责回答三个问题：
 * 这是什么、怎么用、凭什么不用 Doodle。
 *
 * 页面里的插图全部用 CSS 画，不用图片文件：
 *   ① 任何屏幕密度下都清晰，不用准备 @2x/@3x
 *   ② 跟主界面共用同一套设计语言（果冻格子、玻璃卡），不会像贴图
 *   ③ 首屏少几个请求 —— 这页是微信里点开的第一眼，快比好看重要
 */

/** 活动 ID 的字符集 —— 去掉了 0/O、1/l/I（见 src/server/ids.ts） */
const ID_CHARS = '23456789abcdefghjkmnpqrstuvwxyz';

/**
 * 从一段任意文本里抠出活动 ID。
 *
 * 不能假设输入是个干净的网址：从微信里复制过来的常常是整段消息
 * （「在吗？就这个 https://… 你点开看看」），甚至还带表情和换行。
 * 所以先在文本里找 `/e/xxx`，找不到再判断整段是不是一个裸 ID。
 */
function extractEventId(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  const inPath = s.match(new RegExp(`/e/([${ID_CHARS}]{4,})`, 'i'));
  if (inPath) return inPath[1].toLowerCase();

  const bare = s.replace(/\s+/g, '');
  if (new RegExp(`^[${ID_CHARS}]{4,}$`, 'i').test(bare)) return bare.toLowerCase();

  return null;
}

// ─────────────────────────────────────────────
// 三步说明的小插图
// ─────────────────────────────────────────────

/** ① 建活动 —— 缩小的建活动表单 */
function ArtCreate() {
  return (
    <div className="rounded-[var(--radius-btn)] border border-ink-200 bg-white p-3">
      <div className="text-[11px] text-ink-600">活动名称</div>
      <div className="mt-1 rounded-md bg-ink-100 px-3 py-2 text-[13px]">国庆出去玩</div>

      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <div>
          <div className="text-[11px] text-ink-600">从哪天开始</div>
          <div className="mt-1 rounded-md bg-ink-100 px-3 py-2 text-[13px] text-ink-600">10/1</div>
        </div>
        <div>
          <div className="text-[11px] text-ink-600">到哪天结束</div>
          <div className="mt-1 rounded-md bg-ink-100 px-3 py-2 text-[13px] text-ink-600">10/7</div>
        </div>
      </div>

      <div className="btn-solid mt-3 rounded-md py-2 text-center text-[13px] font-medium text-white">
        创建并开始填
      </div>
    </div>
  );
}

/** ② 大家涂时间 —— 缩小的果冻网格，跟真界面的格子是同一套样式 */
function ArtFill() {
  const painted = [2, 2, 1, 0, 2, 2, 0];
  return (
    <div className="rounded-[var(--radius-btn)] border border-ink-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium">国庆出去玩</span>
        <span className="text-[11px] text-ink-400">10/1–10/7</span>
      </div>

      <div className="mt-2.5 flex gap-1">
        {painted.map((lv, i) => (
          <div key={i} className="flex-1">
            <div className="pb-1 text-center text-[10px] leading-none text-ink-400">{i + 1}</div>
            <div
              className={[
                'cell-jelly aspect-square rounded-[5px] border',
                lv === 2 ? 'cell-lv2' : lv === 1 ? 'cell-lv1' : 'border-ink-200 bg-ink-100',
              ].join(' ')}
            />
          </div>
        ))}
      </div>

      <div className="mt-2.5 flex items-center justify-between text-[11px] text-ink-400">
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded-[3px] border border-brand-700 bg-brand-500" />可以
          <span className="ml-2 h-3 w-3 rounded-[3px] border border-warm-600 bg-warm-400" />勉强
        </span>
        <span>已涂 5 / 7 格</span>
      </div>
    </div>
  );
}

/** ③ 出方案 —— 缩小的方案卡，用玻璃那一套 */
function ArtPlan() {
  return (
    <div className="glass rounded-[var(--radius-btn)] p-3">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-semibold text-white">
          🏆 最合适
        </span>
        <span className="text-[11px] text-ink-400">4 人能到</span>
      </div>

      <div className="mt-2 text-[14px] font-medium">10/5–10/7 · 莫干山</div>
      <div className="mt-0.5 text-[11px] text-ink-400">需 2 天 · 全员都有空</div>

      <div className="mt-2.5 flex flex-wrap gap-1">
        {['小王', '小李', '小张', '小赵'].map((n) => (
          <span key={n} className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] text-brand-700">
            {n}
          </span>
        ))}
      </div>
    </div>
  );
}

const STEPS: Array<{ title: string; body: string; art: () => React.ReactElement }> = [
  {
    title: '建个活动，把链接发群里',
    body: '起个名字、选个日期范围，别的都默认就行。不用注册，也不用装 App。',
    art: ArtCreate,
  },
  {
    title: '大家点开涂一下空闲时间',
    body: '还能顺手选想去哪儿。手机上点几下就好，同样不用注册。',
    art: ArtFill,
  },
  {
    title: '系统算出能执行的方案',
    body: '不是列一堆「谁有空」，而是直接告诉你：哪天、去哪、谁能到。',
    art: ArtPlan,
  },
];

// ─────────────────────────────────────────────

export default function LandingPage() {
  const navigate = useNavigate();
  const [pasted, setPasted] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [copied, setCopied] = useState(false);

  const myEvents = getMyEvents();
  const latest = myEvents[0];

  // 发过活动的人，直接给他一段能原样粘贴的文案（带着真实链接）；
  // 没发过的给模板，让他知道发出去大概长什么样。
  const inviteLink = latest ? `${location.origin}/e/${latest.eventId}/fill` : location.origin;
  const inviteText = latest
    ? `${latest.title} —— 点开涂一下你哪几天有空 👇\n${inviteLink}`
    : `约个时间 —— 点开涂一下你哪几天有空 👇\n${inviteLink}`;

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setPasteError('复制失败，手动选中上面的文字复制吧');
    }
  }

  function goToEvent() {
    const id = extractEventId(pasted);
    if (!id) {
      setPasteError('没认出活动链接。把朋友发的那条消息整个粘进来试试，或者检查一下是不是少了几位。');
      return;
    }
    setPasteError('');
    navigate(`/e/${id}`);
  }

  return (
    <main className="mx-auto max-w-2xl space-y-10 p-5 pb-16">
      {/* ───────────────── 第一屏 ─────────────────
          两件事必须一眼看到：这是什么，以及我该点哪儿。
          受邀的人（大多数访客）是拿着链接来的，多半不会走首页 ——
          但链接万一失效或者他手动输了域名，这里是唯一的落脚点，
          所以「朋友发我链接了」这个入口放在第一屏，不埋到页尾。 */}
      <section className="rise-in space-y-5 pt-6">
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">何时何地</h1>
          <p className="text-lg text-ink-600">什么时候有空，想去哪里 —— 一起定</p>
          <p className="text-sm leading-relaxed text-ink-400">
            群里约活动，问到最后往往是「都行」，然后谁也没定。
            <br />
            这里把「谁有空」和「想去哪」放在一起算，直接给出能执行的方案。
          </p>
        </div>

        <Link
          to="/new"
          className="btn-solid glass-edge block rounded-[var(--radius-btn)] py-3.5 text-center text-base font-medium text-white"
        >
          发起一个活动
        </Link>

        <div className="rounded-[var(--radius-card)] border border-ink-200 bg-white/70 p-4">
          <label className="block text-sm text-ink-600">
            朋友发我链接了
            <div className="mt-2 flex gap-2">
              <input
                value={pasted}
                onChange={(e) => {
                  setPasted(e.target.value);
                  setPasteError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && goToEvent()}
                placeholder="把那条消息粘进来"
                aria-label="粘贴朋友发来的活动链接"
                className="min-w-0 flex-1 rounded-[var(--radius-btn)] border border-ink-200 px-3 py-2.5 text-base outline-none focus:border-brand-500"
              />
              <button
                type="button"
                onClick={goToEvent}
                className="shrink-0 rounded-[var(--radius-btn)] border border-brand-300 px-4 text-sm text-brand-700 transition hover:bg-brand-100"
              >
                打开
              </button>
            </div>
          </label>
          {pasteError && <p className="mt-2 text-xs text-red-700">{pasteError}</p>}
        </div>
      </section>

      {/* ───────────────── 三步 ───────────────── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">怎么用</h2>
        <ol className="space-y-4">
          {/* 图在上、字在下。
              之前是左右并排，图只有 112px 宽 —— 七个格子的网格挤成一片，
              「莫干山」和「小王」都被折成竖排。图的意义就是要看清楚，
              挤到看不清就不如不做。 */}
          {STEPS.map(({ title, body, art: Art }, i) => (
            <li key={title} className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-4">
              <Art />

              <div className="mt-3 flex items-baseline gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[11px] font-semibold text-white">
                  {i + 1}
                </span>
                <h3 className="text-sm font-medium">{title}</h3>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-600">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ───────────────── 凭什么不一样 ─────────────────
          这是整个产品唯一真正的卖点，所以值得用整屏讲清楚。
          用设计文档 §3.1 那四个人两目的地的反例：两张表各自都对，
          拼起来给出的却是个去不成的答案。 */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">为什么不能分开算</h2>
        <p className="text-sm leading-relaxed text-ink-600">
          时间统计和地点投票分开做，各自都没错，合起来却可能给出一个根本去不成的答案。
          因为「愿意为这个地方花几天」这根线，在拆成两张表的时候被剪断了。
        </p>

        <div className="space-y-3">
          {/* 反例：四个人，两个目的地。云南要 5 天，莫干山要 2 天。 */}
          <div className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-4">
            <div className="text-xs font-medium text-ink-400">分开算（常见的做法）</div>

            <div className="mt-3 space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-ink-400">时间表</span>
                <span className="text-ink-600">10/5–10/7 全员有空</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-ink-400">地点表</span>
                <span className="text-ink-600">云南 2 票 : 莫干山 2 票（平票）</span>
              </div>
            </div>

            <div className="mt-3 rounded-[var(--radius-btn)] bg-red-50 px-3 py-2.5">
              <p className="text-xs text-red-700">
                拼起来 →「那就 10/5–10/7 去云南」
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-red-700/80">
                但云南要 5 天，这三天去不了；而且只有 2 个人投过云南。
                两张表都没错，拼起来是错的。
              </p>
            </div>
          </div>

          {/* 交叉算：把目的地需要的天数和每个人的连续空闲一起算 */}
          <div className="glass rounded-[var(--radius-card)] p-4">
            <div className="text-xs font-medium text-brand-700">交叉算（这里）</div>

            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between rounded-[var(--radius-btn)] bg-white/70 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-xs font-medium">10/5–10/7 · 莫干山</div>
                  <div className="mt-0.5 text-[11px] text-ink-400">需 2 天</div>
                </div>
                <span className="shrink-0 rounded-full bg-brand-500 px-2 py-0.5 text-[11px] font-semibold text-white">
                  4 人全到
                </span>
              </div>
              <div className="flex items-center justify-between rounded-[var(--radius-btn)] bg-white/50 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-ink-600">10/1–10/5 · 云南</div>
                  <div className="mt-0.5 text-[11px] text-ink-400">需 5 天 · 小张没空</div>
                </div>
                <span className="shrink-0 text-[11px] text-ink-400">2 人</span>
              </div>
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-ink-600">
              系统从时间网格里自己推出「你最多能连着空几天」，再跟「去云南要 5 天」对上。
              <span className="text-ink-900"> 参与者为此一个字都不用多填。</span>
            </p>
          </div>
        </div>
      </section>

      {/* ───────────────── 真实界面 ─────────────────
          上面那段是道理，这里给证据。
          截图取自一个真跑过的示例活动（假名字假地名），不是画的示意图 ——
          画出来的图可以美化，真界面能看出这东西到底做完了没有。
          loading="lazy"：这图在页面靠下的位置，别让它拖慢首屏。 */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">算出来长这样</h2>
        <p className="text-sm leading-relaxed text-ink-600">
          上面那个例子在真实界面里的结果。四个人都到齐的莫干山排在最前面；
          云南留在下面 —— 它凑不齐全员，但「换个地方会怎样」得让人看见，
          不能悄悄抹掉。
        </p>
        <figure className="overflow-hidden rounded-[var(--radius-card)] border border-ink-200 bg-white">
          <img
            src="/shots/results.jpg"
            alt="结果页：10月5日–10月7日的莫干山方案 4 人全到，排在最前；下面是 10月1日–10月7日的云南方案，只有 1 人，小张没空、小王和小赵不想去"
            width={780}
            height={1160}
            loading="lazy"
            decoding="async"
            className="block w-full"
          />
        </figure>
      </section>

      {/* ───────────────── 分享文案 ─────────────────
          第一次用的人卡在「链接发出去该配什么话」。
          直接给一段能原样粘进群里的。 */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">发群里这样说</h2>
        <div className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-4">
          <pre className="whitespace-pre-wrap break-all font-sans text-xs leading-relaxed text-ink-600">
            {inviteText}
          </pre>
          <button
            type="button"
            onClick={copyInvite}
            className="mt-3 w-full rounded-[var(--radius-btn)] border border-brand-300 px-4 py-2 text-sm text-brand-700 transition hover:bg-brand-100"
          >
            {copied ? '已复制 ✓' : '复制这段话'}
          </button>
        </div>
        {!latest && (
          <p className="text-xs text-ink-400">
            建完活动之后，这里会自动换成带着你活动链接的文案。
          </p>
        )}
      </section>

      {/* ───────────────── 收尾 ───────────────── */}
      <section className="space-y-3 border-t border-ink-200 pt-8">
        <Link
          to="/new"
          className="btn-solid glass-edge block rounded-[var(--radius-btn)] py-3.5 text-center text-base font-medium text-white"
        >
          发起一个活动
        </Link>

        <p className="text-center text-xs text-ink-400">免费 · 不用注册 · 不收集手机号</p>

        {myEvents.length > 0 && (
          <p className="text-center text-xs">
            <Link to="/my" className="text-ink-400 transition hover:text-brand-600">
              我发起的 {myEvents.length} 个活动 →
            </Link>
          </p>
        )}
      </section>
    </main>
  );
}
