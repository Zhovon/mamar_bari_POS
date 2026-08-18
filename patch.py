import sys

def main():
    with open('frontend/src/views/TableOrder.jsx', 'r') as f:
        lines = f.readlines()
        
    start_idx = -1
    for i, line in enumerate(lines):
        if line.strip() == "if (phase === 'loading') {":
            start_idx = i
            break
            
    if start_idx == -1:
        print("Could not find start point")
        return
        
    new_content = """  if (phase === 'loading') {
    return <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-amber-500 font-medium">Loading menu…</div>;
  }

  if (phase === 'invalid') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-neutral-950">
        <div className="text-4xl mb-3">⚠️</div>
        <h1 className="text-xl font-bold text-neutral-100 mb-1">Invalid table code</h1>
        <p className="text-neutral-400 text-sm max-w-xs">Please scan the QR code printed on your table, or ask a staff member for help.</p>
      </div>
    );
  }

  if (phase === 'closed') {
    const heading = {
      reviewed: 'Thank you for your review!',
      skipped: 'Thank you for dining with us!',
      left: 'Session ended',
      ended: 'Session ended',
    }[closedReason] || 'Session ended';

    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-neutral-950">
        <div className="text-5xl mb-4">{closedReason === 'reviewed' ? '🌟' : '🙏'}</div>
        <h1 className="text-2xl font-bold text-neutral-100 mb-2">{heading}</h1>
        <p className="text-neutral-400 text-sm max-w-xs mb-6">
          We hope to see you again at Mamar Bari.
        </p>
      </div>
    );
  }

  if (phase === 'review') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-neutral-950">
        <div className="w-full max-w-sm bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl p-6">
          <div className="text-4xl mb-2">✅</div>
          <h1 className="text-xl font-bold text-neutral-100 mb-1">Payment received</h1>
          <p className="text-neutral-400 text-sm mb-6">How was your meal at Mamar Bari?</p>

          <div className="flex justify-center gap-2 mb-5">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => { setRating(star); setError(''); }}
                aria-label={`${star} star${star > 1 ? 's' : ''}`}
                className={`text-4xl leading-none transition-transform active:scale-90 ${star <= rating ? 'text-amber-400' : 'text-neutral-700'}`}
              >
                ★
              </button>
            ))}
          </div>

          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Tell us more (optional)"
            rows={3}
            className="w-full bg-neutral-800 border border-neutral-700 text-neutral-100 rounded-xl p-3 text-sm mb-3 outline-none focus:border-amber-500 placeholder-neutral-500 transition-colors"
          />

          {error && <div className="text-red-500 text-sm font-medium mb-3">{error}</div>}

          <button
            onClick={submitReview}
            disabled={submitting}
            className="w-full bg-gradient-to-r from-amber-500 to-amber-600 text-neutral-950 font-bold py-3 rounded-xl hover:from-amber-400 hover:to-amber-500 disabled:from-neutral-700 disabled:to-neutral-700 disabled:text-neutral-500 mb-2 transition-all shadow-[0_0_15px_rgba(245,158,11,0.2)]"
          >
            {submitting ? 'Sending…' : 'Send review'}
          </button>
          <button
            onClick={skipReview}
            className="w-full bg-neutral-900 border border-neutral-700 text-neutral-300 font-medium py-3 rounded-xl hover:bg-neutral-800 transition-colors"
          >
            No thanks
          </button>
        </div>
      </div>
    );
  }

  // --- active session -------------------------------------------------------

  const orders = state?.orders || [];

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 pb-44 font-sans">
      <div className="bg-neutral-900/80 backdrop-blur-md border-b border-neutral-800 px-5 py-4 sticky top-0 z-10 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-extrabold tracking-wide text-neutral-100 uppercase">Mamar Bari</h1>
            <p className="text-sm text-amber-500 font-medium">Table {tableNumber}</p>
          </div>
          {state && state.total > 0 && (
            <div className="text-right">
              <div className="text-[10px] text-neutral-500 uppercase tracking-widest font-bold">Table bill</div>
              <div className="text-base font-bold text-neutral-100">{money(state.total)}</div>
              {state.due > 0
                ? <div className="text-xs text-amber-500 font-medium">{money(state.due)} due</div>
                : <div className="text-xs text-green-500 font-semibold tracking-wide uppercase">Paid</div>}
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-4 bg-neutral-900 p-1 rounded-xl border border-neutral-800">
          <button
            onClick={() => setTab('menu')}
            className={`flex-1 text-sm font-bold py-2 rounded-lg transition-all ${tab === 'menu' ? 'bg-amber-500 text-neutral-950 shadow-[0_0_10px_rgba(245,158,11,0.3)]' : 'text-neutral-400 hover:text-neutral-200'}`}
          >
            Menu
          </button>
          <button
            onClick={() => setTab('orders')}
            className={`flex-1 text-sm font-bold py-2 rounded-lg transition-all ${tab === 'orders' ? 'bg-amber-500 text-neutral-950 shadow-[0_0_10px_rgba(245,158,11,0.3)]' : 'text-neutral-400 hover:text-neutral-200'}`}
          >
            My Orders{orders.length > 0 ? ` (${orders.length})` : ''}
          </button>
        </div>
      </div>

      {tab === 'menu' ? (
        <div className="p-4 space-y-4 no-scrollbar">
          {menu.map((item) => (
            <div key={item.id} className="bg-neutral-900 border border-neutral-800 rounded-2xl p-3 flex items-center gap-4 shadow-lg hover:border-neutral-700 transition-colors">
              <img src={item.image_url} alt="" className="h-20 w-20 rounded-xl object-cover bg-neutral-800 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-amber-500 uppercase tracking-widest font-bold mb-1">{item.category}</div>
                <div className="text-base font-bold text-neutral-100 leading-tight mb-1">{item.name}</div>
                <div className="text-neutral-400 font-medium text-sm">{money(item.price)}</div>
              </div>
              <button onClick={() => addToCart(item)} className="bg-neutral-800 text-amber-500 border border-neutral-700 text-sm font-bold w-10 h-10 rounded-full flex items-center justify-center hover:bg-neutral-700 active:scale-90 transition-all flex-shrink-0 shadow-sm">
                +
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-4 space-y-4 no-scrollbar">
          {orders.length === 0 ? (
            <div className="text-center py-16 bg-neutral-900 rounded-2xl border border-neutral-800 text-neutral-500 text-sm font-medium">
              Nothing ordered yet. Pick something from the menu.
            </div>
          ) : (
            orders.map((o) => (
              <div key={o.id} className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-lg">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-neutral-500 tracking-wider uppercase">Order #{String(o.id).split('-')[0]}</span>
                  <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${o.status === 'Paid' || o.status === 'Completed' || o.status === 'Served' ? 'bg-green-500/20 text-green-400' : o.status === 'Cooking' ? 'bg-amber-500/20 text-amber-400' : 'bg-neutral-800 text-neutral-300'}`}>
                    {STATUS_LABEL[o.status] || o.status}
                  </span>
                </div>
                <div className="space-y-2 mb-3">
                  {(o.items || []).map((it, idx) => (
                    <div key={idx} className="flex justify-between text-sm text-neutral-300 font-medium">
                      <span><span className="text-amber-500 mr-2">{it.quantity}×</span> {it.name}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-sm font-bold text-neutral-100 pt-3 border-t border-neutral-800">
                  <span>Total</span><span className="text-amber-500">{money(o.total)}</span>
                </div>
                {o.source === 'staff' && (
                  <div className="text-xs text-neutral-600 mt-2 font-medium">Added by staff</div>
                )}
              </div>
            ))
          )}

          {state && state.total > 0 && (
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-lg mt-6">
              <div className="flex justify-between text-sm text-neutral-400 mb-2 font-medium">
                <span>Table total</span><span className="text-neutral-100 font-bold">{money(state.total)}</span>
              </div>
              <div className="flex justify-between text-sm text-neutral-400 mb-3 font-medium">
                <span>Paid</span><span className="text-neutral-100 font-bold">{money(state.paid)}</span>
              </div>
              <div className="flex justify-between text-base font-bold text-neutral-100 pt-3 border-t border-neutral-800">
                <span>Due</span><span className="text-amber-500">{money(state.due)}</span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
            <button
              onClick={requestBill}
              disabled={billRequested}
              className="bg-neutral-800 border border-neutral-700 text-amber-500 text-sm font-bold py-3 rounded-xl hover:bg-neutral-700 disabled:text-neutral-600 disabled:bg-neutral-900 transition-colors"
            >
              {billRequested ? 'Waiter notified' : 'Request bill'}
            </button>
            <button
              onClick={leaveSession}
              className="bg-neutral-900 border border-neutral-800 text-neutral-400 text-sm font-bold py-3 rounded-xl hover:bg-neutral-800 hover:text-neutral-300 transition-colors"
            >
              End / Leave
            </button>
          </div>
        </div>
      )}

      {cart.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 bg-neutral-900/90 backdrop-blur-xl border-t border-neutral-800 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] p-5 space-y-4 max-h-[75vh] overflow-y-auto no-scrollbar rounded-t-3xl">
          {cart.map((i) => (
            <div key={i.id} className="flex items-center justify-between text-sm">
              <span className="font-bold text-neutral-100 flex-1 truncate pr-2">{i.name}</span>
              <div className="flex items-center gap-3 bg-neutral-800 p-1 rounded-lg border border-neutral-700">
                <button onClick={() => changeQty(i.id, -1)} className="w-8 h-8 rounded-md bg-neutral-900 text-neutral-400 font-bold hover:text-amber-500 active:scale-90 transition-all">−</button>
                <span className="w-4 text-center font-bold text-neutral-100">{i.qty}</span>
                <button onClick={() => changeQty(i.id, 1)} className="w-8 h-8 rounded-md bg-neutral-900 text-neutral-400 font-bold hover:text-amber-500 active:scale-90 transition-all">+</button>
              </div>
              <span className="w-16 text-right font-bold text-amber-500">{money(i.price * i.qty)}</span>
            </div>
          ))}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" className="bg-neutral-950 border border-neutral-800 text-neutral-100 placeholder-neutral-600 rounded-xl p-3 text-sm font-medium outline-none focus:border-amber-500 transition-colors" />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" className="bg-neutral-950 border border-neutral-800 text-neutral-100 placeholder-neutral-600 rounded-xl p-3 text-sm font-medium outline-none focus:border-amber-500 transition-colors" />
          </div>
          {error && <div className="text-red-500 text-sm font-medium text-center">{error}</div>}
          <button
            onClick={placeOrder}
            disabled={submitting}
            className="w-full bg-gradient-to-r from-amber-500 to-amber-600 text-neutral-950 font-extrabold py-4 rounded-xl hover:from-amber-400 hover:to-amber-500 disabled:from-neutral-700 disabled:to-neutral-700 disabled:text-neutral-500 transition-all shadow-[0_0_20px_rgba(245,158,11,0.25)] active:scale-[0.98]"
          >
            {submitting ? 'Placing…' : `Place Order · ${money(cartTotal)}`}
          </button>
        </div>
      )}
      
      {/* Footer */}
      <div className="text-center text-xs text-neutral-600 font-medium py-8 pb-36">
        &copy; {new Date().getFullYear()} Mamar Bari POS &bull; Created by <a href="https://github.com/Zhovon" target="_blank" rel="noopener noreferrer" className="text-amber-600 hover:text-amber-500 transition-colors">Zhovon</a>
      </div>
    </div>
  );
}
"""
    
    with open('frontend/src/views/TableOrder.jsx', 'w') as f:
        f.writelines(lines[:start_idx])
        f.write(new_content)

if __name__ == '__main__':
    main()
