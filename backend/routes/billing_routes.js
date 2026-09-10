const express = require('express');
const router = express.Router();
const {
    fetchPatientBillingData,
    createInvoice,
    getInvoices,
    getInvoiceById,
    getRevenueStats
} = require('../controllers/billing_controller');

const { protect, authorize } = require('../utils/auth_middleware');
const { requireService } = require('../utils/service_gate_middleware');

// 🔒 Protect all billing routes
router.use(protect);
// 🔒 Gate behind billing service subscription
router.use(requireService('billing'));

// 📊 Live Revenue Analytics
router.get('/revenue-stats', authorize('receptionist', 'admin', 'doctor', 'lab'), getRevenueStats);

// 🔍 Auto-fetch patient & appointment billing info by phone
router.get('/patient-fetch/:phone', authorize('receptionist', 'admin', 'doctor', 'lab'), fetchPatientBillingData);

// 🧾 Create new invoice (Clinic or Lab)
router.post('/create', authorize('receptionist', 'admin', 'doctor', 'lab'), createInvoice);

// 📋 Get invoice list with search & filters
router.get('/invoices', authorize('receptionist', 'admin', 'doctor', 'lab'), getInvoices);

// 📄 Get single invoice by ID
router.get('/invoice/:id', authorize('receptionist', 'admin', 'doctor', 'lab'), getInvoiceById);

module.exports = router;
