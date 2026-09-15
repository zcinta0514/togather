/**
 * 端到端冒烟测试：走完整 HTTP 链路验证设计文档 §3.1 那个反例。
 *
 * 用法：
 *   1. 另开一个终端跑 `npm run dev`
 *   2. npm run smoke
 *
 * 为什么用 Node 而不是 bash：
 *   Git Bash 在 Windows 上传中文参数会变乱码，四个不同的中文名会变成同一串乱码，
 *   把重名检查误触发成「全部重复」。Node 天生 UTF-8，不受 shell 编码影响。
 */

const BASE = process.env.BASE ?? 'http://localhost:5173';
const RANGE_START = 1759219200; // 10/1 00:00 北京时间
const RANGE_END = 1759823999; // 10/7 23:59:59 北京时间

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

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
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

head(10, '管理密钥哈希不泄露');

assert(!JSON.stringify(res.data).includes('adminKeyHash'), '结果接口里没有 adminKeyHash');
assert(!JSON.stringify(after.data).includes(ADMIN_KEY), '活动详情里没有管理密钥明文');
assert(
  after.data.event.adminKeyHash === '',
  '活动详情里的 adminKeyHash 字段被清空',
);

// ─────────────────────────────────────────────

console.log(`\n${'─'.repeat(52)}`);
if (failed === 0) {
  console.log(`全部通过（${passed} 项）`);
  console.log(`活动地址：${BASE}/e/${EID}`);
} else {
  console.log(`${passed} 项通过，${failed} 项失败`);
  process.exit(1);
}
