'use client';

import { useEffect, useState } from 'react';

const shell = {
  borderRadius: 24,
  border: '1px solid rgba(148,163,184,0.14)',
  background: 'linear-gradient(180deg, rgba(15,23,42,0.9) 0%, rgba(6,10,18,0.96) 100%)'
} as const;

type ProbePayload = {
  ok: boolean;
  source: string;
  timestamp: string;
  runtime: {
    openaiConfigured: boolean;
    minimaxConfigured: boolean;
    ffmpegInstalled: boolean;
    ffmpegCommand: string;
    remotionDependenciesInstalled: boolean;
    dataDirectoryWritable: boolean;
    generatedDirectoryWritable: boolean;
    importsDirectoryWritable: boolean;
    appRoot: string;
    dataRoot: string;
    generatedRoot: string;
    importsRoot: string;
    platform: string;
    arch: string;
    nodeVersion: string;
  };
  env: {
    openaiConfigured: boolean;
    openaiBaseUrl: string;
    minimaxConfigured: boolean;
    minimaxHost: string;
  };
};

export function ProbeClientPanel() {
  const [payload, setPayload] = useState<ProbePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        setError('');
        const response = await fetch('/api/probe', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || '环境探针请求失败');
        }
        if (active) setPayload(data);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : '环境探针请求失败');
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
        <ProbeCard title="页面可达" value={loading ? '...' : error ? '异常' : '正常'} desc="当前页面已成功加载，说明前端路由本身可访问。" tone={loading ? '#fde68a' : error ? '#fecaca' : '#67e8f9'} />
        <ProbeCard title="API 可达" value={loading ? '...' : error ? '失败' : '成功'} desc="首页和其它工作台依赖的基础接口调用能力。" tone={loading ? '#fde68a' : error ? '#fecaca' : '#86efac'} />
        <ProbeCard title="Remotion 主链路" value={payload?.runtime.remotionDependenciesInstalled ? '可用' : loading ? '...' : '待检查'} desc="渲染任务现在优先走 Remotion renderer，而不是旧 ffmpeg concat。" tone={payload?.runtime.remotionDependenciesInstalled ? '#c4b5fd' : '#fde68a'} />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ ...shell, padding: 20 }}>
          <Header title="当前探针结果" tag="Runtime Snapshot" />
          {loading ? <EmptyState text="正在检查当前环境，请稍等..." /> : error ? <ErrorState text={error} /> : payload ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <ResultRow label="接口来源" value={payload.source} />
              <ResultRow label="探测时间" value={new Date(payload.timestamp).toLocaleString('zh-CN', { hour12: false })} />
              <ResultRow label="系统平台" value={`${payload.runtime.platform} / ${payload.runtime.arch}`} />
              <ResultRow label="Node 版本" value={payload.runtime.nodeVersion} />
              <ResultRow label="应用根目录" value={payload.runtime.appRoot} />
              <ResultRow label="数据根目录" value={payload.runtime.dataRoot} />
              <ResultRow label="数据目录可写" value={payload.runtime.dataDirectoryWritable ? '可写' : '不可写'} />
              <ResultRow label="生成目录" value={payload.runtime.generatedRoot} />
              <ResultRow label="生成目录可写" value={payload.runtime.generatedDirectoryWritable ? '可写' : '不可写'} />
              <ResultRow label="导入归档目录" value={payload.runtime.importsRoot} />
              <ResultRow label="导入归档可写" value={payload.runtime.importsDirectoryWritable ? '可写' : '不可写'} />
              <ResultRow label="Remotion 依赖" value={payload.runtime.remotionDependenciesInstalled ? '可解析' : '不可解析'} />
              <ResultRow label="OpenAI Base URL" value={payload.env.openaiBaseUrl} />
              <ResultRow label="OpenAI Key" value={payload.env.openaiConfigured ? '已配置' : '未配置'} />
              <ResultRow label="MiniMax Host" value={payload.env.minimaxHost} />
              <ResultRow label="MiniMax Key" value={payload.env.minimaxConfigured ? '已配置' : '未配置'} />
              <ResultRow label="ffmpeg 命令" value={payload.runtime.ffmpegCommand} />
              <ResultRow label="旧 ffmpeg 探针" value={payload.runtime.ffmpegInstalled ? '已安装' : '未安装'} />
            </div>
          ) : null}
        </div>

        <div style={{ ...shell, padding: 20 }}>
          <Header title="下一步建议" tag="What To Do Next" />
          <div style={{ display: 'grid', gap: 10 }}>
            {error ? <Suggestion title="先修复探针接口" desc="当前连基础探针接口都异常，建议先看日志或 API 路由状态。" /> : null}
            <Suggestion title="优先确认 Node 版本" desc="项目建议使用 Node 22 LTS；Node 24 当前可运行，但 Next 14 构建需要禁用 build worker 来规避 manifest 竞态。" />
            <Suggestion title="确认数据目录可写" desc="正式放到 Mac 或 Windows 运行时，建议通过 VIDEO_FACTORY_DATA_ROOT 指向用户数据目录，避免把数据库和导入文件写进应用安装目录。" />
            <Suggestion title="确认生成目录可写" desc="如果生成目录不可写，视频、音频、字幕和 Remotion 输入文件都会失败；Windows 安装目录尤其要注意权限。" />
            <Suggestion title="ffmpeg 是旧链路能力" desc="主链路已经走 Remotion；ffmpeg 主要用于旧 fallback，可通过 FFMPEG_PATH 指定自定义路径。" />
          </div>
        </div>
      </section>
    </>
  );
}

function Header({ title, tag }: { title: string; tag: string }) {
  return <div style={{ marginBottom: 14 }}><div style={{ color: '#818cf8', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase' }}>{tag}</div><h2 style={{ margin: '8px 0 0', fontSize: 28 }}>{title}</h2></div>;
}
function ProbeCard({ title, value, desc, tone }: { title: string; value: string; desc: string; tone: string }) {
  return <div style={{ ...shell, padding: 20 }}><div style={{ width: 42, height: 4, borderRadius: 999, background: tone, boxShadow: `0 0 18px ${tone}` }} /><div style={{ marginTop: 14, color: '#8a95aa', fontSize: 13 }}>{title}</div><div style={{ marginTop: 8, fontSize: 34, fontWeight: 800 }}>{value}</div><div style={{ marginTop: 8, color: '#c8d1de', lineHeight: 1.7 }}>{desc}</div></div>;
}
function ResultRow({ label, value }: { label: string; value: string }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderRadius: 16, background: 'rgba(255,255,255,0.035)' }}><span style={{ color: '#c0cad8' }}>{label}</span><span style={{ color: '#eef2ff', textAlign: 'right' }}>{value}</span></div>;
}
function Suggestion({ title, desc }: { title: string; desc: string }) {
  return <div style={{ borderRadius: 16, padding: 14, background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(148,163,184,0.12)' }}><div style={{ fontWeight: 700 }}>{title}</div><div style={{ marginTop: 6, color: '#cbd5e1', lineHeight: 1.75 }}>{desc}</div></div>;
}
function EmptyState({ text }: { text: string }) {
  return <div style={{ borderRadius: 16, padding: 16, color: '#cbd5e1', background: 'rgba(255,255,255,0.035)' }}>{text}</div>;
}
function ErrorState({ text }: { text: string }) {
  return <div style={{ borderRadius: 16, padding: 16, color: '#fecaca', background: 'rgba(127,29,29,0.26)', border: '1px solid rgba(248,113,113,0.24)' }}>{text}</div>;
}
