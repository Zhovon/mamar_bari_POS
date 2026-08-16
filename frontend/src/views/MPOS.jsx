import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';

export default function MPOS() {
  const [menuItems, setMenuItems] = useState([]);
  const [tables, setTables] = useState([]);
  const [activeOrders, setActiveOrders] = useState([]);
  const [selectedTable, setSelectedTable] = useState(null);
  const [cart, setCart] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showOrdersModal, setShowOrdersModal] = useState(false);
  const navigate = useNavigate();

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

  useEffect(() => {
    fetchData();

    const socket = io(API_URL);
    socket.on('new_order', fetchData);
    socket.on('order_status_updated', fetchData);

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
      alert("Please select a table first!");
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
      alert("Order Sent to Kitchen!");
      setCart([]);
      setSelectedTable(null);
      fetchData();
    } catch (error) {
      console.error('Error sending order:', error);
      alert(`Failed to send order: ${error.response?.data?.error || error.message}`);
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

  const handleLogout = () => {
    localStorage.clear();
    navigate('/login');
  };

  if (isLoading) return <div className="p-10 text-center text-gray-500 font-medium">Loading POS...</div>;

  const readyOrdersCount = activeOrders.filter(o => o.status === 'Ready').length;

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      
      {/* Left: Menu Grid */}
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Waiter POS</h1>
            
            <button 
              onClick={() => setShowOrdersModal(true)} 
              className={`px-4 py-2 rounded-md font-medium transition-colors border ${readyOrdersCount > 0 ? 'bg-yellow-100 text-yellow-800 border-yellow-300' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
            >
              Active Orders ({activeOrders.length})
            </button>
            <button onClick={handleLogout} className="text-sm font-medium text-red-600 hover:text-red-800 px-3 py-2">Logout</button>
          </div>
          
          <select 
            className="bg-white text-gray-900 font-medium py-2 px-4 rounded-md border border-gray-300 outline-none focus:border-blue-500 shadow-sm"
            value={selectedTable || ""}
            onChange={(e) => setSelectedTable(e.target.value)}
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

      {/* Right: Cart Sidebar */}
      <div className="w-80 bg-white border-l border-gray-200 flex flex-col shadow-sm">
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
              <div key={idx} className="flex justify-between items-start bg-gray-50 border border-gray-100 p-3 rounded-md">
                <div>
                  <div className="text-gray-900 font-medium text-sm">{item.name}</div>
                  <div className="text-gray-500 text-xs mt-0.5">৳{item.price} x {item.qty}</div>
                </div>
                <div className="text-gray-900 font-bold text-sm">৳{(item.price * item.qty).toFixed(2)}</div>
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
        <div className="fixed inset-0 bg-gray-900/50 flex items-center justify-center p-4 z-50">
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
                    <div>
                      <div className="text-base font-bold text-gray-900 mb-0.5">Table {order.table_number}</div>
                      <div className="text-xs text-gray-500">Order #{order.order_id.split('-')[0]}</div>
                    </div>
                    <div>
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
      
    </div>
  );
}
