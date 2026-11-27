import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { parseOBJ, parseMTL } from '../core/objParser';
import { parseGLTF, type GltfExternals } from '../core/gltfParser';
import { createCatMesh, createHouseMesh } from '../core/procedural';
import { meshBounds, triangleCount, type TriangleMesh } from '../core/mesh';
import { convertMesh } from '../services/convert';
import type { Order } from '../order';

interface LoadedMesh {
  mesh: TriangleMesh;
  label: string;
  info: string;
}

export function ImportPage() {
  const orders = useStore((s) => s.orders);
  const currentId = useStore((s) => s.currentId);
  const selectOrder = useStore((s) => s.selectOrder);
  const setBusy = useStore((s) => s.setBusy);
  const [loaded, setLoaded] = useState<LoadedMesh | null>(null);
  const [error, setError] = useState('');
  const nav = useNavigate();
  const order = orders.find((o) => o.id === currentId) ?? null;

  const ensureOrder = (): Order | null => {
    if (order) return order;
    setError('请先在订单列表选择或新建一个订单');
    return null;
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const o = ensureOrder();
    if (!o) return;
    setError('');
    setBusy('解析模型文件…');
    try {
      const list = [...files];
      const objFile = list.find((f) => f.name.toLowerCase().endsWith('.obj'));
      const glbFile = list.find((f) => /\.(glb|gltf)$/.test(f.name.toLowerCase()));
      if (objFile) {
        const text = await objFile.text();
        const mtlFile = list.find((f) => f.name.toLowerCase().endsWith('.mtl'));
        const mtl = mtlFile ? parseMTL(await mtlFile.text()) : undefined;
        const imgFile = list.find((f) => /\.(png|jpe?g)$/.test(f.name.toLowerCase()));
        const image = imgFile ? await toImageData(imgFile) : undefined;
        const mesh = parseOBJ(text, mtl, image);
        finish(mesh, objFile.name);
      } else if (glbFile) {
        const ext: GltfExternals = { buffers: new Map(), images: new Map() };
        for (const f of list) {
          if (f.name === glbFile.name) continue;
          if (/\.(bin|glbuf)$/.test(f.name)) ext.buffers!.set(f.name, await f.arrayBuffer());
          if (/\.(png|jpe?g)$/.test(f.name)) ext.images!.set(f.name, await toImageData(f));
        }
        const mesh = glbFile.name.toLowerCase().endsWith('.glb')
          ? await parseGLTF(await glbFile.arrayBuffer(), ext)
          : await parseGLTF(await glbFile.text(), ext);
        finish(mesh, glbFile.name);
      } else {
        setError('请选择 .obj(可带 .mtl/贴图)或 .glb/.gltf 文件,相关贴图与 .bin 请一起选择');
      }
    } catch (e) {
      setError(`解析失败:${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const finish = (mesh: TriangleMesh, label: string) => {
    const b = meshBounds(mesh);
    const info = `${triangleCount(mesh)} 个三角形 · 包围盒 ${fmt(b.max.x - b.min.x)} × ${fmt(b.max.y - b.min.y)} × ${fmt(b.max.z - b.min.z)} · 顶点色 ${mesh.vertexColors ? '有' : '无'} · 贴图 ${mesh.albedo ? '有' : '无'}`;
    setLoaded({ mesh, label, info });
  };

  const useProcedural = async (kind: 'cat' | 'house') => {
    const o = ensureOrder();
    if (!o) return;
    const mesh = kind === 'cat' ? createCatMesh() : createHouseMesh();
    finish(mesh, kind === 'cat' ? '程序化坐姿猫' : '程序化小房子');
  };

  const startConvert = async () => {
    const o = ensureOrder();
    if (!loaded || !o) return;
    const source = loaded.label.startsWith('程序化')
      ? { kind: loaded.label.includes('猫') ? 'cat' as const : 'house' as const }
      : { kind: 'upload' as const, fileName: loaded.label };
    await convertMesh(o.id, loaded.mesh, source);
    selectOrder(o.id);
    nav('/voxel');
  };

  return (
    <div>
      <h2 className="page-title">模型导入</h2>
      <p className="page-sub">
        当前订单:{order ? `「${order.name}」` : '未选择'}。支持 OBJ(含 MTL/贴图)与 glTF/GLB,无模型时可直接生成猫和房子
      </p>

      <div className="grid cols-2">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>上传客户模型</h3>
          <input type="file" multiple accept=".obj,.mtl,.glb,.gltf,.bin,.png,.jpg,.jpeg"
            onChange={(e) => onFiles(e.target.files)} />
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            多选把 OBJ + MTL + 贴图,或 glTF + .bin + 贴图一起选中。单位会按颗粒尺寸自动归一。
          </p>
          {error && <div className="issue floating">{error}</div>}
          {loaded && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 600 }}>✓ {loaded.label}</div>
              <div className="muted" style={{ fontSize: 12, margin: '6px 0 14px' }}>{loaded.info}</div>
              <button onClick={startConvert}>开始体素化转换 →</button>
            </div>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>没有模型?程序化生成</h3>
          <p className="muted" style={{ fontSize: 12 }}>内置两只封闭、可直接生产的样件,走完整条转换管线。</p>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="ghost" onClick={() => useProcedural('cat')}>🐱 生成坐姿猫</button>
            <button className="ghost" onClick={() => useProcedural('house')}>🏠 生成小房子</button>
          </div>
          {loaded?.label.includes('程序化') && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 600 }}>✓ {loaded.label}</div>
              <div className="muted" style={{ fontSize: 12, margin: '6px 0 14px' }}>{loaded.info}</div>
              <button onClick={startConvert}>开始体素化转换 →</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

async function toImageData(file: File): Promise<ImageData> {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

function fmt(n: number) { return n.toFixed(2); }
