import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { useToast } from '../context/ToastContext';
import { groupMenuByCategory, categoryNames } from '../utils/menu';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// Bare instance so we DON'T inherit the staff JWT interceptor from App.jsx.
const api = axios.create({ baseURL: API_URL });

const money = (n) => `৳${parseFloat(n || 0).toFixed(2)}`;

// One phone remembers its in-flight parcel order so a refresh resumes tracking
// instead of losing the ticket.
const ORDER_KEY = 'mb_takeout_order';

const STATUS_LABEL = {
  Unconfirmed: 'Waiting for staff',
  Pending: 'Sent to kitchen',
  Cooking: 'Being cooked',
  Ready: 'Ready for pickup',
  Served: 'Ready for pickup',
  Paid: 'Paid — thank you!',
  Completed: 'Completed',
  Cancelled: 'Cancelled',
};

const DONE = new Set(['Paid', 'Completed', 'Cancelled']);

export default function TakeoutOrder() {
  // menu | tracking
  const [phase, setPhase] = useState('menu');
  const [menu, setMenu] = useState([]);
  const [activeCat, setActiveCat] = useState('All');
  const [cart, setCart] = useState([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [order, setOrder] = useState(null); // tracked take-out order
  const toast = useToast();

  const orderIdRef = useRef(null);

  const fetchMenu = useCallback(async () => {
    try {
      const { data } = await api.get('/api/public/menu');
      setMenu(data);
    } catch { /* keep whatever we already have */ }
  }, []);

  const fetchStatus = useCallback(async (id) => {
    try {
      const { data } = await api.get(`/api/public/takeout/${id}/status`);
      setOrder(data);
      return data;
    } catch (err) {
      // A 404 means the ticket is gone (rejected/purged) -- drop it and go back
      // to the menu rather than stranding the guest on a dead tracking screen.
      if (err.response?.status === 404) {
        localStorage.removeItem(ORDER_KEY);
        orderIdRef.current = null;
        setOrder(null);
        setPhase('menu');
      }
      return null;
    }
  }, []);

  // On load: pull the menu, and resume tracking a saved parcel order if any.
  useEffect(() => {
    (async () => {
      await fetchMenu();
      const saved = localStorage.getItem(ORDER_KEY);
      if (saved) {
        orderIdRef.current = saved;
        setPhase('tracking');
        await fetchStatus(saved);
      }
    })();
  }, [fetchMenu, fetchStatus]);

  // Live menu edits from the manager dashboard + order status pushes.
  useEffect(() => {
    const socket = io(API_URL);
    socket.on('menu_updated', fetchMenu);
    socket.on('order_status_updated', (data) => {
      if (data?.id && data.id === orderIdRef.current) fetchStatus(data.id);
    });
    // Safety net for phones that drop the socket.
    const poll = setInterval(() => {
      if (orderIdRef.current) fetchStatus(orderIdRef.current);
    }, 15000);
    return () => { clearInterval(poll); socket.disconnect(); };
  }, [fetchMenu, fetchStatus]);

  // --- cart -----------------------------------------------------------------

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
    if (!name.trim()) { setError('Please enter your name so staff can call your order.'); return; }
    setSubmitting(true);
    setError('');
    try {
      const { data } = await api.post('/api/public/takeout', {
        name,
        phone,
        items: cart.map((i) => ({ menu_item_id: i.id, quantity: i.qty })),
      });
      localStorage.setItem(ORDER_KEY, data.order_id);
      orderIdRef.current = data.order_id;
      setCart([]);
      setPhase('tracking');
      await fetchStatus(data.order_id);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not place your order. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const newOrder = () => {
    localStorage.removeItem(ORDER_KEY);
    orderIdRef.current = null;
    setOrder(null);
    setName('');
    setPhone('');
    setPhase('menu');
  };

  // --- tracking screen ------------------------------------------------------

  if (phase === 'tracking') {
    const status = order?.status || 'Unconfirmed';
    const done = DONE.has(status);
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center px-5 py-10 font-sans">
        <div className="w-full max-w-sm bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl p-6">
          <h1 className="text-lg font-extrabold tracking-wide text-neutral-100 uppercase text-center">Mamar Bari</h1>
          <p className="text-xs text-amber-500 font-bold uppercase tracking-widest text-center mb-5">Take-out order</p>

          <div className="text-center mb-6">
            <div className="text-4xl mb-3">{status === 'Ready' || status === 'Served' ? '🛍️' : done ? '🙏' : '👨‍🍳'}</div>
            <div className={`inline-block px-4 py-1.5 rounded-full text-sm font-bold ${status === 'Ready' || status === 'Served' ? 'bg-yellow-500/20 text-yellow-400' : status === 'Cooking' ? 'bg-amber-500/20 text-amber-400' : done ? 'bg-green-500/20 text-green-400' : 'bg-neutral-800 text-neutral-300'}`}>
              {STATUS_LABEL[status] || status}
            </div>
            {order && (
              <div className="text-xs text-neutral-500 mt-3 font-medium">
                Order #{String(order.id).split('-')[0]}{order.guest_name ? ` · ${order.guest_name}` : ''}
              </div>
            )}
          </div>

          {(status === 'Ready' || status === 'Served') && (
            <p className="text-center text-sm text-yellow-400/90 font-medium mb-5">Your order is ready! Please collect it and pay at the counter.</p>
          )}
          {status === 'Unconfirmed' && (
            <p className="text-center text-sm text-neutral-400 mb-5">Waiting for staff to confirm your order…</p>
          )}

          {order?.items?.length > 0 && (
            <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-4 space-y-2 mb-4">
              {order.items.map((it, idx) => (
                <div key={idx} className="flex justify-between text-sm text-neutral-300 font-medium">
                  <span><span className="text-amber-500 mr-2">{it.quantity}×</span>{it.name}</span>
                </div>
              ))}
              <div className="flex justify-between text-sm font-bold text-neutral-100 pt-2 border-t border-neutral-800">
                <span>Total</span><span className="text-amber-500">{money(order.total)}</span>
              </div>
            </div>
          )}

          <p className="text-center text-xs text-neutral-500 mb-5">Pay at the counter when you collect your order.</p>

          <button
            onClick={newOrder}
            className="w-full bg-neutral-800 border border-neutral-700 text-neutral-200 font-bold py-3 rounded-xl hover:bg-neutral-700 transition-colors"
          >
            {done ? 'Place another order' : 'Add another order'}
          </button>
        </div>
      </div>
    );
  }

  // --- menu / ordering screen -----------------------------------------------

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 pb-44 font-sans">
      <div className="bg-neutral-900/80 backdrop-blur-md border-b border-neutral-800 px-5 py-4 sticky top-0 z-10 shadow-sm">
        <h1 className="text-lg font-extrabold tracking-wide text-neutral-100 uppercase">Mamar Bari</h1>
        <p className="text-sm text-amber-500 font-medium">Take-out · Pay at counter</p>
      </div>

      <div className="no-scrollbar">
        {/* Category chips */}
        <div className="sticky top-0 z-10 bg-neutral-950/95 backdrop-blur border-b border-neutral-800 px-4 py-3 flex gap-2 overflow-x-auto no-scrollbar">
          {['All', ...categoryNames(menu)].map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCat(cat)}
              className={`px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${activeCat === cat ? 'bg-amber-500 text-neutral-950 shadow-[0_0_10px_rgba(245,158,11,0.3)]' : 'bg-neutral-900 text-neutral-400 border border-neutral-800 hover:text-neutral-200'}`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="p-4 space-y-6">
          {groupMenuByCategory(menu)
            .filter((section) => activeCat === 'All' || section.category === activeCat)
            .map((section) => (
              <div key={section.category} className="space-y-3">
                <h2 className="text-sm font-bold text-amber-500 uppercase tracking-widest">{section.category}</h2>
                {section.items.map((item) => (
                  <div key={item.id} className="bg-neutral-900 border border-neutral-800 rounded-2xl p-3 flex items-center gap-4 shadow-lg hover:border-neutral-700 transition-colors">
                    <img src={item.image_url} alt="" className="h-20 w-20 rounded-xl object-cover bg-neutral-800 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-base font-bold text-neutral-100 leading-tight mb-1">{item.name}</div>
                      <div className="text-neutral-400 font-medium text-sm">{money(item.price)}</div>
                    </div>
                    <button onClick={() => addToCart(item)} className="bg-neutral-800 text-amber-500 border border-neutral-700 text-sm font-bold w-10 h-10 rounded-full flex items-center justify-center hover:bg-neutral-700 active:scale-90 transition-all flex-shrink-0 shadow-sm">
                      +
                    </button>
                  </div>
                ))}
              </div>
            ))}
          {menu.length === 0 && (
            <div className="text-center py-16 text-neutral-500 text-sm font-medium">No items on the menu yet.</div>
          )}
        </div>
      </div>

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
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="bg-neutral-950 border border-neutral-800 text-neutral-100 placeholder-neutral-600 rounded-xl p-3 text-sm font-medium outline-none focus:border-amber-500 transition-colors" />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" className="bg-neutral-950 border border-neutral-800 text-neutral-100 placeholder-neutral-600 rounded-xl p-3 text-sm font-medium outline-none focus:border-amber-500 transition-colors" />
          </div>
          {error && <div className="text-red-500 text-sm font-medium text-center">{error}</div>}
          <button
            onClick={placeOrder}
            disabled={submitting}
            className="w-full bg-gradient-to-r from-amber-500 to-amber-600 text-neutral-950 font-extrabold py-4 rounded-xl hover:from-amber-400 hover:to-amber-500 disabled:from-neutral-700 disabled:to-neutral-700 disabled:text-neutral-500 transition-all shadow-[0_0_20px_rgba(245,158,11,0.25)] active:scale-[0.98]"
          >
            {submitting ? 'Placing…' : `Place Take-out Order · ${money(cartTotal)}`}
          </button>
        </div>
      )}

      <div className="text-center text-xs text-neutral-600 font-medium py-8">
        &copy; {new Date().getFullYear()} Mamar Bari POS &bull; Created by <a href="https://github.com/Zhovon" target="_blank" rel="noopener noreferrer" className="text-amber-600 hover:text-amber-500 transition-colors">Zhovon</a>
      </div>
    </div>
  );
}
