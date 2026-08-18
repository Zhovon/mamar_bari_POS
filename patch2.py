import sys

def main():
    with open('frontend/src/views/TableOrder.jsx', 'r') as f:
        content = f.read()
        
    # 1. Add state variable
    state_anchor = "const [billRequested, setBillRequested] = useState(false);"
    new_state = state_anchor + "\n  const [showLeaveModal, setShowLeaveModal] = useState(false);"
    content = content.replace(state_anchor, new_state)
    
    # 2. Replace leaveSession function
    old_leave = """  const leaveSession = async () => {
    if (!window.confirm('End your session at this table?')) return;
    try {
      await api.post('/api/public/session/leave', {}, {
        headers: { Authorization: `Bearer ${sessionRef.current}` },
      });
    } catch { /* closing locally regardless */ }
    endLocally('left');
  };"""
    
    new_leave = """  const confirmLeave = async () => {
    setShowLeaveModal(false);
    try {
      await api.post('/api/public/session/leave', {}, {
        headers: { Authorization: `Bearer ${sessionRef.current}` },
      });
    } catch { /* closing locally regardless */ }
    endLocally('left');
  };

  const leaveSession = () => {
    setShowLeaveModal(true);
  };"""
    content = content.replace(old_leave, new_leave)
    
    # 3. Add modal before the closing div
    modal_html = """
      {/* Leave Modal */}
      {showLeaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="text-xl font-bold text-neutral-100 mb-2">Leave Session?</h2>
            {state && state.due > 0 ? (
              <p className="text-neutral-400 text-sm mb-6">
                You still have an unpaid balance of <span className="text-amber-500 font-bold">{money(state.due)}</span>. Please make sure to settle your bill with the staff before you leave. Are you sure you want to end your device's session?
              </p>
            ) : (
              <p className="text-neutral-400 text-sm mb-6">
                Are you sure you want to end your session at this table?
              </p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => setShowLeaveModal(false)}
                className="flex-1 bg-neutral-800 text-neutral-300 font-bold py-3 rounded-xl hover:bg-neutral-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmLeave}
                className="flex-1 bg-amber-500 text-neutral-950 font-bold py-3 rounded-xl hover:bg-amber-400 transition-colors shadow-[0_0_15px_rgba(245,158,11,0.2)]"
              >
                Yes, Leave
              </button>
            </div>
          </div>
        </div>
      )}
    """
    
    footer_anchor = "{/* Footer */}"
    content = content.replace(footer_anchor, modal_html + "\n      " + footer_anchor)
    
    with open('frontend/src/views/TableOrder.jsx', 'w') as f:
        f.write(content)

if __name__ == '__main__':
    main()
