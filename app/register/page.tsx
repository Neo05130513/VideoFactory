import Link from 'next/link';
import { redirect } from 'next/navigation';
import { appendAuditLog } from '@/lib/audit';
import { getCurrentUser, loginWithPassword } from '@/lib/auth';
import { ensureCreditAccount } from '@/lib/credits';
import { createUserAccount } from '@/lib/users';

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect('/');

  async function registerAction(formData: FormData) {
    'use server';
    const name = String(formData.get('name') || '').trim();
    const email = String(formData.get('email') || '').trim().toLowerCase();
    const password = String(formData.get('password') || '').trim();

    const account = await createUserAccount({
      name,
      email,
      password,
      role: 'creator',
      mustChangePassword: false
    });
    await ensureCreditAccount(account.id);

    await appendAuditLog({
      actor: { id: account.id, name: account.name, role: account.role },
      action: 'auth.register',
      targetType: 'system',
      targetId: account.id,
      summary: `用户自助注册：${account.email}`
    });

    await loginWithPassword(email, password);
    redirect('/');
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0b0f17', color: '#f8fafc', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 480, borderRadius: 26, padding: 26, background: '#151b26', border: '1px solid #263244', display: 'grid', gap: 16 }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <Link href="/pricing" style={{ color: '#67e8f9', textDecoration: 'none', fontWeight: 800 }}>查看套餐</Link>
          <h1 style={{ margin: 0, fontSize: 36 }}>注册 Video Factory</h1>
          <p style={{ margin: 0, color: '#94a3b8', lineHeight: 1.7 }}>注册后默认进入创作者账号，可上传资料、生成脚本和制作视频。管理员仍然可以在后台调整账号、套餐和使用情况。</p>
        </div>

        <form action={registerAction} style={{ display: 'grid', gap: 12 }}>
          <label style={labelStyle}>
            <span style={labelTextStyle}>昵称</span>
            <input name="name" required minLength={2} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            <span style={labelTextStyle}>邮箱</span>
            <input name="email" required type="email" style={inputStyle} />
          </label>
          <label style={labelStyle}>
            <span style={labelTextStyle}>密码</span>
            <input name="password" required type="password" minLength={8} style={inputStyle} />
          </label>
          <button type="submit" style={buttonStyle}>注册并进入工作台</button>
        </form>

        <div style={{ color: '#cbd5e1', lineHeight: 1.7 }}>
          已有账号？<Link href="/login" style={{ color: '#67e8f9', fontWeight: 800, textDecoration: 'none' }}>直接登录</Link>
        </div>
      </div>
    </main>
  );
}

const labelStyle = {
  display: 'grid',
  gap: 8
} as const;

const labelTextStyle = {
  color: '#94a3b8',
  fontSize: 12,
  letterSpacing: '0.12em',
  textTransform: 'uppercase'
} as const;

const inputStyle = {
  borderRadius: 12,
  border: '1px solid #334155',
  background: '#0f141d',
  color: '#f8fafc',
  padding: '12px 14px',
  outline: 'none'
} as const;

const buttonStyle = {
  border: '1px solid #38bdf8',
  borderRadius: 12,
  background: '#38bdf8',
  color: '#061018',
  padding: '12px 14px',
  fontWeight: 900,
  cursor: 'pointer'
} as const;
