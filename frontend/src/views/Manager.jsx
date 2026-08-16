import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';

const TABS = [
  { key: 'tables', label: 'Tables' },
  { key: 'confirm', label: 'QR Orders' },
  { key: 'menu', label: 'Menu' },
  { key: 'codes', label: 'Table QR Codes' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'analytics', label: 'Analytics' },
];

export default function Manager() {
  const [activeTab, setActiveTab] = useState('tables');
  const [tables, setTables] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [receiptData, setReceiptData] = useState(null);
  const [pendingOrders, setPendingOrders] = useState([]);
  const [qrCodes, setQrCodes] = useState({}); // table_id -> { dataUrl, url, table_number }
  
  // Menu form state
  const [editingItem, setEditingItem] = useState(null);
  const [menuForm, setMenuForm] = useState({ name: '', category: 'Grill', price: '', image_url: '', is_available: true });

  const navigate = useNavigate();
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

  useEffect(() => {
    fetchDashboard();
    fetchMenu();
    fetchPending();

    const socket = io(API_URL);
    const refreshAll = () => { fetchDashboard(); fetchPending(); };
    socket.on('new_order', refreshAll);
    socket.on('order_status_updated', refreshAll);
    socket.on('qr_order_pending', fetchPending);

    return () => socket.disconnect();
  }, []);

  const fetchPending = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/orders/pending-confirmation`);
      setPendingOrders(res.data);
    } catch (error) {
      console.error('Error fetching pending QR orders:', error);
    }
  };

  const confirmOrder = async (orderId) => {
    try {
      await axios.post(`${API_URL}/api/orders/${orderId}/confirm`);
      fetchPending();
      fetchDashboard();
    } catch (error) {
      alert(`Failed to confirm: ${error.response?.data?.error || error.message}`);
    }
  };

  const rejectOrder = async (orderId) => {
    if (!window.confirm('Reject this order?')) return;
    try {
      await axios.post(`${API_URL}/api/orders/${orderId}/reject`);
      fetchPending();
    } catch (error) {
      alert(`Failed to reject: ${error.response?.data?.error || error.message}`);
    }
  };

  const generateTableQR = async (tableId) => {
    try {
      const { data } = await axios.get(`${API_URL}/api/tables/${tableId}/qr`);
      const dataUrl = await QRCode.toDataURL(data.url, { width: 320, margin: 2 });
      setQrCodes((prev) => ({ ...prev, [tableId]: { dataUrl, url: data.url, table_number: data.table_number } }));
    } catch (error) {
      alert(`Failed to generate QR: ${error.response?.data?.error || error.message}`);
    }
  };

  const printTableQR = (code) => {
    const w = window.open('', '_blank');
    w.document.write(`
      <html><head><title>Table ${code.table_number} QR</title></head>
      <body style="text-align:center;font-family:sans-serif;padding:40px;">
        <h1 style="margin-bottom:4px;">Mamar Bari</h1>
        <h2 style="margin-top:0;">Table ${code.table_number}</h2>
        <p style="color:#555;">Scan to view the menu &amp; order</p>
        <img src="${code.dataUrl}" style="width:320px;height:320px;" />
      </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  const fetchDashboard = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/manager/dashboard`);
      setTables(response.data);
    } catch (error) {
      console.error('Error fetching dashboard:', error);
    }
  };

  const fetchMenu = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/menu`);
      setMenuItems(response.data);
    } catch (error) {
      console.error('Error fetching menu:', error);
    }
  };

  const handleCheckout = async (orderId, tableId) => {
    try {
      const receiptRes = await axios.get(`${API_URL}/api/orders/${orderId}/receipt`);
      setReceiptData(receiptRes.data);

      setTimeout(async () => {
        window.print();
        try {
          await axios.put(`${API_URL}/api/orders/${orderId}/status`, { status: 'Completed' });
          alert(`Table checked out successfully!`);
          setReceiptData(null); 
          fetchDashboard();
        } catch (err) {
          console.error('Error completing order after print:', err);
        }
      }, 500);
    } catch (error) {
      console.error('Error generating receipt:', error);
      alert('Failed to fetch receipt data.');
    }
  };

  // Menu Management Logic
  const handleSaveMenu = async (e) => {
    e.preventDefault();
    try {
      if (editingItem) {
        await axios.put(`${API_URL}/api/menu/${editingItem.id}`, menuForm);
      } else {
        await axios.post(`${API_URL}/api/menu`, menuForm);
      }
      setEditingItem(null);
      setMenuForm({ name: '', category: 'Grill', price: '', image_url: '', is_available: true });
      fetchMenu();
    } catch (error) {
      console.error('Error saving menu item:', error);
    }
  };

  const handleDeleteMenu = async (id) => {
    if(!window.confirm("Are you sure you want to delete this menu item?")) return;
    try {
      await axios.delete(`${API_URL}/api/menu/${id}`);
      fetchMenu();
    } catch (error) {
      console.error('Error deleting menu item:', error);
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    navigate('/login');
  };

  return (
    <>
      <div className="min-h-screen bg-gray-50 flex flex-col print:hidden">
        
        {/* Header & Navigation */}
        <div className="bg-white border-b border-gray-200 p-6">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Manager Dashboard</h1>
            </div>
            <button onClick={handleLogout} className="bg-white border border-gray-300 text-gray-700 font-medium px-4 py-2 rounded-md hover:bg-gray-50 transition-colors shadow-sm">Logout</button>
          </div>
          
          <div className="flex space-x-4 border-b border-gray-200">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`py-3 px-6 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
              >
                {tab.label}
                {tab.key === 'confirm' && pendingOrders.length > 0 && (
                  <span className="ml-2 inline-flex items-center justify-center bg-red-600 text-white text-xs font-bold rounded-full h-5 min-w-[20px] px-1.5">{pendingOrders.length}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 p-6 lg:p-12 overflow-y-auto">
          
          {/* TAB: TABLES */}
          {activeTab === 'tables' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {tables.map((table) => (
                <div key={table.table_id} className={`bg-white rounded-lg border shadow-sm flex flex-col overflow-hidden ${table.order_id ? 'border-t-4 border-t-blue-500 border-gray-200' : 'border-t-4 border-t-gray-300 border-gray-200'}`}>
                  <div className="p-5 flex-1">
                    <div className="flex justify-between items-start mb-4">
                      <h2 className="text-xl font-bold text-gray-900">Table {table.table_number}</h2>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${table.order_id ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                        {table.order_id ? 'Occupied' : 'Available'}
                      </span>
                    </div>
                    
                    <div className="min-h-[100px] flex flex-col justify-center items-center bg-gray-50 border border-gray-100 rounded-md mb-2 p-4">
                      {table.order_id ? (
                        <>
                          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Current Bill</div>
                          <div className="text-3xl font-bold text-gray-900 tracking-tight">৳{parseFloat(table.total).toFixed(2)}</div>
                          <div className="text-xs font-medium text-blue-600 mt-2 bg-blue-50 px-2 py-1 rounded">Status: {table.order_status}</div>
                        </>
                      ) : (
                        <div className="text-gray-400 text-sm font-medium">No active orders</div>
                      )}
                    </div>
                  </div>

                  <div className="px-5 pb-5">
                    <button 
                      onClick={() => handleCheckout(table.order_id, table.table_id)}
                      disabled={!table.order_id}
                      className={`w-full py-2.5 rounded-md font-medium transition-colors shadow-sm ${table.order_id ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200'}`}
                    >
                      Print Invoice & Close
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB: QR ORDER CONFIRMATION */}
          {activeTab === 'confirm' && (
            <div className="max-w-3xl mx-auto space-y-4">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Pending QR Orders</h2>
              {pendingOrders.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-lg border border-gray-200 text-gray-500 text-sm">No QR orders waiting for confirmation.</div>
              ) : (
                pendingOrders.map((order) => (
                  <div key={order.order_id} className="bg-white rounded-lg border border-yellow-200 border-t-4 border-t-yellow-400 shadow-sm p-5">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <div className="text-lg font-bold text-gray-900">Table {order.table_number}</div>
                        <div className="text-xs text-gray-500">
                          {order.guest_name ? `${order.guest_name} · ` : ''}{new Date(order.created_at).toLocaleTimeString()}
                        </div>
                      </div>
                      <div className="text-lg font-bold text-gray-900">৳{parseFloat(order.total).toFixed(2)}</div>
                    </div>
                    <ul className="text-sm text-gray-700 mb-4 space-y-1">
                      {order.items.map((it, idx) => (
                        <li key={idx} className="flex justify-between">
                          <span>{it.quantity}× {it.name}</span>
                          {it.notes ? <span className="text-gray-400 italic">{it.notes}</span> : null}
                        </li>
                      ))}
                    </ul>
                    <div className="flex gap-3">
                      <button onClick={() => confirmOrder(order.order_id)} className="flex-1 bg-green-600 text-white font-medium py-2 rounded-md hover:bg-green-700 shadow-sm">Accept &amp; Send to Kitchen</button>
                      <button onClick={() => rejectOrder(order.order_id)} className="px-5 bg-white border border-red-300 text-red-600 font-medium py-2 rounded-md hover:bg-red-50">Reject</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB: TABLE QR CODES */}
          {activeTab === 'codes' && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Table QR Codes</h2>
              <p className="text-sm text-gray-500 mb-6">Generate and print a QR code for each table. Customers scan it to order for that table only.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {tables.map((table) => {
                  const code = qrCodes[table.table_id];
                  return (
                    <div key={table.table_id} className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 flex flex-col items-center">
                      <h3 className="text-lg font-bold text-gray-900 mb-3">Table {table.table_number}</h3>
                      {code ? (
                        <>
                          <img src={code.dataUrl} alt={`Table ${table.table_number} QR`} className="w-40 h-40 mb-3" />
                          <button onClick={() => printTableQR(code)} className="w-full bg-blue-600 text-white text-sm font-medium py-2 rounded-md hover:bg-blue-700 shadow-sm">Print</button>
                        </>
                      ) : (
                        <div className="w-40 h-40 mb-3 flex items-center justify-center bg-gray-50 border border-dashed border-gray-300 rounded-md text-gray-400 text-sm">No code yet</div>
                      )}
                      <button onClick={() => generateTableQR(table.table_id)} className="w-full mt-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium py-2 rounded-md hover:bg-gray-50">{code ? 'Regenerate' : 'Generate QR'}</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB: MENU MANAGEMENT */}
          {activeTab === 'menu' && (
            <div className="flex gap-8 items-start">
              {/* Form */}
              <div className="w-1/3 bg-white p-6 rounded-lg shadow-sm border border-gray-200 sticky top-6">
                <h2 className="text-xl font-bold text-gray-900 mb-6">{editingItem ? 'Edit Menu Item' : 'Add New Item'}</h2>
                <form onSubmit={handleSaveMenu} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                    <input type="text" required value={menuForm.name} onChange={e => setMenuForm({...menuForm, name: e.target.value})} className="w-full border-gray-300 rounded-md shadow-sm p-2 border focus:border-blue-500 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                    <select value={menuForm.category} onChange={e => setMenuForm({...menuForm, category: e.target.value})} className="w-full border-gray-300 rounded-md shadow-sm p-2 border focus:border-blue-500 focus:ring-blue-500">
                      {['Grill', 'Curry', 'Biryani', 'Bread', 'Beverage', 'Dessert'].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Price (৳)</label>
                    <input type="number" step="0.01" required value={menuForm.price} onChange={e => setMenuForm({...menuForm, price: e.target.value})} className="w-full border-gray-300 rounded-md shadow-sm p-2 border focus:border-blue-500 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Image URL</label>
                    <input type="text" value={menuForm.image_url} onChange={e => setMenuForm({...menuForm, image_url: e.target.value})} className="w-full border-gray-300 rounded-md shadow-sm p-2 border focus:border-blue-500 focus:ring-blue-500" />
                  </div>
                  <div className="flex items-center">
                    <input type="checkbox" checked={menuForm.is_available} onChange={e => setMenuForm({...menuForm, is_available: e.target.checked})} className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded" />
                    <label className="ml-2 block text-sm text-gray-900">Available (In Stock)</label>
                  </div>
                  <div className="pt-4 flex gap-3">
                    <button type="submit" className="flex-1 bg-blue-600 text-white py-2 rounded-md font-medium hover:bg-blue-700 shadow-sm">{editingItem ? 'Save Changes' : 'Create Item'}</button>
                    {editingItem && (
                      <button type="button" onClick={() => { setEditingItem(null); setMenuForm({ name: '', category: 'Grill', price: '', image_url: '', is_available: true }); }} className="flex-1 bg-white border border-gray-300 text-gray-700 py-2 rounded-md font-medium hover:bg-gray-50 shadow-sm">Cancel</button>
                    )}
                  </div>
                </form>
              </div>

              {/* Data Table */}
              <div className="flex-1 bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Item</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {menuItems.map(item => (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="h-10 w-10 flex-shrink-0">
                              <img className="h-10 w-10 rounded-md object-cover" src={item.image_url} alt="" />
                            </div>
                            <div className="ml-4">
                              <div className="text-sm font-medium text-gray-900">{item.name}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{item.category}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-bold">৳{parseFloat(item.price).toFixed(2)}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${item.is_available ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {item.is_available ? 'In Stock' : 'Out of Stock'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <button onClick={() => { setEditingItem(item); setMenuForm(item); }} className="text-blue-600 hover:text-blue-900 mr-4">Edit</button>
                          <button onClick={() => handleDeleteMenu(item.id)} className="text-red-600 hover:text-red-900">Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB: INVENTORY */}
          {activeTab === 'inventory' && (
            <div className="text-center py-20">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Inventory Management</h2>
              <p className="text-gray-500">Coming soon in Phase 6.1</p>
            </div>
          )}

          {/* TAB: ANALYTICS */}
          {activeTab === 'analytics' && (
            <div className="text-center py-20">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Sales Analytics</h2>
              <p className="text-gray-500">Coming soon in Phase 6.2</p>
            </div>
          )}

        </div>
      </div>

      {/* PRINT RECEIPT SECTION (Visible only during print) */}
      {receiptData && (
        <div className="hidden print:block w-full text-black font-mono text-xs p-2 bg-white h-auto">
          {/* ... [Receipt logic omitted for brevity in this snippet, assumes unchanged] ... */}
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
