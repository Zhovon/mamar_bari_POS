import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import PaymentModal from '../components/PaymentModal';
import { useToast } from '../context/ToastContext';

const TABS = [
  { key: 'tables', label: 'Tables' },
  { key: 'confirm', label: 'QR Orders' },
  { key: 'menu', label: 'Menu' },
  { key: 'codes', label: 'Table QR Codes' },
  { key: 'reviews', label: 'Reviews' },
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
  const [ingredients, setIngredients] = useState([]);
  
  // Inventory form state
  const [editingIngredient, setEditingIngredient] = useState(null);
  const [inventoryForm, setInventoryForm] = useState({ name: '', unit: 'g', current_stock: '', alert_threshold: '' });
  
  // Recipe form state (Modal)
  const [showRecipeModal, setShowRecipeModal] = useState(false);
  const [activeRecipeMenuItem, setActiveRecipeMenuItem] = useState(null);
  const [activeRecipes, setActiveRecipes] = useState([]);
  const [recipeForm, setRecipeForm] = useState({ ingredient_id: '', quantity_required: '' });
  const toast = useToast();
  
  // Payment state (Modal)
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [activePaymentOrder, setActivePaymentOrder] = useState(null);

  // Customer reviews
  const [reviews, setReviews] = useState({ reviews: [], count: 0, average: null });

  // Table numbers whose guests tapped "Request bill" on their phone.
  const [billRequests, setBillRequests] = useState([]);


  // Menu form state
  const [editingItem, setEditingItem] = useState(null);
  const [menuForm, setMenuForm] = useState({ name: '', category: 'Grill', price: '', image_url: '', is_available: true });

  // Add table state
  const [showAddTable, setShowAddTable] = useState(false);
  const [newTableNum, setNewTableNum] = useState('');
  const [newTableCap, setNewTableCap] = useState(4);

  const navigate = useNavigate();
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

  const [activeDropdownId, setActiveDropdownId] = useState(null);

  // Click-away listener for dropdowns
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest('.action-dropdown-container')) {
        setActiveDropdownId(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  useEffect(() => {
    fetchDashboard();
    fetchMenu();
    fetchPending();
    fetchIngredients();
    fetchReviews();

    const socket = io(API_URL);
    const refreshAll = () => { fetchDashboard(); fetchPending(); };
    socket.on('new_order', refreshAll);
    socket.on('order_status_updated', refreshAll);
    socket.on('qr_order_pending', fetchPending);
    socket.on('review_submitted', fetchReviews);
    // A guest tapped "Request bill" on their phone.
    socket.on('bill_requested', ({ tableNumber }) => {
      setBillRequests((prev) => (prev.includes(tableNumber) ? prev : [...prev, tableNumber]));
    });

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
      toast.error(`Failed to confirm: ${error.response?.data?.error || error.message}`);
    }
  };

  const rejectOrder = async (orderId) => {
    if (!window.confirm('Reject this order?')) return;
    try {
      await axios.post(`${API_URL}/api/orders/${orderId}/reject`);
      fetchPending();
    } catch (error) {
      toast.error(`Failed to reject: ${error.response?.data?.error || error.message}`);
    }
  };

  const generateTableQR = async (tableId) => {
    try {
      const { data } = await axios.get(`${API_URL}/api/tables/${tableId}/qr`);
      const dataUrl = await QRCode.toDataURL(data.url, { width: 320, margin: 2 });
      setQrCodes((prev) => ({ ...prev, [tableId]: { dataUrl, url: data.url, table_number: data.table_number } }));
    } catch (error) {
      toast.error(`Failed to generate QR: ${error.response?.data?.error || error.message}`);
    }
  };

  // Burns the printed sticker for one table and issues a fresh code.
  const rotateTableQR = async (tableId) => {
    if (!window.confirm('Reset this table\'s code? The QR currently on the table will stop working and must be reprinted.')) return;
    try {
      const { data } = await axios.post(`${API_URL}/api/tables/${tableId}/qr/rotate`);
      const dataUrl = await QRCode.toDataURL(data.url, { width: 320, margin: 2 });
      setQrCodes((prev) => ({ ...prev, [tableId]: { dataUrl, url: data.url, table_number: data.table_number } }));
    } catch (error) {
      toast.error(`Failed to reset code: ${error.response?.data?.error || error.message}`);
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

  const fetchIngredients = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/inventory`);
      setIngredients(response.data);
    } catch (error) {
      console.error('Error fetching inventory:', error);
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
          toast.success(`Table checked out successfully!`);
          setReceiptData(null); 
          setShowPaymentModal(false);
          fetchDashboard();
        } catch (err) {
          console.error('Error completing order after print:', err);
        }
      }, 500);
    } catch (error) {
      console.error('Error generating receipt:', error);
      toast.error('Failed to fetch receipt data.');
    }
  };

  const openPaymentModal = (table) => {
    setActivePaymentOrder(table);
    setShowPaymentModal(true);
  };

  const fetchReviews = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/reviews`);
      setReviews(res.data);
    } catch (error) {
      console.error('Error fetching reviews:', error);
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

  // Inventory Management Logic
  const handleSaveInventory = async (e) => {
    e.preventDefault();
    try {
      if (editingIngredient) {
        await axios.put(`${API_URL}/api/inventory/${editingIngredient.id}`, inventoryForm);
      } else {
        await axios.post(`${API_URL}/api/inventory`, inventoryForm);
      }
      setEditingIngredient(null);
      setInventoryForm({ name: '', unit: 'g', current_stock: '', alert_threshold: '' });
      fetchIngredients();
    } catch (error) {
      console.error('Error saving ingredient:', error);
    }
  };

  const handleDeleteInventory = async (id) => {
    if(!window.confirm("Delete this ingredient?")) return;
    try {
      await axios.delete(`${API_URL}/api/inventory/${id}`);
      fetchIngredients();
    } catch (error) {
      console.error('Error deleting ingredient:', error);
    }
  };

  // Recipe Management Logic
  const openRecipeModal = async (menuItem) => {
    setActiveRecipeMenuItem(menuItem);
    setShowRecipeModal(true);
    fetchRecipes(menuItem.id);
  };

  const fetchRecipes = async (menuItemId) => {
    try {
      const res = await axios.get(`${API_URL}/api/menu/${menuItemId}/recipes`);
      setActiveRecipes(res.data);
    } catch (error) {
      console.error('Error fetching recipes:', error);
    }
  };

  const handleAddRecipe = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_URL}/api/menu/${activeRecipeMenuItem.id}/recipes`, recipeForm);
      setRecipeForm({ ingredient_id: '', quantity_required: '' });
      fetchRecipes(activeRecipeMenuItem.id);
    } catch (error) {
      console.error('Error adding recipe:', error);
    }
  };

  const handleDeleteRecipe = async (id) => {
    try {
      await axios.delete(`${API_URL}/api/recipes/${id}`);
      fetchRecipes(activeRecipeMenuItem.id);
    } catch (error) {
      console.error('Error deleting recipe:', error);
    }
  };

  const handleAddTable = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API_URL}/api/tables`, {
        table_number: parseInt(newTableNum),
        capacity: parseInt(newTableCap)
      });
      setShowAddTable(false);
      setNewTableNum('');
      setNewTableCap(4);
      fetchDashboard();
      
      if (res.data && res.data.id) {
        generateTableQR(res.data.id);
      }
    } catch (error) {
      toast.error(`Failed to add table: ${error.response?.data?.error || error.message}`);
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
        <div className="bg-white border-b border-gray-200 p-4 lg:p-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 sm:mb-6 gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">Manager Dashboard</h1>
            </div>
            <button onClick={handleLogout} className="w-full sm:w-auto bg-white border border-gray-300 text-gray-700 font-medium px-4 py-2 rounded-md hover:bg-gray-50 transition-colors shadow-sm">Logout</button>
          </div>
          
          <div className="flex space-x-4 border-b border-gray-200 overflow-x-auto whitespace-nowrap hide-scrollbar">
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
        <div className="flex-1 p-4 lg:p-12 overflow-y-auto">
          
          {/* TAB: TABLES */}
          {activeTab === 'tables' && (
            <div>
              {billRequests.length > 0 && (
                <div className="mb-6 bg-yellow-50 border border-yellow-300 rounded-lg p-4 flex items-center justify-between">
                  <div className="text-sm font-medium text-yellow-900">
                    🔔 Bill requested from the table: {billRequests.map((n) => `Table ${n}`).join(', ')}
                  </div>
                  <button onClick={() => setBillRequests([])} className="text-xs font-medium text-yellow-800 hover:text-yellow-950 underline">Dismiss</button>
                </div>
              )}
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-gray-900">Floor Plan</h2>
                <button 
                  onClick={() => setShowAddTable(true)}
                  className="bg-blue-600 text-white font-medium px-4 py-2 rounded-md hover:bg-blue-700 shadow-sm"
                >
                  + Add Table
                </button>
              </div>

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
                            <div className="text-xs font-medium text-blue-600 mt-2 bg-blue-50 px-2 py-1 rounded mb-3">Status: {table.order_status}</div>
                            {table.items && table.items.length > 0 && (
                              <ul className="w-full text-xs text-gray-600 bg-white rounded border border-gray-200 p-2 text-left space-y-1 max-h-24 overflow-y-auto">
                                {table.items.map((it, i) => (
                                  <li key={i} className="flex justify-between border-b border-gray-50 last:border-0 pb-1 last:pb-0">
                                    <span className="truncate pr-2">{it.quantity}× {it.name}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </>
                        ) : (
                          <div className="text-gray-400 text-sm font-medium">No active orders</div>
                        )}
                      </div>
                    </div>

                    <div className="px-5 pb-5">
                      <button 
                        onClick={() => openPaymentModal(table)}
                        disabled={!table.order_id}
                        className={`w-full py-2.5 rounded-md font-medium transition-colors shadow-sm ${table.order_id ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200'}`}
                      >
                        Process Payment
                      </button>
                    </div>
                  </div>
                ))}
              </div>
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
              <p className="text-sm text-gray-500 mb-2">
                Each table has one permanent code. Print it once, stick it on the table — it never expires,
                so the same sticker works for every customer, every day.
              </p>
              <p className="text-sm text-gray-500 mb-6">
                <strong>Check the link under each code before printing a batch.</strong> It must be your live
                site address — anything else means reprinting every sticker.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {tables.map((table) => {
                  const code = qrCodes[table.table_id];
                  const badUrl = code && /localhost|127\.0\.0\.1/.test(code.url);
                  return (
                    <div key={table.table_id} className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 flex flex-col items-center">
                      <h3 className="text-lg font-bold text-gray-900 mb-3">Table {table.table_number}</h3>
                      {code ? (
                        <>
                          <img src={code.dataUrl} alt={`Table ${table.table_number} QR`} className="w-40 h-40 mb-2" />
                          <div className="w-full mb-3">
                            <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 mb-0.5">Scans to</div>
                            <div className="text-[11px] text-gray-600 break-all leading-snug">{code.url}</div>
                          </div>
                          {badUrl && (
                            <div className="w-full mb-3 text-[11px] font-medium text-red-700 bg-red-50 border border-red-200 rounded-md p-2">
                              This link points at a development address and will not work on a customer&apos;s
                              phone. Set FRONTEND_URL on the server before printing.
                            </div>
                          )}
                          <button
                            onClick={() => printTableQR(code)}
                            disabled={badUrl}
                            className="w-full bg-blue-600 text-white text-sm font-medium py-2 rounded-md hover:bg-blue-700 shadow-sm disabled:bg-gray-300 disabled:cursor-not-allowed"
                          >
                            Print
                          </button>
                        </>
                      ) : (
                        <div className="w-40 h-40 mb-3 flex items-center justify-center bg-gray-50 border border-dashed border-gray-300 rounded-md text-gray-400 text-sm">No code yet</div>
                      )}
                      <button onClick={() => generateTableQR(table.table_id)} className="w-full mt-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium py-2 rounded-md hover:bg-gray-50">{code ? 'Show again' : 'Show QR'}</button>
                      {code && (
                        <button
                          onClick={() => rotateTableQR(table.table_id)}
                          className="w-full mt-2 text-xs font-medium text-red-600 hover:text-red-800 py-1"
                        >
                          Reset code (old sticker stops working)
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB: CUSTOMER REVIEWS */}
          {activeTab === 'reviews' && (
            <div className="max-w-3xl mx-auto">
              <h2 className="text-xl font-bold text-gray-900 mb-1">Customer Reviews</h2>
              <p className="text-sm text-gray-500 mb-6">Collected on the customer&apos;s phone right after their bill is settled.</p>

              <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 mb-6 flex items-center gap-8">
                <div>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Average</div>
                  <div className="text-3xl font-bold text-gray-900">
                    {reviews.average !== null ? reviews.average.toFixed(2) : '—'}
                    <span className="text-yellow-400 text-2xl ml-1">★</span>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Reviews</div>
                  <div className="text-3xl font-bold text-gray-900">{reviews.count}</div>
                </div>
              </div>

              {reviews.reviews.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-lg border border-gray-200 text-gray-500 text-sm">No reviews yet.</div>
              ) : (
                <div className="space-y-3">
                  {reviews.reviews.map((r) => (
                    <div key={r.id} className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
                      <div className="flex justify-between items-start mb-1">
                        <div className="text-yellow-400 text-lg leading-none">
                          {'★'.repeat(r.rating)}<span className="text-gray-300">{'★'.repeat(5 - r.rating)}</span>
                        </div>
                        <div className="text-xs text-gray-400">{new Date(r.created_at).toLocaleString()}</div>
                      </div>
                      <div className="text-xs text-gray-500 mb-2">
                        Table {r.table_number ?? '—'}
                        {r.guest_name ? ` · ${r.guest_name}` : ''}
                        {r.phone_number ? ` · ${r.phone_number}` : ''}
                      </div>
                      {r.comment && <p className="text-sm text-gray-800">{r.comment}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB: MENU MANAGEMENT */}
          {activeTab === 'menu' && (
            <div className="flex flex-col lg:flex-row gap-8 items-start">
              {/* Form */}
              <div className="w-full lg:w-1/3 bg-white p-6 rounded-lg shadow-sm border border-gray-200 lg:sticky top-6">
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
                <div className="overflow-x-auto w-full">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Item</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {menuItems.map(item => (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="h-10 w-10 flex-shrink-0">
                              <img className="h-10 w-10 rounded-md object-cover" src={item.image_url} alt="" />
                            </div>
                            <div className="ml-4">
                              <div className="text-sm font-medium text-gray-900">{item.name}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{item.category}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 font-bold">৳{parseFloat(item.price).toFixed(2)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${item.is_available ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {item.is_available ? 'In Stock' : 'Out of Stock'}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium relative action-dropdown-container">
                          <button onClick={() => setActiveDropdownId(activeDropdownId === `menu-${item.id}` ? null : `menu-${item.id}`)} className="p-2 text-gray-500 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-full transition-colors focus:outline-none">
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z"/></svg>
                          </button>
                          {activeDropdownId === `menu-${item.id}` && (
                            <div className="absolute right-12 top-2 mt-2 w-32 bg-white rounded-md shadow-lg border border-gray-100 z-50 py-1 text-left">
                              <button onClick={() => { openRecipeModal(item); setActiveDropdownId(null); }} className="block w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 text-left">Recipe</button>
                              <button onClick={() => { setEditingItem(item); setMenuForm(item); setActiveDropdownId(null); }} className="block w-full px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 text-left">Edit</button>
                              <button onClick={() => { handleDeleteMenu(item.id); setActiveDropdownId(null); }} className="block w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50 text-left">Delete</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB: INVENTORY */}
          {activeTab === 'inventory' && (
            <div className="flex flex-col lg:flex-row gap-8 items-start">
              {/* Form */}
              <div className="w-full lg:w-1/3 bg-white p-6 rounded-lg shadow-sm border border-gray-200 lg:sticky top-6">
                <h2 className="text-xl font-bold text-gray-900 mb-6">{editingIngredient ? 'Edit Ingredient' : 'Add New Ingredient'}</h2>
                <form onSubmit={handleSaveInventory} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Ingredient Name</label>
                    <input type="text" required value={inventoryForm.name} onChange={e => setInventoryForm({...inventoryForm, name: e.target.value})} className="w-full border-gray-300 rounded-md shadow-sm p-2 border focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                    <select value={inventoryForm.unit} onChange={e => setInventoryForm({...inventoryForm, unit: e.target.value})} className="w-full border-gray-300 rounded-md shadow-sm p-2 border focus:border-blue-500">
                      {['g', 'kg', 'ml', 'L', 'pcs'].map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Current Stock</label>
                    <input type="number" step="0.01" required value={inventoryForm.current_stock} onChange={e => setInventoryForm({...inventoryForm, current_stock: e.target.value})} className="w-full border-gray-300 rounded-md shadow-sm p-2 border focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Alert Threshold</label>
                    <input type="number" step="0.01" required value={inventoryForm.alert_threshold} onChange={e => setInventoryForm({...inventoryForm, alert_threshold: e.target.value})} className="w-full border-gray-300 rounded-md shadow-sm p-2 border focus:border-blue-500" />
                  </div>
                  <div className="pt-4 flex gap-3">
                    <button type="submit" className="flex-1 bg-blue-600 text-white py-2 rounded-md font-medium hover:bg-blue-700 shadow-sm">{editingIngredient ? 'Save Changes' : 'Add Ingredient'}</button>
                    {editingIngredient && (
                      <button type="button" onClick={() => { setEditingIngredient(null); setInventoryForm({ name: '', unit: 'g', current_stock: '', alert_threshold: '' }); }} className="flex-1 bg-white border border-gray-300 text-gray-700 py-2 rounded-md font-medium hover:bg-gray-50 shadow-sm">Cancel</button>
                    )}
                  </div>
                </form>
              </div>

              {/* Data Table */}
              <div className="flex-1 bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto w-full">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ingredient</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stock</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {ingredients.map(ing => (
                      <tr key={ing.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">{ing.name}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{parseFloat(ing.current_stock).toFixed(2)} {ing.unit}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {ing.current_stock <= ing.alert_threshold ? (
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">Low Stock</span>
                          ) : (
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">OK</span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium relative action-dropdown-container">
                          <button onClick={() => setActiveDropdownId(activeDropdownId === `inv-${ing.id}` ? null : `inv-${ing.id}`)} className="p-2 text-gray-500 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-full transition-colors focus:outline-none">
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z"/></svg>
                          </button>
                          {activeDropdownId === `inv-${ing.id}` && (
                            <div className="absolute right-12 top-2 mt-2 w-32 bg-white rounded-md shadow-lg border border-gray-100 z-50 py-1 text-left">
                              <button onClick={() => { setEditingIngredient(ing); setInventoryForm(ing); setActiveDropdownId(null); }} className="block w-full px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 text-left">Edit</button>
                              <button onClick={() => { handleDeleteInventory(ing.id); setActiveDropdownId(null); }} className="block w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50 text-left">Delete</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
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
      {/* RECIPE MODAL */}
      {showRecipeModal && activeRecipeMenuItem && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
              <h3 className="text-xl font-bold text-gray-900">Recipe: {activeRecipeMenuItem.name}</h3>
              <button onClick={() => setShowRecipeModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              <div className="mb-6 bg-blue-50 text-blue-800 p-4 rounded-md text-sm">
                Add ingredients here. When a customer orders <strong>{activeRecipeMenuItem.name}</strong>, these ingredients will be automatically deducted from the inventory.
              </div>

              <h4 className="font-bold text-gray-700 mb-3">Current Ingredients</h4>
              {activeRecipes.length === 0 ? (
                <div className="text-gray-500 text-sm mb-6 italic">No ingredients added yet.</div>
              ) : (
                <div className="overflow-x-auto w-full mb-6 border border-gray-200 rounded-md">
                  <table className="w-full text-left min-w-[400px]">
                    <thead className="bg-gray-100 text-xs uppercase text-gray-600 text-left">
                      <tr>
                        <th className="px-4 py-2">Ingredient</th>
                        <th className="px-4 py-2">Required Qty</th>
                        <th className="px-4 py-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 text-sm">
                      {activeRecipes.map(recipe => (
                        <tr key={recipe.id} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-medium">{recipe.name}</td>
                          <td className="px-4 py-2">{parseFloat(recipe.quantity_required).toFixed(2)} {recipe.unit}</td>
                          <td className="px-4 py-2 text-right">
                            <button onClick={() => handleDeleteRecipe(recipe.id)} className="text-red-500 hover:text-red-700 p-2 hover:bg-red-50 rounded-full transition-colors" title="Remove Ingredient">
                              <svg className="w-5 h-5 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h4 className="font-bold text-gray-700 mb-3">Add Ingredient</h4>
              <form onSubmit={handleAddRecipe} className="flex flex-col sm:flex-row gap-4 sm:items-end bg-gray-50 p-4 border border-gray-200 rounded-md">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Select Ingredient</label>
                  <select required value={recipeForm.ingredient_id} onChange={e => setRecipeForm({...recipeForm, ingredient_id: e.target.value})} className="w-full border-gray-300 rounded-md shadow-sm p-2 border focus:border-blue-500 text-sm">
                    <option value="">-- Choose --</option>
                    {ingredients.map(ing => <option key={ing.id} value={ing.id}>{ing.name} ({ing.unit})</option>)}
                  </select>
                </div>
                <div className="w-32">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Quantity</label>
                  <input type="number" step="0.01" required value={recipeForm.quantity_required} onChange={e => setRecipeForm({...recipeForm, quantity_required: e.target.value})} className="w-full border-gray-300 rounded-md shadow-sm p-2 border focus:border-blue-500 text-sm" placeholder="e.g. 1.5" />
                </div>
                <button type="submit" className="w-full sm:w-auto bg-blue-600 text-white px-4 py-2 rounded-md font-medium hover:bg-blue-700 text-sm shadow-sm sm:h-[38px]">Add</button>
              </form>
            </div>
            
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end bg-gray-50">
              <button onClick={() => setShowRecipeModal(false)} className="px-6 py-2 bg-gray-200 text-gray-800 rounded-md font-medium hover:bg-gray-300">Done</button>
            </div>
          </div>
        </div>
      )}

      {/* PAYMENT MODAL (Split Billing) -- shared with the waiter's handheld */}
      {showPaymentModal && activePaymentOrder && (
        <PaymentModal
          order={activePaymentOrder}
          onClose={() => setShowPaymentModal(false)}
          onPaid={fetchDashboard}
          onCheckout={handleCheckout}
        />
      )}
    </>
  );
}
