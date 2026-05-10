export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StudioShell } from '../../_components/studio-shell';
import { EmptyGuide, linkButtonStyle, MetricTile, newWindowLinkProps, Panel, SectionTitle, StatusBadge, subtlePanelStyle } from '../../_components/studio-ui';
import { getScripts, getTopics, getTutorials, getVideoProjects } from '@/lib/queries';
import { sanitizeScriptBlock } from '@/lib/narration';
import { ScriptEditor } from './script-editor';
import { ScriptDetailActions } from './script-detail-actions';

export default async function ScriptDetailPage({ params }: { params: { id: string } }) {
  const [scripts, topics, tutorials, videoProjects] = await Promise.all([
    getScripts(),
    getTopics(),
    getTutorials(),
    getVideoProjects()
  ]);

  const script = scripts.find((item) => item.id === params.id);
  if (!script) notFound();

  const topic = topics.find((item) => item.id === script.topicId);
  const tutorial = tutorials.find((item) => item.id === script.tutorialId);
  const relatedProjects = videoProjects.filter((item) => item.scriptId === script.id);
  const displayHook = sanitizeScriptBlock(script.hook);
  const displayBody = sanitizeScriptBlock(script.body);
  const displayCta = sanitizeScriptBlock(script.cta);
  const scriptCharCount = `${displayHook}${displayBody}${displayCta}`.replace(/\s+/g, '').length;

  return (
    <StudioShell
      active="scripts"
      title="查看和修改脚本"
      subtitle="这里先只保留生成视频前最需要看的内容。版本、审计和更多后台信息先收起来，避免打断修改。"
      action={<Link href="/" {...newWindowLinkProps} style={linkButtonStyle('secondary')}>回到开始制作</Link>}
    >
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 }}>
        <MetricTile label="来源文档" value={tutorial ? '已关联' : '未知'} note={tutorial?.title || '未找到来源'} />
        <MetricTile label="内容要点" value={topic ? '已生成' : '未知'} note={topic?.title || '未找到要点'} tone="#38bdf8" />
        <MetricTile label="脚本版本" value={`v${script.version || 1}`} note={script.sourceScriptId ? '复制版本' : '原始版本'} tone="#a78bfa" />
        <MetricTile label="正文长度" value={`${scriptCharCount}`} note="按 Hook / 正文 / 结尾统计字符数" tone="#fbbf24" />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 330px', gap: 16, alignItems: 'start' }}>
        <Panel style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start', flexWrap: 'wrap' }}>
            <SectionTitle title={script.title} note="你可以先快速检查脚本，再决定保存修改或生成视频。" />
            <StatusBadge text="智能讲解脚本" tone="info" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <ScriptBlock title="开场" text={displayHook} />
            <ScriptBlock title="正文" text={displayBody} />
            <ScriptBlock title="结尾" text={displayCta} />
          </div>

          <section style={{ display: 'grid', gap: 12 }}>
            <SectionTitle title="生成说明" note="当前页只确认脚本文案，不再展示本地自动拆镜草稿。" />
            <div style={{ ...subtlePanelStyle, borderRadius: 20, padding: 14, display: 'grid', gap: 8 }}>
              <strong style={{ color: '#e5ecf7' }}>真实分镜会在创建视频项目后生成</strong>
              <div style={{ color: '#cbd5e1', lineHeight: 1.75 }}>
                点击下方“用当前脚本生成视频”后，系统会直接进入视频项目创建，并由 OpenAI 整片规划 storyboard 与模板预览。
              </div>
              <div style={{ color: '#7dd3fc', lineHeight: 1.7 }}>
                这里不再使用本地一句一镜的 shot breakdown，避免它干扰你对最终视频质量的判断。
              </div>
            </div>
          </section>

          <div style={{ borderTop: '1px solid #263244', paddingTop: 16 }}>
            <SectionTitle title="修改脚本" note="修改后保存，再用当前脚本生成新视频或更新已有视频。" />
            <div style={{ marginTop: 14 }}>
              <ScriptEditor
                scriptId={script.id}
                initialTitle={script.title}
                initialHook={displayHook}
                initialBody={displayBody}
                initialCta={displayCta}
                initialStyle={script.style}
              />
            </div>
          </div>
        </Panel>

        <aside style={{ display: 'grid', gap: 14 }}>
          <Panel style={{ display: 'grid', gap: 14 }}>
            <SectionTitle title="下一步" note="新用户只需要关注这几个操作。" />
            <ScriptDetailActions scriptId={script.id} projectIds={relatedProjects.map((project) => project.id)} />
          </Panel>

          <Panel style={{ display: 'grid', gap: 12 }}>
            <SectionTitle title="来源" />
            {tutorial ? (
              <Link href={`/tutorials/${tutorial.id}`} {...newWindowLinkProps} style={{ ...subtlePanelStyle, padding: 12, color: 'inherit', textDecoration: 'none', display: 'grid', gap: 6 }}>
                <strong>{tutorial.title}</strong>
                <span style={{ color: '#94a3b8', lineHeight: 1.5 }}>{tutorial.summary || '打开查看文档解析内容。'}</span>
              </Link>
            ) : <EmptyGuide title="没有来源文档" text="这个脚本没有找到关联文档。" />}
            {topic ? (
              <div style={{ ...subtlePanelStyle, padding: 12, display: 'grid', gap: 6 }}>
                <strong>内容要点</strong>
                <span style={{ color: '#94a3b8', lineHeight: 1.5 }}>{topic.title}</span>
              </div>
            ) : null}
          </Panel>

          <Panel style={{ display: 'grid', gap: 12 }}>
            <SectionTitle title="关联视频" />
            {relatedProjects.length ? relatedProjects.map((project) => (
              <Link key={project.id} href={`/videos/${project.id}`} {...newWindowLinkProps} style={{ ...subtlePanelStyle, padding: 12, color: 'inherit', textDecoration: 'none', display: 'grid', gap: 6 }}>
                <strong>{project.title}</strong>
                <span style={{ color: '#94a3b8' }}>状态：{formatProjectStatus(project.status)}</span>
              </Link>
            )) : <EmptyGuide title="还没有视频" text="点击“用当前脚本生成视频”创建第一条视频。" />}
          </Panel>
        </aside>
      </section>
    </StudioShell>
  );
}

function ScriptBlock({ title, text }: { title: string; text: string }) {
  return (
    <div style={{ ...subtlePanelStyle, padding: 14, display: 'grid', gap: 8, alignContent: 'start' }}>
      <strong style={{ color: '#7dd3fc' }}>{title}</strong>
      <div style={{ color: '#dbe4f3', lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>{text}</div>
    </div>
  );
}

function formatProjectStatus(status: string) {
  const labels: Record<string, string> = {
    draft: '未开始生成',
    storyboarded: '未开始生成',
    rendering: '制作中',
    completed: '已完成',
    failed: '需要处理'
  };
  return labels[status] || status;
}
