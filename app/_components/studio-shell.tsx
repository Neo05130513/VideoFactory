import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { listVoiceProfiles } from '@/lib/voice-profiles';
import { getVideoRuntimeStatus } from '@/lib/queries';
import { logoutAction } from './top-nav-actions';
import { newWindowLinkProps } from './studio-ui';

export type StudioNavKey = 'start' | 'scripts' | 'videos' | 'assets' | 'pricing' | 'settings';

const navItems: { key: StudioNavKey; href: string; label: string }[] = [
  { key: 'start', href: '/', label: '开始制作' },
  { key: 'scripts', href: '/scripts', label: '脚本' },
  { key: 'videos', href: '/videos', label: '视频库' },
  { key: 'assets', href: '/assets', label: '我的素材' },
  { key: 'pricing', href: '/pricing', label: '套餐积分' },
  { key: 'settings', href: '/settings', label: '设置' }
];

export async function StudioShell({
  active,
  title,
  subtitle,
  action,
  children
}: {
  active: StudioNavKey;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [user, runtime] = await Promise.all([
    getCurrentUser(),
    getVideoRuntimeStatus().catch(() => null)
  ]);
  const userVoices = user ? (await listVoiceProfiles()).filter((profile) => profile.userId === user.id) : [];
  const defaultVoice = userVoices.find((profile) => profile.isDefault) || userVoices.find((profile) => profile.status === 'ready') || null;
  const runtimeReady = Boolean(runtime?.dataDirectoryWritable && runtime?.remotionDependenciesInstalled);

  return (
    <main style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '240px minmax(0, 1fr)', background: '#0b0f17', color: '#f8fafc' }}>
      <aside style={{ minHeight: '100vh', padding: 18, borderRight: '1px solid #243042', background: '#0f141d', display: 'grid', gridTemplateRows: 'auto 1fr auto', gap: 24 }}>
        <div style={{ display: 'grid', gap: 6 }}>
          <Link href="/" {...newWindowLinkProps} style={{ color: '#f8fafc', textDecoration: 'none', fontSize: 18, fontWeight: 800, letterSpacing: '0.04em' }}>Video Factory</Link>
          <span style={{ color: '#94a3b8', fontSize: 12 }}>文档转竖屏讲解视频</span>
        </div>

        <nav style={{ display: 'grid', alignContent: 'start', gap: 8 }}>
          {navItems.map((item) => {
            const selected = item.key === active;
            return (
              <Link
                key={item.key}
                href={item.href}
                {...newWindowLinkProps}
                style={{
                  textDecoration: 'none',
                  color: selected ? '#061018' : '#cbd5e1',
                  background: selected ? '#38bdf8' : 'transparent',
                  border: selected ? '1px solid #38bdf8' : '1px solid transparent',
                  padding: '11px 12px',
                  borderRadius: 10,
                  fontWeight: 700
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ borderRadius: 10, border: '1px solid #263244', background: '#151b26', padding: 12, display: 'grid', gap: 8 }}>
            <StatusLine label="运行状态" value={runtimeReady ? '正常' : '需检查'} tone={runtimeReady ? '#34d399' : '#fbbf24'} />
            <StatusLine label="默认声音" value={defaultVoice?.name || '未设置'} tone={defaultVoice?.status === 'ready' ? '#34d399' : '#94a3b8'} />
            {user ? <StatusLine label="当前用户" value={user.name} tone="#cbd5e1" /> : <Link href="/login" {...newWindowLinkProps} style={{ color: '#38bdf8', textDecoration: 'none', fontWeight: 700 }}>登录账号</Link>}
          </div>
          {user ? <form action={logoutAction}><button type="submit" style={{ width: '100%', border: '1px solid #3b2630', borderRadius: 10, background: '#1c1117', color: '#fecaca', padding: '10px 12px', fontWeight: 700, cursor: 'pointer' }}>退出登录</button></form> : null}
        </div>
      </aside>

      <section style={{ minWidth: 0, padding: '26px 30px 48px', display: 'grid', alignContent: 'start', gap: 22 }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 7 }}>
            <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.15, letterSpacing: 0 }}>{title}</h1>
            {subtitle ? <p style={{ margin: 0, color: '#94a3b8', lineHeight: 1.7, maxWidth: 780 }}>{subtitle}</p> : null}
          </div>
          {action ? <div>{action}</div> : null}
        </header>
        {children}
      </section>
    </main>
  );
}

function StatusLine({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', fontSize: 12 }}>
      <span style={{ color: '#7f8da3' }}>{label}</span>
      <strong style={{ color: tone, textAlign: 'right' }}>{value}</strong>
    </div>
  );
}
