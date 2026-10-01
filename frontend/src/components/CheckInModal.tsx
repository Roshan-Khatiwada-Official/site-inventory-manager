import React, { useState } from 'react';
import { X, PackageCheck } from 'lucide-react';

interface CheckInModalProps {
  itemName: string;
  itemCode: string;
  collectorName: string;
  heldQuantity: number;
  onClose: () => void;
  onConfirm: (quantity: number, ok: boolean, note: string) => void;
}

/** Check some or all of one person's held quantity of an item back in, with a condition check. */
export const CheckInModal: React.FC<CheckInModalProps> = ({ itemName, itemCode, collectorName, heldQuantity, onClose, onConfirm }) => {
  const [quantity, setQuantity] = useState<number>(heldQuantity);
  const [ok, setOk] = useState<boolean | null>(null);
  const [note, setNote] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (ok === null) return;
    if (!ok && !note.trim()) return;
    if (quantity <= 0 || quantity > heldQuantity) return;
    onConfirm(quantity, ok, note);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm sm:p-4">
      <div className="bg-white sm:rounded-2xl w-full sm:max-w-md h-full sm:h-auto sm:max-h-[90vh] border border-slate-200 shadow-xl flex flex-col">
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center"><PackageCheck className="w-4 h-4" /></div>
            <h3 className="font-bold text-slate-900 text-base">Check in item</h3>
          </div>
          <button onClick={onClose} title="Close" className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={submit} className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4 text-xs text-slate-700">
          <p>
            Returning <strong className="text-slate-900">{itemName}</strong>
            <span className="font-mono text-slate-400"> · {itemCode}</span> from{' '}
            <strong className="text-slate-900">{collectorName}</strong>, who holds {heldQuantity}.
          </p>

          <div>
            <label className="block font-semibold mb-1">Quantity to check in *</label>
            <input type="number" min={1} max={heldQuantity} value={quantity}
              onChange={e => setQuantity(parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            <p className="mt-1 text-[10px] text-slate-400">Check in less than {heldQuantity} if only some of it came back.</p>
          </div>

          <div>
            <p className="font-semibold mb-1.5">Is everything in good condition?</p>
            <p className="text-[11px] text-slate-500 mb-2">Check the camera, lens, cables, battery and body.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setOk(true)}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition ${ok === true ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
                Yes — all OK
              </button>
              <button type="button" onClick={() => setOk(false)}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition ${ok === false ? 'bg-rose-600 text-white border-rose-600' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
                No — there is a problem
              </button>
            </div>
          </div>

          {ok === false && (
            <div>
              <label className="block font-semibold mb-1">What is wrong? *</label>
              <textarea required rows={3} value={note} onChange={e => setNote(e.target.value)}
                placeholder="e.g. camera lens scratched, one cable missing"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none" />
              <p className="mt-1 text-[11px] text-rose-600">This item will be flagged in the inventory.</p>
            </div>
          )}

          {ok === null && <p className="text-rose-600 text-[11px] font-medium">Choose Yes or No above before confirming.</p>}

          <div className="sticky bottom-0 -mx-6 px-6 pt-3 pb-4 bg-white border-t border-slate-200 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-200">Cancel</button>
            <button type="submit" disabled={ok === null || (ok === false && !note.trim()) || quantity <= 0 || quantity > heldQuantity}
              className="px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm disabled:opacity-40">
              Confirm check-in
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
