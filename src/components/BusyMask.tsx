import { useStore } from '../state/store';

export function BusyMask() {
  const busy = useStore((s) => s.busy);
  if (!busy) return null;
  return (
    <div className="busy-mask">
      <div className="busy-box">
        <div className="spinner" />
        <div>{busy}</div>
      </div>
    </div>
  );
}
