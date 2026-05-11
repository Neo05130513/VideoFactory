import Link from 'next/link';
import { CREDIT_ADD_ONS, CREDIT_PLANS, CREDIT_VIDEO_RATES, estimateMinutesForPlan, formatMinutes } from '@/lib/billing';

export const dynamic = 'force-dynamic';

export default function PricingPage() {
  const modes = Object.entries(CREDIT_VIDEO_RATES);

  return (
    <main style={{ minHeight: '100vh', background: '#0b0f17', color: '#f8fafc', padding: 28 }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gap: 22 }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <Link href="/" style={{ color: '#f8fafc', textDecoration: 'none', fontWeight: 900, letterSpacing: '0.04em' }}>Video Factory</Link>
          <nav style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link href="/login" style={ghostButtonStyle}>登录</Link>
            <Link href="/register" style={primaryButtonStyle}>注册开始使用</Link>
          </nav>
        </header>

        <section style={{ ...heroStyle, display: 'grid', gap: 16 }}>
          <div style={{ color: '#67e8f9', fontSize: 12, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase' }}>Subscription + Credits</div>
          <h1 style={{ margin: 0, fontSize: 44, lineHeight: 1.1 }}>订阅给积分，用多少扣多少</h1>
          <p style={{ margin: 0, color: '#cbd5e1', lineHeight: 1.8, maxWidth: 820 }}>
            基础模板视频成本低，AI 图片和声音复刻成本高，所以 Video Factory 使用积分制。免费版能完整生成一条视频，付费版按月获得更多积分，需要重度生成时再购买额外积分包。
          </p>
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
          {CREDIT_PLANS.map((plan) => (
            <article key={plan.id} style={{ ...panelStyle, padding: 20, display: 'grid', gap: 16, alignContent: 'start' }}>
              <div style={{ display: 'grid', gap: 8 }}>
                <span style={{ color: '#94a3b8', fontSize: 13 }}>{plan.name}</span>
                <strong style={{ fontSize: 36 }}>{plan.priceCny === 0 ? '免费' : `¥${plan.priceCny}/月`}</strong>
                <span style={{ color: '#67e8f9', fontSize: 22, fontWeight: 900 }}>{plan.monthlyCredits} 积分/月</span>
              </div>

              <div style={{ display: 'grid', gap: 8 }}>
                {modes.map(([mode, rate]) => (
                  <div key={mode} style={usageRowStyle}>
                    <span>{rate.label}</span>
                    <strong>{formatMinutes(estimateMinutesForPlan(plan, mode as keyof typeof CREDIT_VIDEO_RATES))}</strong>
                  </div>
                ))}
              </div>

              <ul style={{ margin: 0, paddingLeft: 18, color: '#cbd5e1', lineHeight: 1.8 }}>
                {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
                <li>{plan.watermark ? '导出带水印' : '无水印导出'}</li>
                <li>队列：{queueLabel(plan.queue)}</li>
                {plan.maxExports ? <li>最多导出 {plan.maxExports} 条/月</li> : null}
              </ul>
            </article>
          ))}
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 16 }}>
          <article style={{ ...panelStyle, padding: 20, display: 'grid', gap: 14 }}>
            <h2 style={{ margin: 0, fontSize: 26 }}>积分扣费规则</h2>
            <div style={{ display: 'grid', gap: 10 }}>
              {modes.map(([mode, rate]) => (
                <div key={mode} style={{ ...usageRowStyle, padding: 14 }}>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <strong>{rate.label}</strong>
                    <span style={{ color: '#94a3b8', lineHeight: 1.6 }}>{rate.description}</span>
                  </div>
                  <strong style={{ color: '#fbbf24' }}>{rate.creditsPerMinute} 积分/分钟</strong>
                </div>
              ))}
            </div>
          </article>

          <article style={{ ...panelStyle, padding: 20, display: 'grid', gap: 14, alignContent: 'start' }}>
            <h2 style={{ margin: 0, fontSize: 26 }}>额外积分包</h2>
            <p style={{ margin: 0, color: '#94a3b8', lineHeight: 1.7 }}>订阅积分按月发放，建议月底清零；额外购买积分建议保留 12 个月有效期。</p>
            <div style={{ display: 'grid', gap: 10 }}>
              {CREDIT_ADD_ONS.map((pack) => (
                <div key={pack.credits} style={usageRowStyle}>
                  <span>{pack.credits} 积分</span>
                  <strong>¥{pack.priceCny}</strong>
                </div>
              ))}
            </div>
            <Link href="/register" style={{ ...primaryButtonStyle, width: 'fit-content' }}>注册账号</Link>
          </article>
        </section>
      </div>
    </main>
  );
}

function queueLabel(queue: 'slow' | 'standard' | 'priority') {
  if (queue === 'priority') return '优先';
  if (queue === 'standard') return '标准';
  return '慢速';
}

const panelStyle = {
  borderRadius: 20,
  border: '1px solid #263244',
  background: '#151b26'
} as const;

const heroStyle = {
  borderRadius: 22,
  border: '1px solid #2a394d',
  background: 'linear-gradient(135deg, #132235 0%, #1c1829 52%, #172119 100%)',
  padding: 26
} as const;

const usageRowStyle = {
  borderRadius: 12,
  border: '1px solid #263244',
  background: '#111823',
  padding: 12,
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  alignItems: 'center'
} as const;

const primaryButtonStyle = {
  border: '1px solid #38bdf8',
  borderRadius: 12,
  background: '#38bdf8',
  color: '#061018',
  padding: '10px 13px',
  textDecoration: 'none',
  fontWeight: 900
} as const;

const ghostButtonStyle = {
  border: '1px solid #334155',
  borderRadius: 12,
  background: '#1b2330',
  color: '#e2e8f0',
  padding: '10px 13px',
  textDecoration: 'none',
  fontWeight: 800
} as const;
