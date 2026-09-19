/**
 * 端到端冒烟测试：走完整 HTTP 链路验证设计文档 §3.1 那个反例。
 *
 * 用法：
 *   1. 另开一个终端跑 `npm run dev`
 *   2. npm run smoke
 *
 *   跑线上：BASE=https://heshihedi.pages.dev npm run smoke
 *
 * 为什么用 Node 而不是 bash：
 *   Git Bash 在 Windows 上传中文参数会变乱码，四个不同的中文名会变成同一串乱码，
 *   把重名检查误触发成「全部重复」。Node 天生 UTF-8，不受 shell 编码影响。
 *
 * ⚠️ 刚部署完别立刻跑线上测试：
 *   Pages 部署要几十秒才铺到所有边缘节点。部署完马上跑，可能读到旧版本的
 *   静态资源，出现「明明改好了却断言失败」的假警报。等一分钟再跑。
 */

const BASE = process.env.BASE ?? 'http://localhost:5173';

// 用算的，不写死数字 —— 手写时间戳很容易差 8 小时，
// 而那种错在断言里看不出来（槽位序号照样对），只在界面上显示成 9月30日 才暴露。
const RANGE_START = Math.floor(Date.UTC(2025, 9, 1) / 1000) - 8 * 3600; // 10/1 00:00 北京时间
const RANGE_END = RANGE_START + 7 * 86400 - 1; // 10/7 23:59:59 北京时间

let passed = 0;
let failed = 0;

function ok(msg) {
  console.log(`  ✓ ${msg}`);
  passed++;
}
function bad(msg) {
  console.log(`  ✗ ${msg}`);
  failed++;
}
function assert(cond, msg) {
  cond ? ok(msg) : bad(msg);
}
function head(n, title) {
  console.log(`\n════════ ${n}. ${title} ════════`);
}

