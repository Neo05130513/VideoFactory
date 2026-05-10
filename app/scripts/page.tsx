export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { StudioShell } from '../_components/studio-shell';
import { linkButtonStyle, MetricTile, newWindowLinkProps } from '../_components/studio-ui';
import { getScripts, getTutorials, getVideoProjects } from '@/lib/queries';
import { ScriptsPageClient } from './scripts-page-client';

export default async function ScriptsPage() {
  const [scripts, tutorials, projects] = await Promise.all([
    getScripts(),
    getTutorials(),
    getVideoProjects()
  ]);

  const scriptsWithVideo = scripts.filter((script) => projects.some((project) => project.scriptId === script.id));
  const scriptsWithoutVideo = scripts.filter((script) => !projects.some((project) => project.scriptId === script.id));

  return (
    <StudioShell
      active="scripts"
      title="脚本"
      subtitle="这里保持简单：看脚本、改脚本、把脚本继续生成视频。复杂的版本对比和后台信息先不展示。"
      action={<Link href="/" {...newWindowLinkProps} style={linkButtonStyle('primary')}>回到开始制作</Link>}
    >
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 }}>
        <MetricTile label="全部脚本" value={`${scripts.length}`} note="已生成内容" />
        <MetricTile label="未生成视频" value={`${scriptsWithoutVideo.length}`} note="下一步优先处理" tone="#fbbf24" />
        <MetricTile label="已有视频" value={`${scriptsWithVideo.length}`} note="可继续修改" tone="#34d399" />
        <MetricTile label="来源文档" value={`${new Set(scripts.map((script) => script.tutorialId)).size}`} note="覆盖资料" tone="#38bdf8" />
      </section>
      <ScriptsPageClient initialScripts={scripts} tutorials={tutorials} projects={projects} />
    </StudioShell>
  );
}
