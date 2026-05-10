export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { sharedSurface } from '../_components/top-nav';
import { newWindowLinkProps } from '../_components/studio-ui';
import { QuickLink } from '../_components/ui';
import { WorkspaceShell } from '../_components/workspace-shell';
import { getQualityReviews, getScripts, getTopics, getTutorials, getVideoProjects, getVideoRuntimeStatus } from '@/lib/queries';

const shell = sharedSurface;
const pageBg = 'radial-gradient(circle at top left, rgba(56,189,248,0.14) 0%, transparent 24%), radial-gradient(circle at top right, rgba(244,114,182,0.10) 0%, transparent 20%), linear-gradient(180deg, #050816 0%, #0b1120 100%)';

export default async function LaunchChecklistPage() {
  const [tutorials, topics, scripts, videoProjects, runtimeStatus, qualityReviews] = await Promise.all([
    getTutorials(),
    getTopics(),
    getScripts(),
    getVideoProjects(),
    getVideoRuntimeStatus(),
    getQualityReviews()
  ]);

  const parsedCount = tutorials.filter((item) => item.status === 'parsed').length;
  const failedProjects = videoProjects.filter((item) => item.status === 'failed');
  const completedProjects = videoProjects.filter((item) => item.status === 'completed');
  const publishableProjects = videoProjects.filter((item) => item.publishTier === 'publishable');
  const blockedProjects = videoProjects.filter((item) => item.publishTier === 'blocked');
  const reviewedProjectIds = new Set(qualityReviews.map((item) => item.projectId));
  const completedReviewedCount = completedProjects.filter((item) => reviewedProjectIds.has(item.id)).length;
  const scriptsWithoutProjects = scripts.filter((script) => !videoProjects.some((project) => project.scriptId === script.id));

  const checks = [
    {
      title: '运行环境已就绪',
      ok: runtimeStatus.openaiConfigured && runtimeStatus.ffmpegInstalled,
      detail: `OpenAI ${runtimeStatus.openaiConfigured ? '已配置' : '未配置'} / ffmpeg ${runtimeStatus.ffmpegInstalled ? '可用' : '未安装'}`,
      href: '/probe'
    },
    {
      title: '教程已基本完成解析',
      ok: tutorials.length === 0 ? true : parsedCount / tutorials.length >= 0.8,
      detail: `${parsedCount}/${tutorials.length} 份教程已解析`,
      href: '/'
    },
    {
      title: '脚本池可继续供给视频生产',
      ok: scripts.length > 0,
      detail: `${scripts.length} 条脚本，其中 ${scriptsWithoutProjects.length} 条尚未建项目`,
      href: '/scripts'
    },
    {
      title: '至少已有一批可发布项目',
      ok: publishableProjects.length >= 1,
      detail: `当前可发布项目 ${publishableProjects.length} 个`,
      href: '/videos?view=publishable'
    },
    {
      title: '阻塞项目没有明显堆积',
      ok: blockedProjects.length <= Math.max(3, Math.ceil(videoProjects.length * 0.3)),
      detail: `当前阻塞项目 ${blockedProjects.length} 个 / 总项目 ${videoProjects.length} 个`,
      href: '/videos?view=blocked'
    },
    {
      title: '失败项目数量可控',
      ok: failedProjects.length <= Math.max(2, Math.ceil(videoProjects.length * 0.2)),
      detail: `当前失败项目 ${failedProjects.length} 个`,
      href: '/videos?view=failed'
    },
    {
      title: '成片做过抽样质检',
      ok: completedProjects.length === 0 ? true : completedReviewedCount / completedProjects.length >= 0.5,
      detail: `已质检成片 ${completedReviewedCount}/${completedProjects.length} 个`,
      href: '/videos?view=review'
    },
    {
      title: '团队可查看操作手册',
      ok: true,
      detail: '已内置系统手册与角色快捷入口',
      href: '/handbook'
    }
  ];

  const okCount = checks.filter((item) => item.ok).length;
  const readiness = Math.round((okCount / checks.length) * 100);
  const readinessLabel = readiness >= 85 ? '可以正式上线' : readiness >= 60 ? '建议先做一轮内部试运行' : '暂不建议上线';

  return (
    <WorkspaceShell active="launch" badge="上线前检查清单" maxWidth={1240} background={pageBg}>
        <section style={{ ...shell, padding: 26, display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: 18 }}>
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ color: '#818cf8', fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase' }}>Launch Readiness</div>
            <h1 style={{ margin: 0, fontSize: 'clamp(34px, 5vw, 56px)', lineHeight: 1.02 }}>上线前检查清单</h1>
            <p style={{ margin: 0, color: '#cbd5e1', lineHeight: 1.9, maxWidth: 860 }}>
              这个页面只解决一个问题：今天如果要让团队正式开始使用，是否已经准备好。不要凭感觉判断，直接按下面的检查项看是否通过。
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <QuickLink href="/" text="回到首页" />
              <QuickLink href="/handbook" text="查看团队手册" />
              <QuickLink href="/videos" text="去视频工厂" />
            </div>
          </div>

          <div style={{ borderRadius: 22, padding: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.14)', display: 'grid', gap: 10 }}>
            <div style={{ color: readiness >= 85 ? '#86efac' : readiness >= 60 ? '#fde68a' : '#fecaca', fontSize: 40, fontWeight: 800 }}>{readiness}%</div>
            <div style={{ color: '#f8fafc', fontSize: 22, fontWeight: 700 }}>{readinessLabel}</div>
            <div style={{ color: '#94a3b8', lineHeight: 1.8 }}>通过项 {okCount}/{checks.length}。如果有未通过项，优先处理环境、失败堆积和质检覆盖问题。</div>
          </div>
        </section>

        <Panel title="检查结果">
          <div style={{ display: 'grid', gap: 12 }}>
            {checks.map((item) => (
              <div key={item.title} style={{ borderRadius: 18, padding: 16, background: 'rgba(255,255,255,0.03)', border: `1px solid ${item.ok ? 'rgba(134,239,172,0.28)' : 'rgba(252,165,165,0.28)'}`, display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <strong>{item.title}</strong>
                    <span style={{ padding: '6px 10px', borderRadius: 999, color: item.ok ? '#86efac' : '#fecaca', background: item.ok ? 'rgba(20,83,45,0.24)' : 'rgba(127,29,29,0.24)', fontSize: 12 }}>{item.ok ? '通过' : '未通过'}</span>
                  </div>
                  <div style={{ color: '#94a3b8', lineHeight: 1.7 }}>{item.detail}</div>
                </div>
                <Link href={item.href} {...newWindowLinkProps} style={{ color: item.ok ? '#86efac' : '#67e8f9', textDecoration: 'none', fontWeight: 700 }}>去处理 →</Link>
              </div>
            ))}
          </div>
        </Panel>

        <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <Panel title="上线前建议动作">
            <OrderedList items={[
              '先确认环境通过，避免团队一上来就遇到配置问题。',
              '优先处理失败项目和阻塞项目，不要把问题带进正式使用。',
              '至少准备一批可发布项目，避免系统上线后没有交付成果。',
              '确保团队成员都能从手册页找到自己的工作入口。'
            ]} />
          </Panel>

          <Panel title="如果暂不建议上线，先做什么">
            <OrderedList items={[
              '去环境页确认 OpenAI 与 ffmpeg。',
              '去视频工厂清理 failed / blocked 堆积。',
              '去脚本工作台补齐待推进脚本。',
              '做一轮抽样质检，避免 completed 但质量未知。'
            ]} />
          </Panel>
        </section>
    </WorkspaceShell>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section style={{ ...shell, padding: 20, display: 'grid', gap: 14 }}><h2 style={{ margin: 0, fontSize: 24 }}>{title}</h2>{children}</section>;
}

function OrderedList({ items }: { items: string[] }) {
  return <ol style={{ margin: 0, paddingLeft: 20, color: '#dbe4f3', lineHeight: 1.9, display: 'grid', gap: 8 }}>{items.map((item) => <li key={item}>{item}</li>)}</ol>;
}
