import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// Bare instance so we DON'T inherit the staff JWT interceptor from App.jsx.
const api = axios.create({ baseURL: API_URL });

export default function TableOrder() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('t');

  const [phase, setPhase] = useState('loading'); // loading | invalid | ordering | placed | expired
  const [session, setSession] = useState(null);
  const [tableNumber, setTableNumber] = useState(null);
  const [tableId, setTableId] = useState(null);
  const [menu, setMenu] = useState([]);
  const [cart, setCart] = useState([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) { setPhase('invalid'); return; }
    let socket;
    (async () => {
      try {
        const [sessRes, menuRes] = await Promise.all([
          api.post('/api/public/table-session', { token }),
          api.get('/api/public/menu'),
        ]);
        setSession(sessRes.data.session);
        setTableNumber(sessRes.data.table_number);
        setTableId(sessRes.data.table_id);
        setMenu(menuRes.data);
        setPhase('ordering');
        
        socket = io(API_URL);
        socket.on('table_cleared', (data) => {
          if (data.tableId === sessRes.data.table_id) {
            setPhase('expired');
            setCart([]);
          }
        });
      } catch {
        setPhase('invalid');
      }
    })();
    return () => {
      if (socket) socket.disconnect();
    };
  }, [token]);

  const addToCart = (item) => setCart((prev) => {
    const found = prev.find((i) => i.id === item.id);
    if (found) return prev.map((i) => i.id === item.id ? { ...i, qty: i.qty + 1 } : i);
    return [...prev, { ...item, qty: 1 }];
  });

  const changeQty = (id, delta) => setCart((prev) =>
    prev.map((i) => i.id === id ? { ...i, qty: i.qty + delta } : i).filter((i) => i.qty > 0)
  );

  const total = cart.reduce((s, i) => s + parseFloat(i.price) * i.qty, 0);

  const placeOrder = async () => {
    setSubmitting(true);
    setError('');
    try {
      await api.post('/api/public/orders', {
        session,
        name,
        phone,
        items: cart.map((i) => ({ menu_item_id: i.id, quantity: i.qty })),
      });
      setPhase('placed');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not place order. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

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

  if (phase === 'expired') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-gray-50">
        <div className="text-4xl mb-3">🕒</div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">Session Expired</h1>
        <p className="text-gray-500 text-sm max-w-xs mb-4">Your table has been checked out. Please scan the QR code again to start a new session.</p>
        <button onClick={() => window.location.reload()} className="bg-blue-600 text-white font-medium px-6 py-2 rounded-md hover:bg-blue-700 shadow-sm">Refresh</button>
      </div>
    );
  }

  if (phase === 'placed') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-gray-50">
        <div className="text-5xl mb-4">✅</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Order received!</h1>
        <p className="text-gray-600 text-sm max-w-xs mb-1">Table {tableNumber} · ৳{total.toFixed(2)}</p>
        <p className="text-gray-500 text-sm max-w-xs">Waiting for staff to confirm your order. It will be sent to the kitchen shortly.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-40">
      <div className="bg-white border-b border-gray-200 px-5 py-4 sticky top-0 z-10">
        <h1 className="text-lg font-bold text-gray-900">Mamar Bari</h1>
        <p className="text-sm text-gray-500 font-medium">Ordering for Table {tableNumber}</p>
      </div>

      <div className="p-4 space-y-3">
        {menu.map((item) => (
          <div key={item.id} className="bg-white border border-gray-200 rounded-lg p-3 flex items-center gap-3 shadow-sm">
            <img src={item.image_url} alt="" className="h-16 w-16 rounded-md object-cover bg-gray-100 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-gray-400 uppercase tracking-wide font-semibold">{item.category}</div>
              <div className="text-sm font-bold text-gray-900 leading-tight">{item.name}</div>
              <div className="text-blue-600 font-bold text-sm mt-0.5">৳{parseFloat(item.price).toFixed(2)}</div>
            </div>
            <button onClick={() => addToCart(item)} className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-md hover:bg-blue-700 flex-shrink-0">Add</button>
          </div>
        ))}
      </div>

      {cart.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 shadow-lg p-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {cart.map((i) => (
            <div key={i.id} className="flex items-center justify-between text-sm">
              <span className="font-medium text-gray-900 flex-1 truncate">{i.name}</span>
              <div className="flex items-center gap-3">
                <button onClick={() => changeQty(i.id, -1)} className="w-7 h-7 rounded-md border border-gray-300 text-gray-700 font-bold">−</button>
                <span className="w-5 text-center font-semibold">{i.qty}</span>
                <button onClick={() => changeQty(i.id, 1)} className="w-7 h-7 rounded-md border border-gray-300 text-gray-700 font-bold">+</button>
                <span className="w-16 text-right font-bold text-gray-900">৳{(i.price * i.qty).toFixed(2)}</span>
              </div>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" className="border border-gray-300 rounded-md p-2 text-sm" />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" className="border border-gray-300 rounded-md p-2 text-sm" />
          </div>
          {error && <div className="text-red-600 text-sm font-medium">{error}</div>}
          <button
            onClick={placeOrder}
            disabled={submitting}
            className="w-full bg-blue-600 text-white font-semibold py-3 rounded-md hover:bg-blue-700 disabled:bg-gray-300"
          >
            {submitting ? 'Placing…' : `Place Order · ৳${total.toFixed(2)}`}
          </button>
        </div>
      )}
    </div>
  );
}