async function call(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

// ─────────────────────────────────────────────

head(1, '建活动');

const created = await call('POST', '/api/events', {
  title: '国庆出去玩',
  rangeStart: RANGE_START,
  rangeEnd: RANGE_END,
  granularity: 'day',
  collectDestinations: true,
  budgetEnabled: false,
  coreOnly: false,
  anonymity: 'open',
});
if (created.status !== 200) {
  bad(`建活动失败：${JSON.stringify(created.data)}`);
  process.exit(1);
}
const EID = created.data.eventId;
const ADMIN_KEY = created.data.adminKey;
ok(`活动 ${EID} 已创建，管理密钥已返回`);

head(2, '四个人加入');

const tokens = {};
for (const name of ['小王', '小李', '小张', '小赵']) {
  const r = await call('POST', `/api/events/${EID}/join`, { name });
  if (r.status !== 200) {
    bad(`${name} 加入失败：${JSON.stringify(r.data)}`);
    process.exit(1);
  }
  if (r.data.name !== name) {
    bad(`${name} 的名字被改写成了「${r.data.name}」—— 编码问题`);
    process.exit(1);
  }
  tokens[name] = r.data.token;
}
ok('四个中文名字都原样保存，没有被改写');

head(3, '重名被拦');

const dup = await call('POST', `/api/events/${EID}/join`, { name: '小王' });
assert(dup.status === 409, `重复的名字返回 409（实际 ${dup.status}）`);

head(4, '提名两个目的地');

const yn = await call('POST', `/api/events/${EID}/destinations`, {
  token: tokens['小王'],
  name: '云南',
  daysNeeded: 5,
});
const mgs = await call('POST', `/api/events/${EID}/destinations`, {
  token: tokens['小张'],
  name: '莫干山',
  daysNeeded: 2,
});
assert(yn.status === 200 && mgs.status === 200, `云南（5天）和莫干山（2天）已提名`);

head(5, '同名目的地被合并');

const merged = await call('POST', `/api/events/${EID}/destinations`, {
  token: tokens['小李'],
  name: '云南',
  daysNeeded: 5,
});
assert(merged.data.merged === true, '「云南」被合并，没产生重复选项');
assert(merged.data.destinationId === yn.data.destinationId, '合并到的是同一个 ID');

head(6, '提交时间和投票');

const avail = (s) => s.split('').map(Number);
const submit = (name, availStr, ynVote, mgsVote) =>
  call('POST', `/api/events/${EID}/submit`, {
    token: tokens[name],
    name,
    availability: avail(availStr),
    votes: [
      { destinationId: yn.data.destinationId, level: ynVote },
      { destinationId: mgs.data.destinationId, level: mgsVote },
    ],
  });

await submit('小王', '2222222', 2, 1);
await submit('小李', '2222222', 2, 1);
await submit('小张', '0000222', 0, 2);
await submit('小赵', '2222222', 0, 2);
ok('四个人都提交了：小王/小李全周有空，小张只有后三天');

head(7, '投票是覆盖式写入，不是累加');

// 小王把云南从「想去」改成「不想去」
await submit('小王', '2222222', 0, 2);
const after = await call('GET', `/api/events/${EID}`);
const totalVotes = after.data.votes.length;
assert(totalVotes === 8, `投票总数仍是 8 条（4 人 x 2 目的地），实际 ${totalVotes}`);

head(8, '拉结果');

const res = await call('GET', `/api/events/${EID}/results`);
const d = res.data;
assert(d.respondedCount === 4 && d.totalCount === 4, `已填 ${d.respondedCount}/${d.totalCount} 人`);
assert(d.slotCount === 7, `槽位数 ${d.slotCount}`);
const resultPage = await call('GET', `/api/events/${EID}/results?view=page`);
assert(
  resultPage.status === 200 &&
    resultPage.data.detail?.event?.id === EID &&
    resultPage.data.results?.respondedCount === 4,
  '结果页聚合接口一次返回活动详情和计算结果',
);
assert(
  Array.isArray(resultPage.data.detail?.votes) === false,
  '结果页聚合接口不返回不需要的投票明细',
);

console.log('');
for (const [i, p] of d.plans.entries()) {
  const mark = i === 0 ? '🏆 ' : '   ';
  const who = p.missing
    .map((m) => `${m.name}（${m.reason === 'busy' ? '没空' : '不想去'}）`)
    .join('　');
  console.log(
    `  ${mark}${p.destinationName}（需 ${p.daysNeeded} 天）槽位 ${p.startSlot}–${p.endSlot} → ${p.attendeeIds.length} 人`,
  );
  if (who) console.log(`      差：${who}`);
}
for (const u of d.unreachable) console.log(`  去不了：${u.name} —— ${u.reason}`);
console.log('');

head(9, '校验冠军方案');

const top = d.plans[0];
assert(top?.destinationName === '莫干山', `冠军是莫干山（实际 ${top?.destinationName}）`);
assert(top?.attendeeIds.length === 4, `4 人能到（实际 ${top?.attendeeIds.length}）`);
assert(
  top?.startSlot === 4 && top?.endSlot === 6,
  `时间是槽位 4–6 即 10/5–10/7（实际 ${top?.startSlot}–${top?.endSlot}）`,
);
assert(d.plans.length === 2, `共 2 个方案（被支配的已砍掉，实际 ${d.plans.length}）`);

// 注意：第 7 步小王把云南改成了「不想去」，所以这里只剩小李 1 人。
// 这正好顺带验证了「改了主意，结果会跟着变」。
const yunnan = d.plans.find((p) => p.destinationName === '云南');
assert(yunnan !== undefined, '云南方案仍然保留 —— 它是取舍的体现');
assert(yunnan?.attendeeIds.length === 1, `云南 1 人能去（实际 ${yunnan?.attendeeIds.length}）`);
assert(
  yunnan?.missing.some((m) => m.name === '小王' && m.reason === 'unwilling'),
  '小王的改票生效了，在 missing 里显示为「不想去」',
);
assert(
  yunnan?.missing.some((m) => m.name === '小张' && m.reason === 'busy'),
  '小张在云南方案里显示为「没空」（时间原因优先于意愿原因）',
);

head(10, '定案需要管理密钥');

const noKey = await call('POST', `/api/events/${EID}/finalize`, {
  adminKey: 'wrong-key',
  destinationId: yn.data.destinationId,
  startSlot: 0,
});
assert(noKey.status === 403, `错误的密钥被拒（实际 ${noKey.status}）`);

head(11, '定案 —— 参加人是服务端重算的，不是拿全部参与者充数');

// 定云南（只有小李能去）。如果实现偷懒拿了全部参与者，
// attendeeNames 会变成 4 个人 —— 这条就是为了盯住那个偷懒。
const fin = await call('POST', `/api/events/${EID}/finalize`, {
  adminKey: ADMIN_KEY,
  destinationId: yn.data.destinationId,
  startSlot: 0,
});
assert(fin.status === 200, `定案成功（实际 ${fin.status}）`);
assert(
  fin.data.plan?.attendeeNames?.length === 1 && fin.data.plan.attendeeNames[0] === '小李',
  `定案快照里的参加人只有小李（实际 ${JSON.stringify(fin.data.plan?.attendeeNames)}）`,
);
assert(
  fin.data.plan?.destinationName === '云南',
  `快照里冗余存了目的地名（实际 ${fin.data.plan?.destinationName}）`,
);
// 云南要 5 天，但窗口是 10/1–10/7 七天（合并过的）。
// 两个数都必须记下来 —— 只记窗口会把 5 天的行程显示成 7 天，
// 只记行程长度又丢掉了「这几天任选」的信息。
assert(
  fin.data.plan?.daysNeeded === 5,
  `行程长度单独记了（实际 ${fin.data.plan?.daysNeeded}）`,
);
assert(
  fin.data.plan.endSlot - fin.data.plan.startSlot + 1 === 7,
  `窗口没有被截成行程长度（实际 ${fin.data.plan.endSlot - fin.data.plan.startSlot + 1} 天）`,
);

const afterFin = await call('GET', `/api/events/${EID}`);
assert(afterFin.data.event.finalizedPlan !== null, '活动行里存下了定案');
assert(
  !JSON.stringify(afterFin.data).includes(ADMIN_KEY),
  '定案响应里没有管理密钥明文',
);

head(12, '撤销定案');

const unfin = await call('POST', `/api/events/${EID}/unfinalize`, { adminKey: ADMIN_KEY });
assert(unfin.status === 200, `撤销成功（实际 ${unfin.status}）`);
const afterUnfin = await call('GET', `/api/events/${EID}`);
assert(afterUnfin.data.event.finalizedPlan === null, '撤销后回到未定案');

head(13, '核心成员 —— 标记后相关方案会沉底');

const allP = afterUnfin.data.participants;
const zhang = allP.find((p) => p.name === '小张');
assert(zhang !== undefined, '找得到小张');

const noKeyCore = await call('PATCH', `/api/events/${EID}/participants/${zhang.id}`, {
  adminKey: 'wrong-key',
  isCore: true,
});
assert(noKeyCore.status === 403, `标记核心成员也需要管理密钥（实际 ${noKeyCore.status}）`);

const setCore = await call('PATCH', `/api/events/${EID}/participants/${zhang.id}`, {
  adminKey: ADMIN_KEY,
  isCore: true,
});
assert(setCore.status === 200 && setCore.data.isCore === true, '小张被标为核心成员');

const withCore = await call('GET', `/api/events/${EID}/results`);
const yunnanPlan = withCore.data.plans.find((p) => p.destinationName === '云南');
const mdsPlan = withCore.data.plans.find((p) => p.destinationName === '莫干山');
assert(
  yunnanPlan?.blocked === true,
  '云南方案里没有小张 → 标为核心后变成 blocked',
);
assert(
  mdsPlan?.blocked === false,
  '莫干山方案里有小张 → 不受影响',
);
assert(
  withCore.data.plans[0]?.destinationName === '莫干山',
  '冠军仍然是莫干山（4 人，核心也到齐）',
);

// 取消标记，回到干净状态
await call('PATCH', `/api/events/${EID}/participants/${zhang.id}`, {
  adminKey: ADMIN_KEY,
  isCore: false,
});

head(14, '删除活动');

// 用一个一次性的活动测删除，别动主测试对象
const throwaway = await call('POST', '/api/events', {
  title: '一次性活动',
  rangeStart: RANGE_START,
  rangeEnd: RANGE_END,
  granularity: 'day',
  collectDestinations: false,
  budgetEnabled: false,
  anonymity: 'open',
});
const delBad = await call('POST', `/api/events/${throwaway.data.eventId}/delete`, {
  adminKey: 'wrong-key',
});
assert(delBad.status === 403, `删除需要管理密钥（实际 ${delBad.status}）`);

const del = await call('POST', `/api/events/${throwaway.data.eventId}/delete`, {
  adminKey: throwaway.data.adminKey,
});
assert(del.status === 200, `删除成功（实际 ${del.status}）`);
const gone = await call('GET', `/api/events/${throwaway.data.eventId}`);
assert(gone.status === 404, `删除后查不到了（实际 ${gone.status}）`);

head(15, '分享卡片标签（微信里贴链接要显示活动名，不是一行光秃秃的网址）');

// OG 注入只在 Pages 部署里生效：那边 _worker.js 负责所有请求。
// 本地开发是 Vite 直接发静态文件，/e/* 根本到不了 Worker。
// 与其让这几条假装通过，不如明确说"这里测不了"。
const IS_LOCAL = BASE.includes('localhost') || BASE.includes('127.0.0.1');

if (IS_LOCAL) {
  console.log('  ⏭ 跳过 —— 本地测不了，OG 注入只在 Pages 部署里生效');
  console.log('     要验证请跑：BASE=https://heshihedi.pages.dev npm run smoke');
} else {

const page = await fetch(`${BASE}/e/${EID}`).then((r) => r.text());
const fillPage = await fetch(`${BASE}/e/${EID}/fill`).then((r) => r.text());
const homePage = await fetch(`${BASE}/new`).then((r) => r.text());

const ogOf = (htmlText, prop) =>
  htmlText.match(new RegExp(`<meta property="og:${prop}" content="([^"]*)"`))?.[1];

assert(ogOf(page, 'title') === '国庆出去玩', `活动页 og:title 是活动名（实际 ${ogOf(page, 'title')}）`);
assert(
  ogOf(fillPage, 'title') === '国庆出去玩',
  `填写链接也有卡片 —— 群里发的多数是这一条（实际 ${ogOf(fillPage, 'title')}）`,
);
assert(
  (ogOf(page, 'description') ?? '').includes('已填'),
  `og:description 说了进度（实际 ${ogOf(page, 'description')}）`,
);
assert(
  (ogOf(page, 'image') ?? '').startsWith('https://'),
  'og:image 是绝对地址 —— 相对地址爬虫解析不了',
);
assert(
  ogOf(homePage, 'title') !== undefined,
  '首页也有默认卡片（它不走 Worker，靠 index.html 里的兜底）',
);

// 没转义的话，引号会把 meta 标签截断，卡片就花了
const weird = await call('POST', '/api/events', {
  title: '带"引号"和<尖括号>的活动',
  rangeStart: RANGE_START,
  rangeEnd: RANGE_END,
  granularity: 'day',
  collectDestinations: false,
  budgetEnabled: false,
  anonymity: 'open',
});
const weirdPage = await fetch(`${BASE}/e/${weird.data.eventId}`).then((r) => r.text());
const weirdOg = ogOf(weirdPage, 'title');
assert(
  weirdOg !== undefined && weirdOg.includes('&quot;') && weirdOg.includes('&lt;'),
  `标题里的引号和尖括号被转义了（实际 ${weirdOg}）`,
);
assert(
  !weirdPage.includes('<title>带"引号"'),
  '页面 title 也没有把原始引号漏出去',
);
await call('POST', `/api/events/${weird.data.eventId}/delete`, {
  adminKey: weird.data.adminKey,
});

} // 非本地才跑 OG 断言

head(16, '朋友点开链接能打开（完整页面加载，不是前端路由）');

// 这是最关键的一条：微信里点开链接 = 一次完整页面加载。
// 任何把 /e/* 拦在 Worker 里却没实现路由的配置，都会让这里返回 JSON 404。
for (const path of [`/e/${EID}`, `/e/${EID}/fill`]) {
  const r = await fetch(`${BASE}${path}`);
  const ct = r.headers.get('content-type') ?? '';
  const body = await r.text();
  assert(r.status === 200, `${path} 返回 200（实际 ${r.status}）`);
  assert(ct.includes('text/html'), `${path} 返回的是 HTML 而不是 ${ct}`);
  assert(body.includes('<div id="root">'), `${path} 是应用页面而不是错误 JSON`);
}

const api404 = await call('GET', '/api/nope');
assert(api404.status === 404, '不存在的 API 仍然正确返回 404 JSON');

head(17, '凭证不泄露');

assert(!JSON.stringify(res.data).includes('adminKeyHash'), '结果接口里没有 adminKeyHash');
assert(!JSON.stringify(after.data).includes(ADMIN_KEY), '活动详情里没有管理密钥明文');
assert(after.data.event.adminKeyHash === '', '活动详情里的 adminKeyHash 字段被清空');

// token 拿到就能冒充别人提交，必须剥掉
const leaked = after.data.participants.filter((p) => 'token' in p);
assert(leaked.length === 0, `参与者列表里没有 token（实际泄露 ${leaked.length} 条）`);
for (const [, t] of Object.entries(tokens)) {
  assert(!JSON.stringify(after.data).includes(t), '响应里搜不到任何参与者的 token');
  break; // 抽查一个就够，全部搜一遍日志会很长
}

head(18, '意愿匿名 —— 「不想去」的人名不能从接口里漏出去');

// 这个设置原先只在界面上生效：不点名，但数据整包照发，
// 谁都能按 F12 看到谁投了「不想去」—— 而「不想去」正是它唯一要保护的东西。
// 下面几条盯的是【响应体里到底有没有】，不是界面上显不显示。
const anon = await call('POST', '/api/events', {
  title: '匿名测试',
  rangeStart: RANGE_START,
  rangeEnd: RANGE_END,
  granularity: 'day',
  collectDestinations: true,
  budgetEnabled: false,
  anonymity: 'vote_anonymous',
});

const anonTokens = {};
for (const n of ['甲', '乙', '丙']) {
  const r = await call('POST', `/api/events/${anon.data.eventId}/join`, { name: n });
  anonTokens[n] = r.data.token;
}
const anonDest = await call('POST', `/api/events/${anon.data.eventId}/destinations`, {
  token: anonTokens['甲'],
  name: '青岛',
  daysNeeded: 2,
});
await call('POST', `/api/events/${anon.data.eventId}/submit`, {
  token: anonTokens['甲'],
  name: '甲',
  availability: avail('2222222'),
  votes: [{ destinationId: anonDest.data.destinationId, level: 2 }],
});
await call('POST', `/api/events/${anon.data.eventId}/submit`, {
  token: anonTokens['乙'],
  name: '乙',
  availability: avail('2222222'),
  votes: [{ destinationId: anonDest.data.destinationId, level: 2 }],
});
// 丙 全程有空，但明确投了「不想去」—— 他就是要被保护的那个人
await call('POST', `/api/events/${anon.data.eventId}/submit`, {
  token: anonTokens['丙'],
  name: '丙',
  availability: avail('2222222'),
  votes: [{ destinationId: anonDest.data.destinationId, level: 0 }],
});

const anonDetail = await call('GET', `/api/events/${anon.data.eventId}`);
assert(
  anonDetail.data.votes.length === 0,
  `不带 token 读活动详情，一条投票都拿不到（实际 ${anonDetail.data.votes.length} 条）`,
);

const anonMine = await call(
  'GET',
  `/api/events/${anon.data.eventId}`,
  undefined,
  { 'X-Participant-Token': anonTokens['甲'] },
);
assert(
  anonMine.data.votes.length === 1 && anonMine.data.votes[0].level === 2,
  `带上自己的 token 才拿回自己那一条（实际 ${anonMine.data.votes.length} 条）`,
);
assert(
  !JSON.stringify(anonMine.data).includes(anonTokens['丙']),
  '别人的 token 不会跟着响应发出来',
);

const anonRes = await call('GET', `/api/events/${anon.data.eventId}/results`);
const anonPlan = anonRes.data.plans[0];
assert(anonPlan !== undefined, '匿名活动照样能算出方案');
assert(
  anonPlan?.unwillingCount === 1,
  `「另有几人不想去」这个数还在（实际 ${anonPlan?.unwillingCount}）`,
);
assert(
  !anonPlan?.missing?.some((m) => m.reason === 'unwilling'),
  '结果里没有「不想去」的人名条目 —— 只删了界面上的显示等于没删',
);
// 搜的是【名字】不是 ID：参与者 ID 是随机短串，名字才是能认出人的那个。
// 丙 全程有空、只投了「不想去」，所以他不该出现在方案的任何位置。
assert(
  !JSON.stringify(anonRes.data).includes('丙'),
  '整个结果响应里搜不到「丙」这个名字',
);

// 对照组：非匿名的活动必须照常点名，别把功能改没了
const openPlan = d.plans.find((p) => p.destinationName === '云南');
assert(
  openPlan?.missing?.some((m) => m.reason === 'unwilling'),
  '对照组：非匿名活动依然点名「不想去」的人',
);

await call('POST', `/api/events/${anon.data.eventId}/delete`, {
  adminKey: anon.data.adminKey,
});

head(19, '预算金额 —— 个人上限、统计与非法输入');

const budgetEvent = await call('POST', '/api/events', {
  title: '预算测试',
  rangeStart: RANGE_START,
  rangeEnd: RANGE_END,
  granularity: 'day',
  collectDestinations: true,
  budgetEnabled: true,
  anonymity: 'open',
});
assert(budgetEvent.status === 200, '预算活动创建成功');
const budgetTokens = {};
for (const n of ['甲', '乙', '丙']) {
  const r = await call('POST', `/api/events/${budgetEvent.data.eventId}/join`, { name: n });
  budgetTokens[n] = r.data.token;
}
const budgetDest = await call(
  'POST',
  `/api/events/${budgetEvent.data.eventId}/destinations`,
  { token: budgetTokens['甲'], name: '预算目的地', daysNeeded: 2 },
);
assert(budgetDest.status === 200, '预算目的地提名成功');
const budgetValues = { 甲: 1000, 乙: 2000, 丙: 3000 };
for (const n of Object.keys(budgetTokens)) {
  const r = await call('POST', `/api/events/${budgetEvent.data.eventId}/submit`, {
    token: budgetTokens[n],
    name: n,
    availability: avail('2222222'),
    votes: [{ destinationId: budgetDest.data.destinationId, level: 2, budgetAmount: budgetValues[n] }],
  });
  assert(r.status === 200, `${n} 的预算提交成功`);
}
const budgetResults = await call('GET', `/api/events/${budgetEvent.data.eventId}/results`);
const budgetStats = budgetResults.data.plans?.[0]?.budgetStats;
assert(
  budgetStats?.median === 2000 &&
    budgetStats?.average === 2000 &&
    budgetStats?.min === 1000 &&
    budgetStats?.max === 3000 &&
    budgetStats?.filledCount === 3 &&
    budgetStats?.totalCount === 3,
  `预算统计正确（实际 ${JSON.stringify(budgetStats)}）`,
);
const invalidBudget = await call('POST', `/api/events/${budgetEvent.data.eventId}/submit`, {
  token: budgetTokens['甲'],
  name: '甲',
  availability: avail('2222222'),
  votes: [{ destinationId: budgetDest.data.destinationId, level: 2, budgetAmount: 100000001 }],
});
assert(invalidBudget.status === 400, `超出上限的预算被拒绝（实际 ${invalidBudget.status}）`);
const budgetDeleted = await call('POST', `/api/events/${budgetEvent.data.eventId}/delete`, {
  adminKey: budgetEvent.data.adminKey,
});
assert(budgetDeleted.status === 200, '预算测试活动已清理');

// ─────────────────────────────────────────────

console.log(`\n${'─'.repeat(52)}`);
if (failed === 0) {
  console.log(`全部通过（${passed} 项）`);
  console.log(`活动地址：${BASE}/e/${EID}`);
} else {
  console.log(`${passed} 项通过，${failed} 项失败`);
  process.exit(1);
}
