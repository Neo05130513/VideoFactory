export const dynamic = 'force-dynamic';

import { TopNav, sharedSurface } from '../_components/top-nav';
import { ProbeClientPanel } from './probe-client-panel';

const shell = sharedSurface;

export default function ProbePage() {
  return (
    <main style={{ minHeight: '100vh', background: 'radial-gradient(circle at top left, rgba(56,189,248,0.14) 0%, transparent 24%), radial-gradient(circle at top right, rgba(168,85,247,0.12) 0%, transparent 20%), linear-gradient(180deg, #050816 0%, #0b1120 100%)', color: '#f8fafc', padding: 24 }}>
      <div style={{ maxWidth: 1120, width: '100%', margin: '0 auto', display: 'grid', gap: 20 }}>
        <TopNav active="probe" badge="环境检查" />

        <section style={{ ...shell, padding: 24, display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 18 }}>
          <div>
            <div style={{ color: '#818cf8', fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase' }}>Probe</div>
            <h1 style={{ margin: '10px 0 0', fontSize: 42 }}>环境诊断台</h1>
            <p style={{ margin: '12px 0 0', color: '#cbd5e1', lineHeight: 1.8, maxWidth: 760 }}>
              这里会显示当前应用是否能继续往下推进的关键环境条件。AI 生成默认走 OpenAI，视频合成主链路走 Remotion。
            </p>
          </div>
          <div style={{ borderRadius: 20, padding: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 12 }}>
            <div style={{ color: '#67e8f9', fontWeight: 800 }}>Remotion-first</div>
            <div style={{ color: '#cbd5e1', lineHeight: 1.7 }}>当前页面保留 OpenAI、Remotion、ffmpeg 和 legacy MiniMax 状态，方便定位生成链路问题。</div>
          </div>
        </section>

        <ProbeClientPanel />
      </div>
    </main>
  );
}

