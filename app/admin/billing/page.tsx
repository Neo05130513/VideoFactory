import { revalidatePath } from 'next/cache';
import { TopNav } from '@/app/_components/top-nav';
import { appendAuditLog } from '@/lib/audit';
import { CREDIT_PLANS, formatMinutes, getBillingDashboard, type CreditPlanId } from '@/lib/billing';
import { requireRole } from '@/lib/auth';
import { adjustUserCredits, changeUserPlan, setCreditAccountStatus, type CreditAccountStatus } from '@/lib/credits';

export const dynamic = 'force-dynamic';

async function adjustCreditsAction(formData: FormData) {
  'use server';
  const admin = await requireRole(['admin']);
  const userId = String(formData.get('userId') || '').trim();
  const amount = Number(formData.get('amount') || 0);
  const note = String(formData.get('note') || '').trim() || '线下收款后手工调整积分';
  if (!userId || !Number.isFinite(amount)) return;

  await adjustUserCredits({ userId, amount, note });
  await appendAuditLog({
    actor: admin,
    action: 'credit_account.adjust',
    targetType: 'credit_account',
    targetId: userId,
    summary: `手工调整积分 ${amount}：${note}`
  });
  revalidatePath('/admin/billing');
}

async function changePlanAction(formData: FormData) {
  'use server';
  const admin = await requireRole(['admin']);
  const userId = String(formData.get('userId') || '').trim();
  const planId = String(formData.get('planId') || 'free') as CreditPlanId;
  const plan = CREDIT_PLANS.find((item) => item.id === planId);
  if (!userId || !plan) return;

  await changeUserPlan({
    userId,
    planId,
    note: `线下收款后切换套餐：${plan.name}`
  });
  await appendAuditLog({
    actor: admin,
    action: 'credit_account.plan_change',
    targetType: 'credit_account',
    targetId: userId,
    summary: `切换套餐：${plan.name}`
  });
  revalidatePath('/admin/billing');
}

async function setCreditStatusAction(formData: FormData) {
  'use server';
  const admin = await requireRole(['admin']);
  const userId = String(formData.get('userId') || '').trim();
  const status = String(formData.get('status') || 'active') as CreditAccountStatus;
  if (!userId || (status !== 'active' && status !== 'frozen')) return;

  await setCreditAccountStatus({
    userId,
    status,
    note: status === 'frozen' ? '管理员冻结积分账户' : '管理员恢复积分账户'
  });
  await appendAuditLog({
    actor: admin,
    action: 'credit_account.status',
    targetType: 'credit_account',
    targetId: userId,
    summary: status === 'frozen' ? '冻结积分账户' : '恢复积分账户'
  });
  revalidatePath('/admin/billing');
}

