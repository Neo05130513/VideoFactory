import { redirect } from 'next/navigation';
import Link from 'next/link';
import { loginWithPassword, getCurrentUser } from '@/lib/auth';

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect('/');

  async function loginAction(formData: FormData) {
    'use server';
    const email = String(formData.get('email') || '').trim();
    const password = String(formData.get('password') || '').trim();
    await loginWithPassword(email, password);
    redirect('/');
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'radial-gradient(circle at top left, rgba(56,189,248,0.14) 0%, transparent 24%), linear-gradient(180deg, #050816 0%, #0b1120 100%)', color: '#f8fafc', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 460, borderRadius: 28, padding: 28, background: 'linear-gradient(180deg, rgba(15,23,42,0.92) 0%, rgba(6,10,18,0.96) 100%)', border: '1px solid rgba(148,163,184,0.14)', display: 'grid', gap: 16 }}>
        <div>
          <div style={{ color: '#818cf8', fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase' }}>Account Access</div>
          <h1 style={{ margin: '10px 0 0', fontSize: 36 }}>登录 Video Factory</h1>
          <p style={{ margin: '12px 0 0', color: '#cbd5e1', lineHeight: 1.8 }}>先用演示账号登录，再根据角色进入内容、视频或运营流程。</p>
        </div>

        <form action={loginAction} style={{ display: 'grid', gap: 12 }}>
          <label style={{ display: 'grid', gap: 8 }}>
            <span style={{ color: '#94a3b8', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase' }}>邮箱</span>
            <input name="email" defaultValue="admin@videofactory.local" style={inputStyle} />
          </label>
          <label style={{ display: 'grid', gap: 8 }}>
            <span style={{ color: '#94a3b8', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase' }}>密码</span>
            <input name="password" type="password" defaultValue="admin123" style={inputStyle} />
          </label>
          <button type="submit" style={buttonStyle}>登录</button>
        </form>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', color: '#cbd5e1' }}>
          <Link href="/register" style={{ color: '#67e8f9', textDecoration: 'none', fontWeight: 800 }}>注册新账号</Link>
          <Link href="/pricing" style={{ color: '#c4b5fd', textDecoration: 'none', fontWeight: 800 }}>查看套餐积分</Link>
        </div>

        <div style={{ borderRadius: 16, padding: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.14)', color: '#cbd5e1', lineHeight: 1.8 }}>
          演示账号：<br />
          admin@videofactory.local / admin123<br />
          content@videofactory.local / content123<br />
          video@videofactory.local / video123<br />
          ops@videofactory.local / ops123
        </div>
      </div>
    </main>
  );
}

const inputStyle = {
  borderRadius: 14,
  border: '1px solid rgba(148,163,184,0.18)',
  background: 'rgba(2,6,23,0.56)',
  color: '#f8fafc',
  padding: '12px 14px',
  outline: 'none'
} as const;

const buttonStyle = {
  border: 'none',
  borderRadius: 14,
  padding: '12px 14px',
  background: 'linear-gradient(135deg, #67e8f9, #06b6d4)',
  color: '#0f172a',
  fontWeight: 800,
  cursor: 'pointer'
} as const;
