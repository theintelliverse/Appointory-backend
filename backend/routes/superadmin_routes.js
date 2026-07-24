const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/superadmin_controller');
const { protect, authorize, protectLab } = require('../utils/auth_middleware');
const { publicWriteLimiter } = require('../utils/security_middleware');

// Public lookup configs
router.get('/config/public', ctrl.getPublicConfig);
router.post('/tickets/create', publicWriteLimiter, ctrl.createTicket);
router.get('/plans/public', ctrl.getPublicPlans);

// Subscription Checkout routes (accessible by clinic staff and independent labs)
router.post('/subscription/checkout', protect, ctrl.generateRazorpayOrder);
router.post('/subscription/verify', protect, ctrl.verifyRazorpayPayment);
router.post('/subscription/lab-checkout', protectLab, ctrl.generateRazorpayOrder);
router.post('/subscription/lab-verify', protectLab, ctrl.verifyRazorpayPayment);
router.get('/subscription/history', protect, ctrl.getFacilityBillingHistory);
router.get('/subscription/lab-history', protectLab, ctrl.getFacilityBillingHistory);

// Admin-protected actions
router.get('/facilities', protect, authorize('superadmin'), ctrl.getFacilities);
router.get('/facility/:id/overview', protect, authorize('superadmin'), ctrl.getFacilityOverview);
router.patch('/facility/:id/approval', protect, authorize('superadmin'), ctrl.approveOrRejectFacility);
router.patch('/facility/:id/premium', protect, authorize('superadmin'), ctrl.togglePremium);
router.patch('/facility/:id/network', protect, authorize('superadmin'), ctrl.toggleNetwork);
router.patch('/facility/:id/active', protect, authorize('superadmin'), ctrl.toggleActive);
router.post('/facility/:id/gift-subscription', protect, authorize('superadmin'), ctrl.giftSubscription);
router.patch('/facility/:id/subscription-price', protect, authorize('superadmin'), ctrl.setSubscriptionPrice);
router.patch('/facility/:id/subscription', protect, authorize('superadmin'), ctrl.updateFacilitySubscription);
router.patch('/facility/:id/custom-limits', protect, authorize('superadmin'), ctrl.setCustomLimits);
router.delete('/subscription/payment/:id', protect, authorize('superadmin'), ctrl.deleteSubscriptionPayment);
router.delete('/facility/:id', protect, authorize('superadmin'), ctrl.deleteFacility);

router.get('/config', protect, authorize('superadmin'), ctrl.getSystemConfig);
router.patch('/config', protect, authorize('superadmin'), ctrl.updateSystemConfig);
router.patch('/update-credentials', protect, authorize('superadmin'), ctrl.updateCredentials);

router.get('/tickets', protect, authorize('superadmin'), ctrl.getTickets);
router.patch('/tickets/:id/resolve', protect, authorize('superadmin'), ctrl.resolveTicket);

router.get('/promo', protect, authorize('superadmin'), ctrl.getPromoCodes);
router.post('/promo', protect, authorize('superadmin'), ctrl.createPromoCode);
router.delete('/promo/:id', protect, authorize('superadmin'), ctrl.deletePromoCode);

router.get('/plans', protect, authorize('superadmin'), ctrl.getPlans);
router.post('/plans', protect, authorize('superadmin'), ctrl.createPlan);
router.put('/plans/:id', protect, authorize('superadmin'), ctrl.updatePlan);
router.delete('/plans/:id', protect, authorize('superadmin'), ctrl.deletePlan);

module.exports = router;
