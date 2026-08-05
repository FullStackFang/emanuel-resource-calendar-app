import { createRoot } from 'react-dom/client';
import './styles/design-tokens.css';
import LoadingSpinner from './components/shared/LoadingSpinner';
import RoseSpinner from './components/shared/RoseSpinner';

const box = { border: '1px solid #e7e5e4', borderRadius: 10, background: '#fff', padding: 24 };
const row = { display: 'flex', gap: 34, alignItems: 'center', flexWrap: 'wrap' };

const Btn = ({ dark, children }) => (
  <button
    style={{
      display: 'inline-flex', alignItems: 'center', gap: 9, fontSize: 14, fontWeight: 500,
      padding: '10px 18px', borderRadius: 7, fontFamily: 'DM Sans, sans-serif',
      background: dark ? '#fff' : '#3b6eb8', color: dark ? '#1c1917' : '#fff',
      border: dark ? '1px solid #d6d3d1' : '1px solid transparent',
    }}
  >
    <span className={`btn-spinner${dark ? ' dark' : ''}`} />
    {children}
  </button>
);

createRoot(document.getElementById('root')).render(
  <div style={{ fontFamily: 'DM Sans, sans-serif', background: '#fafaf9', padding: 40, display: 'grid', gap: 26 }}>
    <div style={box} id="sizes">
      <div style={row}>
        {[64, 48, 40, 36, 32, 28, 20, 14].map((s) => (
          <div key={s} style={{ textAlign: 'center', fontSize: 11, color: '#78716c' }}>
            <div style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <RoseSpinner size={s} />
            </div>
            {s}px
          </div>
        ))}
      </div>
    </div>

    <div style={box} id="buttons">
      <div style={row}>
        <Btn>Publishing…</Btn>
        <Btn dark>Saving…</Btn>
      </div>
    </div>

    <div style={{ ...box, position: 'relative', minHeight: 170 }} id="variants">
      <LoadingSpinner variant="default" size={48} text="Loading reservations…" />
    </div>

    <div style={{ ...box, background: '#fafaf9' }} id="cardv">
      <LoadingSpinner variant="card" size={48} text="Loading event…" />
    </div>
  </div>
);