export default async function BillingAdminPage() {
  await requireRole(['admin']);
  const dashboard = await getBillingDashboard();
  const users = dashboard.userUsage.map((item) => item.user);

  return (
    <main style={{ minHeight: '100vh', background: '#0b0f17', color: '#f8fafc', padding: 24 }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', display: 'grid', gap: 20 }}>
        <TopNav active="billing" badge="运营与积分后台" />

        <section style={{ ...panelStyle, padding: 22, display: 'grid', gap: 12 }}>
          <div style={eyebrowStyle}>Business Console</div>
          <h1 style={{ margin: 0, fontSize: 34 }}>用户使用情况与积分运营</h1>
          <p style={{ margin: 0, color: '#cbd5e1', lineHeight: 1.8 }}>
            当前版本不接在线支付。你可以通过微信、支付宝、对公转账或其他方式收款，确认收款后在这里给用户切套餐、补积分、冻结账户，并查看每个用户的实际消耗。
          </p>
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 14 }}>
          <Metric label="总用户" value={`${dashboard.totals.users}`} note={`活跃 ${dashboard.totals.activeUsers}`} />
          <Metric label="已用积分" value={`${dashboard.totals.estimatedCredits}`} note="按流水优先统计" tone="#fbbf24" />
          <Metric label="视频项目" value={`${dashboard.totals.videos}`} note={`完成 ${dashboard.totals.completedVideos}`} tone="#34d399" />
          <Metric label="视频总时长" value={formatMinutes(dashboard.totals.videoMinutes)} note="按分镜时长汇总" tone="#38bdf8" />
          <Metric label="收款模式" value="线下确认" note="暂不接支付回调" tone="#c4b5fd" />
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16 }}>
          <article style={{ ...panelStyle, padding: 18, display: 'grid', gap: 12 }}>
            <h2 style={sectionTitleStyle}>手工运营操作</h2>
            <form action={changePlanAction} style={formGridStyle}>
              <FormSelect name="userId" label="用户" users={users} />
              <label style={labelStyle}>
                <span style={labelTextStyle}>套餐</span>
                <select name="planId" defaultValue="creator" style={inputStyle}>
                  {dashboard.plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>{plan.name} / {plan.monthlyCredits} 积分</option>
                  ))}
                </select>
              </label>
              <button type="submit" style={buttonStyle}>切换套餐</button>
            </form>

            <form action={adjustCreditsAction} style={formGridStyle}>
              <FormSelect name="userId" label="用户" users={users} />
              <label style={labelStyle}>
                <span style={labelTextStyle}>积分增减</span>
                <input name="amount" type="number" defaultValue={1000} style={inputStyle} />
              </label>
              <label style={{ ...labelStyle, gridColumn: '1 / span 2' }}>
                <span style={labelTextStyle}>备注</span>
                <input name="note" placeholder="例如：已线下收款 49 元，补发 3000 积分" style={inputStyle} />
              </label>
              <button type="submit" style={buttonStyle}>调整积分</button>
            </form>

            <form action={setCreditStatusAction} style={formGridStyle}>
              <FormSelect name="userId" label="用户" users={users} />
              <label style={labelStyle}>
                <span style={labelTextStyle}>状态</span>
                <select name="status" defaultValue="active" style={inputStyle}>
                  <option value="active">恢复可用</option>
                  <option value="frozen">冻结积分</option>
                </select>
              </label>
              <button type="submit" style={dangerButtonStyle}>更新状态</button>
            </form>
          </article>

          <article style={{ ...panelStyle, padding: 18, display: 'grid', gap: 12 }}>
            <h2 style={sectionTitleStyle}>套餐与扣费规则</h2>
            {dashboard.plans.map((plan) => (
              <div key={plan.id} style={rowStyle}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <strong>{plan.name}</strong>
                  <span style={{ color: '#94a3b8' }}>{plan.watermark ? '带水印' : '无水印'} · {queueLabel(plan.queue)}队列</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <strong style={{ color: '#67e8f9' }}>{plan.monthlyCredits} 积分</strong>
                  <div style={{ color: '#cbd5e1', marginTop: 4 }}>{plan.priceCny === 0 ? '免费' : `¥${plan.priceCny}/月`}</div>
                </div>
              </div>
            ))}
            {Object.entries(dashboard.rates).map(([key, rate]) => (
              <div key={key} style={compactRowStyle}>
                <span>{rate.label}</span>
                <strong style={{ color: '#fbbf24' }}>{rate.creditsPerMinute}/分钟</strong>
              </div>
            ))}
          </article>
        </section>

        <section style={{ ...panelStyle, padding: 18, display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <h2 style={sectionTitleStyle}>用户使用排行</h2>
            <span style={{ color: '#94a3b8' }}>可用积分低或频繁失败的账号需要优先跟进。</span>
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            {dashboard.userUsage.map((item) => {
              const account = item.creditAccount;
              return (
                <article key={item.user.id} style={{ ...rowStyle, gridTemplateColumns: '1.15fr repeat(8, minmax(82px, 1fr))', alignItems: 'center' }}>
                  <div style={{ display: 'grid', gap: 5 }}>
                    <strong>{item.user.name}</strong>
                    <span style={{ color: '#94a3b8', wordBreak: 'break-all' }}>{item.user.email}</span>
                    <span style={{ color: '#64748b', fontSize: 12 }}>{item.user.role} · {item.user.disabledAt ? '账号停用' : '账号启用'}</span>
                  </div>
                  <SmallStat label="套餐" value={account?.planId || 'free'} tone="#c4b5fd" />
                  <SmallStat label="可用" value={`${account?.availableCredits ?? 0}`} tone="#34d399" />
                  <SmallStat label="已用" value={`${account?.usedCredits ?? item.estimatedCredits}`} tone="#fbbf24" />
                  <SmallStat label="预占" value={`${account?.reservedCredits ?? 0}`} tone="#38bdf8" />
                  <SmallStat label="文档" value={`${item.importedDocs}`} />
                  <SmallStat label="脚本" value={`${item.scripts}`} />
                  <SmallStat label="视频" value={`${item.videos}`} />
                  <SmallStat label="时长" value={formatMinutes(item.videoMinutes)} />
                </article>
              );
            })}
          </div>
        </section>

        <section style={{ ...panelStyle, padding: 18, display: 'grid', gap: 12 }}>
          <h2 style={sectionTitleStyle}>最近积分流水</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {dashboard.ledger.slice(0, 12).map((entry) => (
              <div key={entry.id} style={compactRowStyle}>
                <span style={{ color: '#cbd5e1' }}>{entry.type} · {entry.note}</span>
                <span style={{ color: entry.amount >= 0 ? '#34d399' : '#fbbf24', fontWeight: 800 }}>
                  {entry.amount > 0 ? '+' : ''}{entry.amount} · 余额 {entry.balanceAfter} · {formatDate(entry.createdAt)}
                </span>
              </div>
            ))}
            {!dashboard.ledger.length ? <span style={{ color: '#94a3b8' }}>暂无积分流水。</span> : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function FormSelect({ name, label, users }: { name: string; label: string; users: Array<{ id: string; name: string; email: string }> }) {
  return (
    <label style={labelStyle}>
      <span style={labelTextStyle}>{label}</span>
      <select name={name} required style={inputStyle}>
        {users.map((user) => (
          <option key={user.id} value={user.id}>{user.name} / {user.email}</option>
        ))}
      </select>
    </label>
  );
}

function Metric({ label, value, note, tone = '#67e8f9' }: { label: string; value: string; note: string; tone?: string }) {
  return (
    <div style={{ ...panelStyle, padding: 14, display: 'grid', gap: 6 }}>
      <span style={{ color: '#8ea0b8', fontSize: 12 }}>{label}</span>
      <strong style={{ color: tone, fontSize: 24, lineHeight: 1.15 }}>{value}</strong>
      <span style={{ color: '#94a3b8', fontSize: 13 }}>{note}</span>
    </div>
  );
}

function SmallStat({ label, value, tone = '#cbd5e1' }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <span style={{ color: '#64748b', fontSize: 12 }}>{label}</span>
      <strong style={{ color: tone }}>{value}</strong>
    </div>
  );
}

function queueLabel(queue: 'slow' | 'standard' | 'priority') {
  if (queue === 'priority') return '优先';
  if (queue === 'standard') return '标准';
  return '慢速';
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

const panelStyle = {
  borderRadius: 18,
  border: '1px solid #263244',
  background: '#151b26'
} as const;

const eyebrowStyle = {
  color: '#67e8f9',
  fontSize: 12,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  fontWeight: 900
} as const;

const sectionTitleStyle = {
  margin: 0,
  fontSize: 22
} as const;

const rowStyle = {
  borderRadius: 12,
  border: '1px solid #263244',
  background: '#111823',
  padding: 14,
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  gap: 12
} as const;

const compactRowStyle = {
  borderRadius: 10,
  border: '1px solid #263244',
  background: '#111823',
  padding: 12,
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  alignItems: 'center',
  flexWrap: 'wrap'
} as const;

const formGridStyle = {
  borderRadius: 12,
  border: '1px solid #263244',
  background: '#111823',
  padding: 14,
  display: 'grid',
  gridTemplateColumns: '1fr 1fr auto',
  gap: 12,
  alignItems: 'end'
} as const;

const labelStyle = {
  display: 'grid',
  gap: 7
} as const;

const labelTextStyle = {
  color: '#94a3b8',
  fontSize: 12,
  fontWeight: 800
} as const;

const inputStyle = {
  minWidth: 0,
  borderRadius: 10,
  border: '1px solid #334155',
  background: '#0f141d',
  color: '#f8fafc',
  padding: '10px 12px',
  outline: 'none'
} as const;

const buttonStyle = {
  border: '1px solid #38bdf8',
  borderRadius: 10,
  background: '#38bdf8',
  color: '#061018',
  padding: '10px 14px',
  fontWeight: 900,
  cursor: 'pointer'
} as const;

const dangerButtonStyle = {
  ...buttonStyle,
  border: '1px solid #fb7185',
  background: '#fb7185',
  color: '#18070b'
} as const;
