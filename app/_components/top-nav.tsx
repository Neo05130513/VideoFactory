import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { logoutAction } from './top-nav-actions';
import { newWindowLinkProps } from './studio-ui';

const baseNav = {
  borderRadius: 24,
  border: '1px solid rgba(148,163,184,0.14)',
  background: 'linear-gradient(180deg, rgba(15,23,42,0.9) 0%, rgba(6,10,18,0.96) 100%)'
} as const;

export type NavKey = 'home' | 'topics' | 'scripts' | 'videos' | 'trends' | 'probe' | 'handbook' | 'launch' | 'users' | 'audit' | 'pricing' | 'billing';

const items: { key: NavKey; href: string; text: string }[] = [
  { key: 'home', href: '/', text: '首页' },
  { key: 'topics', href: '/topics', text: '选题' },
  { key: 'scripts', href: '/scripts', text: '脚本' },
  { key: 'videos', href: '/videos', text: '视频' },
  { key: 'users', href: '/users', text: '账号' },
  { key: 'billing', href: '/admin/billing', text: '运营' },
  { key: 'audit', href: '/admin/audit', text: '审计' },
  { key: 'pricing', href: '/pricing', text: '套餐' },
  { key: 'handbook', href: '/handbook', text: '手册' },
  { key: 'launch', href: '/launch-checklist', text: '上线检查' },
  { key: 'trends', href: '/trends', text: '热点' },
  { key: 'probe', href: '/probe', text: '环境' }
];

export async function TopNav({ active, badge = '教程内容生产台' }: { active: NavKey; badge?: string }) {
  const user = await getCurrentUser();

  return (
    <div style={{ ...baseNav, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Link href="/" {...newWindowLinkProps} style={{ textDecoration: 'none', color: '#f8fafc', fontWeight: 800, letterSpacing: '0.08em' }}>
          VIDEO FACTORY
        </Link>
        <span style={{ padding: '7px 11px', borderRadius: 999, color: '#c4b5fd', background: 'rgba(124,58,237,0.14)', fontSize: 12 }}>
          {badge}
        </span>
        {user ? <span style={{ padding: '7px 11px', borderRadius: 999, color: '#bbf7d0', background: 'rgba(20,83,45,0.24)', fontSize: 12 }}>{user.name} · {user.role}</span> : null}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {items.map((item) => {
          const isActive = item.key === active;
          return (
            <Link
              key={item.key}
              href={item.href}
              {...newWindowLinkProps}
              style={{
                textDecoration: 'none',
                color: isActive ? '#061018' : '#cbd5e1',
                background: isActive ? '#67e8f9' : 'rgba(255,255,255,0.03)',
                border: isActive ? 'none' : '1px solid rgba(148,163,184,0.14)',
                padding: '8px 12px',
                borderRadius: 12,
                fontWeight: 700
              }}
            >
              {item.text}
            </Link>
          );
        })}
        {user ? <form action={logoutAction}><button type="submit" style={{ textDecoration: 'none', color: '#fecaca', background: 'rgba(127,29,29,0.18)', border: '1px solid rgba(248,113,113,0.18)', padding: '8px 12px', borderRadius: 12, fontWeight: 700, cursor: 'pointer' }}>退出</button></form> : null}
      </div>
    </div>
  );
}

export const sharedSurface = baseNav;
