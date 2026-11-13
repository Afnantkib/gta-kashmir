import { useMemo, useState, type FormEvent } from 'react';
import { Megaphone, X } from 'lucide-react';
import {
  AD_CATEGORIES,
  AD_LIMITS,
  AdCategory,
  Advertisement,
  adPalette,
  categoryLabel,
} from '../shared/advertisements.ts';

interface AdBoardProps {
  open: boolean;
  ads: Advertisement[];
  posterName: string;
  onClose: () => void;
  onList: (ads: Advertisement[]) => void;
}

export default function AdBoard({ open, ads, posterName, onClose, onList }: AdBoardProps) {
  const [filter, setFilter] = useState<AdCategory | 'all'>('all');
  const [brand, setBrand] = useState('');
  const [headline, setHeadline] = useState('');
  const [details, setDetails] = useState('');
  const [offer, setOffer] = useState('');
  const [category, setCategory] = useState<AdCategory>('shop');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const visible = useMemo(
    () => (filter === 'all' ? ads : ads.filter(ad => ad.category === filter)),
    [ads, filter]
  );

  if (!open) return null;

  const postAd = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/advertisements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, headline, details, offer, category, postedBy: posterName }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.message || 'Could not post that advertisement.');
        return;
      }
      onList(data.advertisements);
      setBrand('');
      setHeadline('');
      setDetails('');
      setOffer('');
      setFilter('all');
    } catch {
      setError('The listing board is offline.');
    } finally {
      setBusy(false);
    }
  };

  const takeDown = async (id: string) => {
    setError('');
    try {
      const res = await fetch(`/api/advertisements/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.message || 'Could not take that advertisement down.');
        return;
      }
      onList(data.advertisements);
    } catch {
      setError('The listing board is offline.');
    }
  };

  return (
    <div className="absolute inset-0 z-[70] flex items-end sm:items-center justify-center p-3 sm:p-6 bg-slate-950/70 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-amber-500/40 bg-slate-950/95 shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-slate-950">
              <Megaphone className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="font-['Outfit'] text-lg font-black tracking-wide text-amber-300">BOULEVARD ADVERTISEMENTS</h2>
              <p className="truncate text-xs text-slate-400">
                {ads.length} listings · painted on the Dal Lake promenade hoardings
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:bg-slate-800 hover:text-white"
            aria-label="Close advertisements"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
          <div className="flex min-h-0 flex-col border-b border-slate-800 lg:border-b-0 lg:border-r">
            <div className="flex gap-1.5 overflow-x-auto px-4 py-3">
              <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} label="All" />
              {AD_CATEGORIES.map(c => (
                <FilterChip key={c.id} active={filter === c.id} onClick={() => setFilter(c.id)} label={c.label} />
              ))}
            </div>
            <div className="min-h-[220px] flex-1 space-y-2 overflow-y-auto px-4 pb-4">
              {visible.length === 0 && (
                <p className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-400">
                  No advertisements in this category yet.
                </p>
              )}
              {visible.map(ad => {
                const colors = adPalette(ad.category);
                return (
                  <article key={ad.id} className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className="rounded px-1.5 py-0.5 text-[10px] font-black tracking-wider"
                            style={{ background: colors.accent, color: colors.ink }}
                          >
                            {categoryLabel(ad.category).toUpperCase()}
                          </span>
                          {ad.featured && (
                            <span className="text-[10px] font-bold tracking-wider text-amber-400">BOULEVARD</span>
                          )}
                        </div>
                        <h3 className="mt-1 font-['Outfit'] text-base font-black text-white">{ad.brand}</h3>
                        <p className="text-sm font-semibold text-amber-100">{ad.headline}</p>
                      </div>
                      {!ad.featured && (
                        <button
                          type="button"
                          onClick={() => takeDown(ad.id)}
                          className="shrink-0 text-[11px] font-bold text-slate-400 hover:text-rose-300"
                        >
                          Take down
                        </button>
                      )}
                    </div>
                    {ad.details && <p className="mt-1.5 text-sm leading-snug text-slate-300">{ad.details}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                      {ad.offer && <span className="font-bold text-amber-300">{ad.offer}</span>}
                      <span>Posted by {ad.postedBy}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <form onSubmit={postAd} className="flex flex-col gap-2.5 overflow-y-auto px-4 py-4">
            <div>
              <h3 className="font-['Outfit'] text-sm font-black tracking-wide text-white">POST A LISTING</h3>
              <p className="text-xs text-slate-400">It goes on the board and on the next hoarding along the lake.</p>
            </div>
            <Field label="Brand" value={brand} max={AD_LIMITS.brand} onChange={setBrand} placeholder="Kangir Emporium" />
            <Field label="Headline" value={headline} max={AD_LIMITS.headline} onChange={setHeadline} placeholder="Hottest kangir on the boulevard" />
            <label className="block text-left">
              <span className="mb-1 block text-[10px] font-bold tracking-wider text-slate-400">DETAILS</span>
              <textarea
                value={details}
                maxLength={AD_LIMITS.details}
                onChange={e => setDetails(e.target.value)}
                rows={3}
                placeholder="What should drivers know?"
                className="w-full resize-none rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-400"
              />
            </label>
            <Field label="Offer" value={offer} max={AD_LIMITS.offer} onChange={setOffer} placeholder="Ember refill ₹40" />
            <label className="block text-left">
              <span className="mb-1 block text-[10px] font-bold tracking-wider text-slate-400">CATEGORY</span>
              <select
                value={category}
                onChange={e => setCategory(e.target.value as AdCategory)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-bold text-white outline-none focus:border-amber-400"
              >
                {AD_CATEGORIES.map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </label>
            <p className="text-[11px] text-slate-500">Signed as {posterName}</p>
            {error && <p className="text-xs font-semibold text-rose-300">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="mt-1 rounded-xl bg-gradient-to-r from-amber-500 to-amber-300 px-4 py-2.5 font-['Outfit'] text-sm font-black tracking-wide text-slate-950 disabled:opacity-60"
            >
              {busy ? 'POSTING…' : 'LIST ADVERTISEMENT'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-black tracking-wide ${
        active ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-300 hover:text-white'
      }`}
    >
      {label}
    </button>
  );
}

function Field({
  label,
  value,
  max,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  max: number;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block text-left">
      <span className="mb-1 block text-[10px] font-bold tracking-wider text-slate-400">{label.toUpperCase()}</span>
      <input
        value={value}
        maxLength={max}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-400"
      />
    </label>
  );
}
