import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const METHODS = ['Cash', 'Card', 'bKash', 'Nagad', 'Other'];

/**
 * Split-billing modal, shared by the manager's desk and the waiter's handheld
 * so a guest can settle up wherever they happen to be standing.
 *
 * Recording the payment that clears the table's bill is also what pushes the
 * review prompt to the customer's phone (the server emits `bill_paid` once the
 * whole table is settled), so both surfaces must go through this same endpoint.
 *
 * @param {{order_id, table_id, table_number, total, order_status}} order
 * @param {() => void} onClose
 * @param {() => void} [onPaid]      called after any payment is recorded
 * @param {(orderId, tableId) => void} [onCheckout]  omit to hide the checkout button
 */
export default function PaymentModal({ order, onClose, onPaid, onCheckout }) {
  const [payments, setPayments] = useState([]);
  const [form, setForm] = useState({ amount: '', payment_method: 'Cash' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchPayments = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/api/orders/${order.order_id}/payments`);
      setPayments(res.data);
    } catch (err) {
      console.error('Error fetching payments:', err);
    }
  }, [order.order_id]);

  useEffect(() => { fetchPayments(); }, [fetchPayments]);

  const orderTotal = parseFloat(order.total || 0);
  const totalPaid = payments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
  const remaining = Math.max(0, orderTotal - totalPaid);
  const isFullyPaid = remaining === 0 || order.order_status === 'Paid';

  const handleAddPayment = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await axios.post(`${API_URL}/api/orders/${order.order_id}/payments`, form);
      setForm({ amount: '', payment_method: form.payment_method });
      await fetchPayments();
      if (onPaid) onPaid();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add payment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 print:hidden">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
          <h3 className="text-xl font-bold text-gray-900">Payment: {order.order_type === 'takeout' ? (order.guest_name ? `Takeout — ${order.guest_name}` : 'Takeout') : `Table ${order.table_number}`}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="p-6">
          <div className="flex justify-between items-end mb-6 bg-gray-50 p-4 rounded-md border border-gray-200">
            <div>
              <p className="text-sm text-gray-500 mb-1">Total Bill</p>
              <p className="text-3xl font-bold text-gray-900">৳{orderTotal.toFixed(2)}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500 mb-1">Remaining</p>
              <p className={`text-xl font-bold ${remaining === 0 ? 'text-green-600' : 'text-red-600'}`}>৳{remaining.toFixed(2)}</p>
            </div>
          </div>

          <h4 className="font-bold text-gray-700 mb-2 text-sm uppercase tracking-wider">Payments Made</h4>
          {payments.length === 0 ? (
            <p className="text-gray-500 text-sm mb-6 italic">No payments recorded yet.</p>
          ) : (
            <ul className="mb-6 border border-gray-200 rounded-md divide-y divide-gray-100 max-h-40 overflow-y-auto">
              {payments.map(p => (
                <li key={p.id} className="p-3 flex justify-between text-sm">
                  <span>
                    <span className="font-medium">{p.payment_method}</span>
                    <span className="text-gray-400 text-xs ml-2">{new Date(p.created_at).toLocaleTimeString()}</span>
                  </span>
                  <span className="font-medium text-gray-900">৳{parseFloat(p.amount).toFixed(2)}</span>
                </li>
              ))}
            </ul>
          )}

          {!isFullyPaid && (
            <form onSubmit={handleAddPayment} className="flex gap-3 mb-2">
              <div className="flex-1">
                <select
                  required
                  value={form.payment_method}
                  onChange={e => setForm({ ...form, payment_method: e.target.value })}
                  className="w-full border border-gray-300 rounded-md p-2 outline-none focus:border-blue-500 shadow-sm text-sm"
                >
                  {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="w-1/3">
                <input
                  type="number" step="0.01" min="0.01" max={remaining} required
                  value={form.amount}
                  onChange={e => setForm({ ...form, amount: e.target.value })}
                  className="w-full border border-gray-300 rounded-md p-2 outline-none focus:border-blue-500 shadow-sm text-sm"
                  placeholder="Amount"
                />
              </div>
              <button type="submit" disabled={saving} className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 shadow-sm disabled:bg-gray-300">
                {saving ? '…' : 'Add'}
              </button>
            </form>
          )}

          {error && <p className="text-red-600 text-sm font-medium">{error}</p>}

          {isFullyPaid && (
            <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md p-3">
              Bill settled. The customer&apos;s phone has been asked to leave a review.
            </p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex gap-3">
          <button onClick={onClose} className="flex-1 bg-white border border-gray-300 text-gray-700 rounded-md font-medium hover:bg-gray-50 py-2.5">Close</button>
          {isFullyPaid && onCheckout && (
            <button
              onClick={() => onCheckout(order.order_id, order.table_id)}
              className="flex-1 bg-green-600 text-white rounded-md font-medium hover:bg-green-700 py-2.5 shadow-sm"
            >
              Continue to Print
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
