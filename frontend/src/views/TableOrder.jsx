import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// Bare instance so we DON'T inherit the staff JWT interceptor from App.jsx.
const api = axios.create({ baseURL: API_URL });

// The printed QR never expires, so the phone has to remember who it is between
// scans: one stable device id, plus the live session token for this table.
const DEVICE_KEY = 'mb_device_id';
const sessionKey = (code) => `mb_session_${code}`;

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) ||
      `dev-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

const money = (n) => `৳${parseFloat(n || 0).toFixed(2)}`;

const STATUS_LABEL = {
  Unconfirmed: 'Waiting for staff',
  Pending: 'Sent to kitchen',
  Cooking: 'Being cooked',
  Ready: 'Ready to serve',
  Served: 'Served',
  Paid: 'Paid',
  Completed: 'Completed',
};

const STATUS_STYLE = {
  Unconfirmed: 'bg-gray-100 text-gray-700',
  Pending: 'bg-blue-100 text-blue-800',
  Cooking: 'bg-orange-100 text-orange-800',
  Ready: 'bg-yellow-100 text-yellow-800',
  Served: 'bg-green-100 text-green-800',
  Paid: 'bg-green-100 text-green-800',
  Completed: 'bg-green-100 text-green-800',
};

export default function TableOrder() {
  const [searchParams] = useSearchParams();
  const code = searchParams.get('t');

  // loading | invalid | active | review | closed
  const [phase, setPhase] = useState('loading');
  const [tab, setTab] = useState('menu'); // menu | orders
  const [session, setSession] = useState(null);
  const [tableNumber, setTableNumber] = useState(null);
  const [state, setState] = useState(null); // orders + running bill
  const [menu, setMenu] = useState([]);
  const [cart, setCart] = useState([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [closedReason, setClosedReason] = useState('review');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [billRequested, setBillRequested] = useState(false);

  const sessionRef = useRef(null);
  const socketRef = useRef(null);

  // --- session lifecycle ----------------------------------------------------

  const endLocally = useCallback((reason) => {
    if (code) {
      localStorage.removeItem(sessionKey(code));
    }
    sessionRef.current = null;
    setSession(null);
    setCart([]);
    setClosedReason(reason);
    setPhase('closed');
  }, [code]);

  const refreshState = useCallback(async () => {
    const token = sessionRef.current;
    if (!token) return;
    try {
      const { data } = await api.get('/api/public/session/state', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setState(data);
      setTableNumber(data.table_number);
      // The bill being settled is the cue to ask for a review.
      if (data.settled && !data.already_reviewed) setPhase('review');
    } catch (err) {
      if (err.response?.status === 401) endLocally('ended');
    }
  }, [endLocally]);

  const startSession = useCallback(async () => {
    setPhase('loading');
    setError('');
    try {
      const { data } = await api.post('/api/public/session', {
        code,
        device_id: getDeviceId(),
      });
      localStorage.setItem(sessionKey(code), data.session);
      localStorage.removeItem(closedKey(code));
      sessionRef.current = data.session;
      setSession(data.session);
      setTableNumber(data.table_number);
      setPhase('active');
      await refreshState();
    } catch {
      setPhase('invalid');
    }
  }, [code, refreshState]);

  useEffect(() => {
    if (!code) { setPhase('invalid'); return; }

    (async () => {
      try {
        const { data } = await api.get('/api/public/menu');
        setMenu(data);
      } catch {
        // A menu fetch failure shouldn't block an existing session's bill view.
      }

      // Resume an existing session so a refresh or a lost signal doesn't split
      // one visit across several half-sessions.
      const saved = localStorage.getItem(sessionKey(code));
      if (saved) {
        sessionRef.current = saved;
        setSession(saved);
        setPhase('active');
        try {
          const { data } = await api.get('/api/public/session/state', {
            headers: { Authorization: `Bearer ${saved}` },
          });
          setState(data);
          setTableNumber(data.table_number);
          if (data.settled && !data.already_reviewed) setPhase('review');
          return;
        } catch {
          localStorage.removeItem(sessionKey(code));
          sessionRef.current = null;
        }
      }

      await startSession();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // --- live updates ---------------------------------------------------------

  useEffect(() => {
    if (!session) return;

    const socket = io(API_URL);
    socketRef.current = socket;
    // The server derives the room from this token -- we never name it ourselves.
    socket.on('connect', () => socket.emit('join_session', session));
    socket.on('session_updated', refreshState);
    socket.on('bill_paid', () => {
      setState((prev) => (prev ? { ...prev, settled: true } : prev));
      setPhase((prev) => (prev === 'closed' ? prev : 'review'));
    });
    socket.on('session_closed', () => endLocally('ended'));

    // Phones drop sockets constantly (lock screen, tab switch, patchy wifi), so
    // poll as a safety net -- the review prompt must not depend on one event.
    const poll = setInterval(refreshState, 20000);

    return () => {
      clearInterval(poll);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session, refreshState, endLocally]);

  // --- actions --------------------------------------------------------------

  const addToCart = (item) => setCart((prev) => {
    const found = prev.find((i) => i.id === item.id);
    if (found) return prev.map((i) => (i.id === item.id ? { ...i, qty: i.qty + 1 } : i));
    return [...prev, { ...item, qty: 1 }];
  });

  const changeQty = (id, delta) => setCart((prev) =>
    prev.map((i) => (i.id === id ? { ...i, qty: i.qty + delta } : i)).filter((i) => i.qty > 0)
  );

  const cartTotal = cart.reduce((s, i) => s + parseFloat(i.price) * i.qty, 0);

  const placeOrder = async () => {
    setSubmitting(true);
    setError('');
    try {
      await api.post('/api/public/orders', {
        name,
        phone,
        items: cart.map((i) => ({ menu_item_id: i.id, quantity: i.qty })),
      }, { headers: { Authorization: `Bearer ${sessionRef.current}` } });
      setCart([]);
      setTab('orders');
      await refreshState();
    } catch (err) {
      if (err.response?.data?.code === 'SESSION_ENDED') {
        endLocally('ended');
      } else {
        setError(err.response?.data?.error || 'Could not place order. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const requestBill = async () => {
    try {
      await api.post('/api/public/session/request-bill', {}, {
        headers: { Authorization: `Bearer ${sessionRef.current}` },
      });
      setBillRequested(true);
      setTimeout(() => setBillRequested(false), 30000);
    } catch { /* a waiter is right there anyway -- not worth an error screen */ }
  };

  const leaveSession = async () => {
    if (!window.confirm('End your session at this table?')) return;
    try {
      await api.post('/api/public/session/leave', {}, {
        headers: { Authorization: `Bearer ${sessionRef.current}` },
      });
    } catch { /* closing locally regardless */ }
    endLocally('left');
  };

  const submitReview = async () => {
    if (!rating) { setError('Please tap a star first'); return; }
    setSubmitting(true);
    setError('');
    try {
      await api.post('/api/public/reviews', { rating, comment }, {
        headers: { Authorization: `Bearer ${sessionRef.current}` },
      });
      endLocally('reviewed');
    } catch (err) {
      // The session ending underneath us is exactly what a review does -- treat
      // it as success rather than showing the guest a scary error.
      if (err.response?.status === 401) endLocally('reviewed');
      else setError(err.response?.data?.error || 'Could not send your review.');
    } finally {
      setSubmitting(false);
    }
  };

  const skipReview = async () => {
    try {
      await api.post('/api/public/reviews/skip', {}, {
        headers: { Authorization: `Bearer ${sessionRef.current}` },
      });
    } catch { /* closing locally regardless */ }
    endLocally('skipped');
  };

  // --- screens --------------------------------------------------------------

  if (phase === 'loading') {
    return <div className="min-h-screen flex items-center justify-center text-gray-500 font-medium">Loading menu…</div>;
  }

  if (phase === 'invalid') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-gray-50">
        <div className="text-4xl mb-3">⚠️</div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">Invalid table code</h1>
        <p className="text-gray-500 text-sm max-w-xs">Please scan the QR code printed on your table, or ask a staff member for help.</p>
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
      <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-gray-50">
        <div className="text-5xl mb-4">{closedReason === 'reviewed' ? '🌟' : '🙏'}</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{heading}</h1>
        <p className="text-gray-500 text-sm max-w-xs mb-6">
          We hope to see you again at Mamar Bari.
        </p>
      </div>
    );
  }

  if (phase === 'review') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-gray-50">
        <div className="w-full max-w-sm bg-white border border-gray-200 rounded-lg shadow-sm p-6">
          <div className="text-4xl mb-2">✅</div>
          <h1 className="text-xl font-bold text-gray-900 mb-1">Payment received</h1>
          <p className="text-gray-500 text-sm mb-6">How was your meal at Mamar Bari?</p>

          <div className="flex justify-center gap-2 mb-5">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => { setRating(star); setError(''); }}
                aria-label={`${star} star${star > 1 ? 's' : ''}`}
                className={`text-4xl leading-none transition-transform active:scale-90 ${star <= rating ? 'text-yellow-400' : 'text-gray-300'}`}
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
            className="w-full border border-gray-300 rounded-md p-2.5 text-sm mb-3 outline-none focus:border-blue-500"
          />

          {error && <div className="text-red-600 text-sm font-medium mb-3">{error}</div>}

          <button
            onClick={submitReview}
            disabled={submitting}
            className="w-full bg-blue-600 text-white font-semibold py-3 rounded-md hover:bg-blue-700 disabled:bg-gray-300 mb-2"
          >
            {submitting ? 'Sending…' : 'Send review'}
          </button>
          <button
            onClick={skipReview}
            className="w-full bg-white border border-gray-300 text-gray-700 font-medium py-2.5 rounded-md hover:bg-gray-50"
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
    <div className="min-h-screen bg-gray-50 pb-44">
      <div className="bg-white border-b border-gray-200 px-5 py-4 sticky top-0 z-10">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Mamar Bari</h1>
            <p className="text-sm text-gray-500 font-medium">Table {tableNumber}</p>
          </div>
          {state && state.total > 0 && (
            <div className="text-right">
              <div className="text-xs text-gray-400 uppercase tracking-wide font-semibold">Table bill</div>
              <div className="text-base font-bold text-gray-900">{money(state.total)}</div>
              {state.due > 0
                ? <div className="text-xs text-gray-500">{money(state.due)} due</div>
                : <div className="text-xs text-green-600 font-semibold">Paid</div>}
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-3">
          <button
            onClick={() => setTab('menu')}
            className={`flex-1 text-sm font-medium py-1.5 rounded-md border ${tab === 'menu' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'}`}
          >
            Menu
          </button>
          <button
            onClick={() => setTab('orders')}
            className={`flex-1 text-sm font-medium py-1.5 rounded-md border ${tab === 'orders' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'}`}
          >
            My Orders{orders.length > 0 ? ` (${orders.length})` : ''}
          </button>
        </div>
      </div>

      {tab === 'menu' ? (
        <div className="p-4 space-y-3">
          {menu.map((item) => (
            <div key={item.id} className="bg-white border border-gray-200 rounded-lg p-3 flex items-center gap-3 shadow-sm">
              <img src={item.image_url} alt="" className="h-16 w-16 rounded-md object-cover bg-gray-100 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-gray-400 uppercase tracking-wide font-semibold">{item.category}</div>
                <div className="text-sm font-bold text-gray-900 leading-tight">{item.name}</div>
                <div className="text-blue-600 font-bold text-sm mt-0.5">{money(item.price)}</div>
              </div>
              <button onClick={() => addToCart(item)} className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-md hover:bg-blue-700 flex-shrink-0">Add</button>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-4 space-y-3">
          {orders.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-lg border border-gray-200 text-gray-500 text-sm">
              Nothing ordered yet. Pick something from the menu.
            </div>
          ) : (
            orders.map((o) => (
              <div key={o.id} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-gray-500">Order #{String(o.id).split('-')[0]}</span>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_STYLE[o.status] || 'bg-gray-100 text-gray-700'}`}>
                    {STATUS_LABEL[o.status] || o.status}
                  </span>
                </div>
                <div className="space-y-1">
                  {(o.items || []).map((it, idx) => (
                    <div key={idx} className="flex justify-between text-sm text-gray-700">
                      <span>{it.quantity} × {it.name}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-sm font-bold text-gray-900 mt-2 pt-2 border-t border-gray-100">
                  <span>Total</span><span>{money(o.total)}</span>
                </div>
                {o.source === 'staff' && (
                  <div className="text-xs text-gray-400 mt-1">Added by staff</div>
                )}
              </div>
            ))
          )}

          {state && state.total > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
              <div className="flex justify-between text-sm text-gray-700 mb-1">
                <span>Table total</span><span className="font-semibold">{money(state.total)}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-700 mb-1">
                <span>Paid</span><span className="font-semibold">{money(state.paid)}</span>
              </div>
              <div className="flex justify-between text-base font-bold text-gray-900 pt-2 border-t border-gray-100">
                <span>Due</span><span>{money(state.due)}</span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            <button
              onClick={requestBill}
              disabled={billRequested}
              className="bg-white border border-gray-300 text-gray-700 text-sm font-medium py-2.5 rounded-md hover:bg-gray-50 disabled:text-gray-400"
            >
              {billRequested ? 'Waiter notified' : 'Request bill'}
            </button>
            <button
              onClick={leaveSession}
              className="bg-white border border-gray-300 text-gray-700 text-sm font-medium py-2.5 rounded-md hover:bg-gray-50"
            >
              End / Leave
            </button>
          </div>
        </div>
      )}

      {cart.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 shadow-lg p-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {cart.map((i) => (
            <div key={i.id} className="flex items-center justify-between text-sm">
              <span className="font-medium text-gray-900 flex-1 truncate">{i.name}</span>
              <div className="flex items-center gap-3">
                <button onClick={() => changeQty(i.id, -1)} className="w-7 h-7 rounded-md border border-gray-300 text-gray-700 font-bold">−</button>
                <span className="w-5 text-center font-semibold">{i.qty}</span>
                <button onClick={() => changeQty(i.id, 1)} className="w-7 h-7 rounded-md border border-gray-300 text-gray-700 font-bold">+</button>
                <span className="w-16 text-right font-bold text-gray-900">{money(i.price * i.qty)}</span>
              </div>
            </div>
          ))}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" className="border border-gray-300 rounded-md p-2 text-sm" />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" className="border border-gray-300 rounded-md p-2 text-sm" />
          </div>
          {error && <div className="text-red-600 text-sm font-medium">{error}</div>}
          <button
            onClick={placeOrder}
            disabled={submitting}
            className="w-full bg-blue-600 text-white font-semibold py-3 rounded-md hover:bg-blue-700 disabled:bg-gray-300"
          >
            {submitting ? 'Placing…' : `Place Order · ${money(cartTotal)}`}
          </button>
        </div>
      )}
    </div>
  );
}
