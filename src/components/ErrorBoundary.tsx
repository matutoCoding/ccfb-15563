import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('BrickForge render error', error, info);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 32, background: '#f4f6fb', fontFamily: 'system-ui, Microsoft YaHei, sans-serif' }}>
          <div style={{ maxWidth: 720, background: '#fff', border: '1px solid #e4e8f1', borderRadius: 24, padding: 32, boxShadow: '0 18px 50px rgba(25,39,70,.12)' }}>
            <h1 style={{ marginTop: 0 }}>工作台遇到一个渲染问题</h1>
            <p style={{ color: '#667085', lineHeight: 1.7 }}>
              工程数据通常仍保留在本地。可以刷新重试；若问题出现在三维预览，请使用最新版 Chrome/Edge 并确认已开启硬件加速。
            </p>
            <pre style={{ whiteSpace: 'pre-wrap', background: '#111827', color: '#e5e7eb', padding: 16, borderRadius: 14, fontSize: 12 }}>
              {this.state.error.message}
            </pre>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                style={{ border: 0, borderRadius: 12, padding: '10px 16px', fontWeight: 800, color: '#fff', background: 'linear-gradient(135deg,#e23b2e,#ff8a18)' }}
                onClick={() => location.reload()}
              >
                刷新工作台
              </button>
              <button
                style={{ border: '1px solid #e4e8f1', borderRadius: 12, padding: '10px 16px', fontWeight: 800, background: '#fff' }}
                onClick={() => { localStorage.clear(); location.reload(); }}
              >
                清空缓存并刷新
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
