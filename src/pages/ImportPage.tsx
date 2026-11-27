import { useRef, useState } from 'react';
import { useStudio } from '../state/store';
import { Badge, Button, Card, EmptyState } from '../components/ui';
import { loadModelFiles } from '../lib/modelLoader';
import { runConversion } from '../lib/pipeline';
import type { Project } from '../types';
import { formatNumber } from '../lib/utils';

export default function ImportPage() {
  const { currentOrder, currentProject, saveProject, setSource, getSource, setPage, setBusy, busy } = useStudio();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedInfo, setLoadedInfo] = useState(() => {
    const s = currentProject ? getSource(currentProject.id) : null;
    return s ? { name: s.fileName, triangles: s.triangleCount, meshes: s.meshCount, textures: s.textureNames } : null;
  });

  if (!currentOrder || !currentProject) {
    return (
      <EmptyState
        icon="📁"
        title="请先选择或创建一个订单"
        description="订单和工程一一对应；可以从订单列表打开示例工程。"
        action={<Button variant="primary" onClick={() => setPage('orders')}>前往订单列表</Button>}
      />
    );
  }

  const project = currentProject;

  const handleFiles = async (files: File[] | null) => {
    if (!files?.length) return;
    setError(null);
    setBusy('正在读取 OBJ/glTF、材质和贴图…');
    try {
      const source = await loadModelFiles(files);
      setSource(project.id, source);
      const updated: Project = {
        ...project,
        sourceKind: source.kind,
        sourceFileName: source.fileName,
        sourceTextureNames: source.textureNames,
      };
      saveProject(updated);
      setLoadedInfo({
        name: source.fileName,
        triangles: source.triangleCount,
        meshes: source.meshCount,
        textures: source.textureNames,
      });
    } catch (err) {
      console.error(err);
      setError((err as Error).message);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const generate = async (kind: 'cat' | 'house') => {
    setError(null);
    setBusy(kind === 'cat' ? '正在生成坐姿猫并转换…' : '正在生成小房子并转换…');
    try {
      const base: Project = { ...project, sourceKind: kind, sourceFileName: undefined };
      const result = await runConversion(base, null);
      saveProject({ ...base, ...result });
      setPage('voxel');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const source = getSource(project.id);
  const textureUrl = source?.texture ? pixelsToDataUrl(source.texture.rgba, source.texture.width, source.texture.height) : null;

  return (
    <div className="page import-page">
      <div className="page-title-row">
        <div>
          <p className="eyebrow">MODEL IMPORT</p>
          <h1>模型导入</h1>
          <p className="page-desc">支持 OBJ 多文件（.obj/.mtl/.png）和带贴图的 glTF/GLB；不上传服务器，全部在浏览器内处理。</p>
        </div>
        <div className="actions">
          <Button onClick={() => setPage('orders')}>返回订单</Button>
          <Button variant="primary" disabled={!project.grid} onClick={() => setPage('voxel')}>去体素化 →</Button>
        </div>
      </div>

      <div className="two-col">
        <Card title="导入客户模型" subtitle="可一次选中模型、材质和所有贴图文件">
          <div
            className={`dropzone ${drag ? 'drag' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              void handleFiles([...e.dataTransfer.files]);
            }}
          >
            <div className="drop-icon">📦</div>
            <h3>拖入 OBJ / glTF / GLB</h3>
            <p>OBJ 建议同时选择 .mtl 与贴图；glTF 可连同 .bin、图片一起选择，GLB 可直接导入。</p>
            <Button variant="primary" onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}>选择文件</Button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".obj,.mtl,.gltf,.glb,.bin,.png,.jpg,.jpeg,.webp,.bmp"
              hidden
              onChange={(e) => void handleFiles(e.target.files ? [...e.target.files] : null)}
            />
          </div>
          {error && <div className="inline-error">⚠️ {error}</div>}
          {busy && <div className="inline-info">⏳ {busy}</div>}

          <div className="format-grid">
            <div><Badge tone="accent">OBJ</Badge><p>几何 + MTL + UV 贴图采样</p></div>
            <div><Badge tone="accent">glTF 2.0</Badge><p>.gltf + .bin + 图片资源</p></div>
            <div><Badge tone="good">GLB</Badge><p>二进制单文件最稳妥</p></div>
          </div>
        </Card>

        <Card title="没有模型？程序生成" subtitle="用于打样、演示和流程测试">
          <div className="template-cards">
            <button className="template-card cat" onClick={() => void generate('cat')} disabled={!!busy}>
              <span className="template-emoji">🐱</span>
              <h3>坐着的猫</h3>
              <p>身体、头部、耳朵、尾巴和坐姿四肢，自动加厚壳与支撑。</p>
              <Badge tone="good">一键生成并转换</Badge>
            </button>
            <button className="template-card house" onClick={() => void generate('house')} disabled={!!busy}>
              <span className="template-emoji">🏠</span>
              <h3>小房子</h3>
              <p>厚墙、阶梯屋顶、门窗、烟囱，适合验证层间交错。</p>
              <Badge tone="good">一键生成并转换</Badge>
            </button>
          </div>
        </Card>
      </div>

      <Card title="当前模型资料" subtitle="贴图颜色会在体素表面按 UV 烘焙，再量化到颗粒色卡">
        {loadedInfo ? (
          <div className="model-info">
            <div>
              <span>文件</span><b>{loadedInfo.name}</b>
            </div>
            <div><span>网格</span><b>{loadedInfo.meshes} 个</b></div>
            <div><span>三角面</span><b>{formatNumber(loadedInfo.triangles)}</b></div>
            <div><span>贴图</span><b>{loadedInfo.textures.length ? loadedInfo.textures.join('、') : '使用材质色'}</b></div>
            {textureUrl && <img className="texture-thumb" src={textureUrl} alt="漫反射贴图缩略图" />}
          </div>
        ) : (
          <EmptyState icon="🧩" title="尚未载入外部模型" description="可以选择文件，或点击右侧猫 / 房子模板。" />
        )}
      </Card>
    </div>
  );
}

function pixelsToDataUrl(rgba: Uint8Array, w: number, h: number): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const image = ctx.createImageData(w, h);
  image.data.set(rgba);
  ctx.putImageData(image, 0, 0);
  return c.toDataURL();
}
