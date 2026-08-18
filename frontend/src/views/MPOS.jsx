import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import PaymentModal from '../components/PaymentModal';
import { useToast } from '../context/ToastContext';

export default function MPOS() {
  const [menuItems, setMenuItems] = useState([]);
  const [tables, setTables] = useState([]);
  const [activeOrders, setActiveOrders] = useState([]);
  const [selectedTable, setSelectedTable] = useState(null);
  const [cart, setCart] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showOrdersModal, setShowOrdersModal] = useState(false);
  const toast = useToast();
  // Guests pay at the table as often as at the desk, so the waiter's handheld
  // gets the same split-billing modal the manager uses.
  const [payingOrder, setPayingOrder] = useState(null);
  const [receiptData, setReceiptData] = useState(null);
  const [billRequests, setBillRequests] = useState([]);
  const navigate = useNavigate();

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

  useEffect(() => {
    fetchData();

    const socket = io(API_URL);
    socket.on('new_order', (data) => {
      fetchData();
      toast.info(`New order received!`);
    });
    socket.on('order_status_updated', (data) => {
      fetchData();
      if (data?.status === 'Ready') {
        toast.success(`Order is ready to serve!`);
      }
    });
    // A guest tapped "Request bill" on their phone.
    socket.on('bill_requested', ({ tableNumber }) => {
      setBillRequests((prev) => (prev.includes(tableNumber) ? prev : [...prev, tableNumber]));
      toast.info(`Table ${tableNumber} requested the bill!`);
    });
    socket.on('review_submitted', (data) => {
      toast.success(`Table ${data.tableId} left a ${data.rating}-star review!`);
    });

    return () => socket.disconnect();
  }, []);

  const fetchData = async () => {
    try {
      const [menuRes, tablesRes, ordersRes] = await Promise.all([
        axios.get(`${API_URL}/api/menu`),
        axios.get(`${API_URL}/api/tables`),
        axios.get(`${API_URL}/api/waiter/orders`)
      ]);
      setMenuItems(menuRes.data.filter(item => item.is_available));
      setTables(tablesRes.data);
      setActiveOrders(ordersRes.data);
      setIsLoading(false);
    } catch (error) {
      console.error('Error fetching data:', error);
      setIsLoading(false);
    }
  };

  const addToCart = (item) => {
    if (!selectedTable) {
      toast.error("Please select a table first!");
      return;
    }
    setCart((prev) => {
      const existing = prev.find((i) => i.id === item.id);
      if (existing) {
        return prev.map((i) => i.id === item.id ? { ...i, qty: i.qty + 1 } : i);
      }
      return [...prev, { ...item, qty: 1 }];
    });
  };

  const updateCartQty = (id, delta) => {
    setCart((prev) => prev.map((item) => {
      if (item.id === id) {
        const newQty = item.qty + delta;
        return newQty > 0 ? { ...item, qty: newQty } : item;
      }
      return item;
    }));
  };

  const removeCartItem = (id) => {
    setCart((prev) => prev.filter((item) => item.id !== id));
  };

  const cartTotal = cart.reduce((sum, item) => sum + (parseFloat(item.price) * item.qty), 0);

  const sendOrder = async () => {
    if (cart.length === 0 || !selectedTable) return;
    try {
      const payload = {
        table_id: selectedTable,
        subtotal: cartTotal,
        discount: 0,
        total: cartTotal,
        items: cart.map(i => ({ menu_item_id: i.id, quantity: i.qty, notes: "" }))
      };
      
      await axios.post(`${API_URL}/api/orders`, payload);
      toast.success("Order Sent to Kitchen!");
      setCart([]);
      setSelectedTable(null);
      fetchData();
    } catch (error) {
      console.error('Error sending order:', error);
      toast.error(`Failed to send order: ${error.response?.data?.error || error.message}`);
    }
  };

  const markServed = async (orderId) => {
    try {
      await axios.put(`${API_URL}/api/orders/${orderId}/status`, { status: 'Served' });
      fetchData();
    } catch (err) {
      console.error('Failed to mark served:', err);
    }
  };

  const handleCheckout = async (orderId) => {
    try {
      const receiptRes = await axios.get(`${API_URL}/api/orders/${orderId}/receipt`);
      setReceiptData(receiptRes.data);
      setPayingOrder(null);
    } catch (error) {
      console.error('Error generating receipt:', error);
      toast.error('Failed to fetch receipt data.');
    }
  };

  const handleManualPrint = () => {
    window.print();
  };

  const finalizeTableClosure = async () => {
    if (!receiptData) return;
    try {
      await axios.put(`${API_URL}/api/orders/${receiptData.id}/status`, { status: 'Completed' });
      toast.success('Table closed successfully!');
      setReceiptData(null);
      fetchData();
    } catch (err) {
      console.error('Error completing order:', err);
      toast.error('Failed to close table');
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    navigate('/login');
  };

  if (isLoading) return <div className="p-10 text-center text-gray-500 font-medium">Loading POS...</div>;

  const readyOrdersCount = activeOrders.filter(o => o.status === 'Ready').length;

  return (
    <>
      <div className="flex flex-col lg:flex-row h-screen overflow-hidden bg-gray-50 print:hidden">
      
      {/* Left: Menu Grid */}
      <div className="flex-1 p-4 lg:p-6 overflow-y-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
          <div className="flex flex-wrap items-center gap-3 sm:gap-4 w-full sm:w-auto">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">Waiter POS</h1>
            
            <button
              onClick={() => setShowOrdersModal(true)}
              className={`px-4 py-2 rounded-md font-medium transition-colors border ${readyOrdersCount > 0 ? 'bg-yellow-100 text-yellow-800 border-yellow-300' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
            >
              Active Orders ({activeOrders.length})
            </button>

            {billRequests.length > 0 && (
              <button
                onClick={() => { setShowOrdersModal(true); setBillRequests([]); }}
                className="px-4 py-2 rounded-md font-medium border bg-yellow-100 text-yellow-900 border-yellow-300 animate-pulse"
              >
                🔔 Bill requested: {billRequests.map((n) => `Table ${n}`).join(', ')}
              </button>
            )}
            <button onClick={handleLogout} className="text-sm font-medium text-red-600 hover:text-red-800 px-3 py-2">Logout</button>
          </div>
          
          <select 
            className="w-full sm:w-auto bg-white text-gray-900 font-medium py-2 px-4 rounded-md border border-gray-300 outline-none focus:border-blue-500 shadow-sm"
            value={selectedTable || ""}
            onChange={e => setSelectedTable(e.target.value)}
          >
            <option value="" disabled>Select Table...</option>
            {tables.map(t => (
              <option key={t.id} value={t.id}>
                Table {t.table_number} ({t.status})
              </option>
            ))}
          </select>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {menuItems.map((item) => (
            <div 
              key={item.id} 
              onClick={() => addToCart(item)}
              className="bg-white border border-gray-200 rounded-lg overflow-hidden cursor-pointer hover:border-blue-400 hover:shadow-md transition-all group shadow-sm"
            >
              <div className="h-32 w-full overflow-hidden bg-gray-100 border-b border-gray-100">
                <img 
                  src={item.image_url} 
                  alt={item.name} 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              </div>
              <div className="p-4">
                <div className="text-xs text-gray-500 mb-1 uppercase tracking-wider font-semibold">{item.category}</div>
                <h3 className="text-sm font-bold text-gray-900 leading-tight mb-2">{item.name}</h3>
                <div className="text-blue-600 font-bold">৳{parseFloat(item.price).toFixed(2)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: Cart (Side or Bottom depending on screen) */}
      <div className="w-full lg:w-96 h-[40vh] lg:h-full flex-shrink-0 bg-white border-t lg:border-l lg:border-t-0 border-gray-200 flex flex-col shadow-lg z-10">
        <div className="p-5 border-b border-gray-200 bg-gray-50">
          <h2 className="text-lg font-bold text-gray-900">Current Order</h2>
          <p className="text-sm text-gray-500 font-medium">
            {selectedTable ? `Table ${tables.find(t => t.id === selectedTable)?.table_number}` : 'No table selected'}
          </p>
        </div>
        
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {cart.length === 0 ? (
            <div className="text-gray-400 text-center mt-10 text-sm font-medium">Cart is empty</div>
          ) : (
            cart.map((item, idx) => (
              <div key={idx} className="flex flex-col gap-2 bg-gray-50 border border-gray-200 p-3 rounded-md">
                <div className="flex justify-between items-start">
                  <div className="text-gray-900 font-medium text-sm pr-2">{item.name}</div>
                  <button 
                    onClick={() => removeCartItem(item.id)}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                    aria-label="Remove item"
                  >
                    &times;
                  </button>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => updateCartQty(item.id, -1)}
                      disabled={item.qty <= 1}
                      className="w-7 h-7 rounded bg-white border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                    >
                      -
                    </button>
                    <span className="text-sm font-medium w-4 text-center">{item.qty}</span>
                    <button 
                      onClick={() => updateCartQty(item.id, 1)}
                      className="w-7 h-7 rounded bg-white border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100"
                    >
                      +
                    </button>
                  </div>
                  <div className="text-gray-900 font-bold text-sm">৳{(item.price * item.qty).toFixed(2)}</div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-5 border-t border-gray-200 bg-gray-50">
          <div className="flex justify-between text-base font-bold text-gray-900 mb-4">
            <span>Total:</span>
            <span>৳{cartTotal.toFixed(2)}</span>
          </div>
          <button 
            onClick={sendOrder}
            disabled={cart.length === 0 || !selectedTable}
            className={`w-full py-3 rounded-md font-medium text-white transition-colors ${cart.length === 0 || !selectedTable ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 shadow-sm'}`}
          >
            Send to Kitchen
          </button>
        </div>
      </div>

      {/* Orders Modal */}
      {showOrdersModal && (
        <div className="fixed inset-0 bg-gray-900/50 flex items-center justify-center p-4 z-50 print:hidden">
          <div className="bg-white w-full max-w-2xl rounded-lg shadow-xl flex flex-col max-h-[80vh]">
            <div className="p-5 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-900">Active Orders</h2>
              <button onClick={() => setShowOrdersModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
            </div>
            
            <div className="p-5 overflow-y-auto flex-1 space-y-3">
              {activeOrders.length === 0 ? (
                <div className="text-center text-gray-500 py-10 text-sm">No active orders</div>
              ) : (
                activeOrders.map(order => (
                  <div key={order.order_id} className={`p-4 rounded-md flex justify-between items-center border ${order.status === 'Ready' ? 'border-yellow-200 bg-yellow-50' : 'border-gray-200 bg-white'}`}>
                    <div className="flex-1">
                      <div className="text-base font-bold text-gray-900 mb-0.5">Table {order.table_number}</div>
                      <div className="text-xs text-gray-500 mb-2">
                        Order #{order.order_id.split('-')[0]} · ৳{parseFloat(order.total || 0).toFixed(2)}
                      </div>
                      {order.items && order.items.length > 0 && (
                        <ul className="text-xs text-gray-600 bg-white/50 rounded p-2 border border-gray-100 space-y-0.5 mr-4 max-h-24 overflow-y-auto">
                          {order.items.map((it, i) => (
                            <li key={i} className="flex justify-between">
                              <span>{it.quantity}× {it.name}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {order.status === 'Ready' ? (
                        <button
                          onClick={() => markServed(order.order_id)}
                          className="px-4 py-1.5 rounded-md text-sm font-medium bg-yellow-100 text-yellow-800 border border-yellow-200 hover:bg-yellow-200 transition-colors"
                        >
                          Pick Up / Serve
                        </button>
                      ) : (
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                          order.status === 'Cooking' ? 'bg-blue-100 text-blue-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {order.status}
                        </span>
                      )}
                      <button
                        onClick={() => setPayingOrder({
                          order_id: order.order_id,
                          table_id: order.table_id,
                          table_number: order.table_number,
                          total: order.total,
                          order_status: order.status,
                        })}
                        className="px-4 py-1.5 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                      >
                        Take Payment
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="p-5 border-t border-gray-200 bg-gray-50">
              <button onClick={() => setShowOrdersModal(false)} className="w-full bg-white border border-gray-300 text-gray-700 font-medium py-2 rounded-md hover:bg-gray-50 transition-colors">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Payment at the table */}
      {payingOrder && (
        <PaymentModal
          order={payingOrder}
          onClose={() => setPayingOrder(null)}
          onPaid={fetchData}
          onCheckout={handleCheckout}
        />
      )}
      
      {/* Post-Payment Print Modal */}
      {receiptData && (
        <div className="fixed inset-0 bg-gray-900/50 flex items-center justify-center p-4 z-50 print:hidden">
          <div className="bg-white w-full max-w-sm rounded-lg shadow-xl p-6 text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Payment Done!</h2>
            <p className="text-gray-500 mb-6 text-sm">You can now print the invoice. Print it as many times as you need until it comes out perfectly.</p>
            
            <div className="flex flex-col gap-3">
              <button 
                onClick={handleManualPrint}
                className="w-full bg-blue-100 text-blue-700 border border-blue-300 font-bold py-3 rounded-lg flex items-center justify-center gap-2 hover:bg-blue-200 transition-colors shadow-sm"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
                Print Invoice
              </button>
              <button 
                onClick={finalizeTableClosure}
                className="w-full bg-green-600 text-white font-bold py-3 rounded-lg hover:bg-green-700 transition-colors shadow-sm mt-4"
              >
                ✅ Finish &amp; Close Table
              </button>
            </div>
          </div>
        </div>
      )}
      </div>

      {/* PRINT RECEIPT SECTION (Visible only during print) */}
      {receiptData && (
        <div className="hidden print:block w-full text-black font-mono text-xs p-2 bg-white h-auto">
          <div className="text-center mb-4">
            <h1 className="text-xl font-bold uppercase tracking-tight">Mamar Bari Restaurant</h1>
            <p className="mt-1">123 Food Street, Dhaka</p>
            <p>Tel: +880 1234 567 890</p>
          </div>
          
          <div className="mb-4 border-b border-black pb-2 text-xs">
            <div>Date: {new Date(receiptData.created_at).toLocaleString()}</div>
            <div>Order ID: {receiptData.id.split('-')[0]}...</div>
            <div>Table: {receiptData.table_number}</div>
            <div>Waiter: {receiptData.waiter_name || 'System'}</div>
          </div>

          <table className="w-full text-left mb-4 text-xs">
            <thead>
              <tr className="border-b border-black">
                <th className="pb-1 font-bold">Item</th>
                <th className="pb-1 text-center font-bold">Qty</th>
                <th className="pb-1 text-right font-bold">Price</th>
              </tr>
            </thead>
            <tbody>
              {receiptData.items.map((item, idx) => (
                <tr key={idx}>
                  <td className="py-1">{item.name}</td>
                  <td className="py-1 text-center">{item.quantity}</td>
                  <td className="py-1 text-right">{parseFloat(item.subtotal).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="border-t border-black pt-2 text-xs flex justify-between">
            <span>Subtotal:</span>
            <span>{parseFloat(receiptData.subtotal).toFixed(2)}</span>
          </div>
          <div className="text-xs flex justify-between mt-1">
            <span>Discount:</span>
            <span>{parseFloat(receiptData.discount).toFixed(2)}</span>
          </div>
          <div className="font-bold text-sm flex justify-between mt-2 pt-2 border-t border-black">
            <span>TOTAL:</span>
            <span>৳{parseFloat(receiptData.total).toFixed(2)}</span>
          </div>

          <div className="text-center mt-6 text-xs font-bold">
            Thank you for dining with us!
            <br/>
            Please come again.
          </div>
        </div>
      )}
    </>
  );
}
