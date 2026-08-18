import sys

def main():
    with open('frontend/src/views/TableOrder.jsx', 'r') as f:
        content = f.read()
        
    # The banner will be placed below the header and above the tabs.
    header_end_anchor = """      <div className="bg-neutral-900/80 backdrop-blur-md border-b border-neutral-800 px-5 py-4 sticky top-0 z-10 shadow-sm">
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
      </div>"""
      
    # Create the dynamic banner logic just before the return statement.
    logic_anchor = """  const orders = state?.orders || [];"""
    new_logic = logic_anchor + """

  // Determine the highest priority active status for the banner
  let activeStatusBanner = null;
  if (orders.length > 0) {
    if (orders.some(o => o.status === 'Ready')) {
      activeStatusBanner = { text: 'Your food is ready and will be served shortly! 🍽️', color: 'bg-green-500/20 text-green-400 border-green-500/30' };
    } else if (orders.some(o => o.status === 'Cooking')) {
      activeStatusBanner = { text: 'Your food is being cooked by our chefs! 🍳', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' };
    } else if (orders.some(o => o.status === 'Pending')) {
      activeStatusBanner = { text: 'Your order was sent to the kitchen! 👨‍🍳', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' };
    } else if (orders.some(o => o.status === 'Unconfirmed')) {
      activeStatusBanner = { text: 'Waiting for staff to confirm your order... ⏳', color: 'bg-neutral-800 text-neutral-300 border-neutral-700' };
    }
  }
"""
    content = content.replace(logic_anchor, new_logic)
    
    new_header = header_end_anchor + """

      {activeStatusBanner && (
        <div className="px-4 pt-4">
          <div className={`px-4 py-3 rounded-xl border text-sm font-bold shadow-sm ${activeStatusBanner.color} flex items-center justify-center text-center animate-pulse`}>
            {activeStatusBanner.text}
          </div>
        </div>
      )}"""
      
    content = content.replace(header_end_anchor, new_header)
    
    with open('frontend/src/views/TableOrder.jsx', 'w') as f:
        f.write(content)

if __name__ == '__main__':
    main()
