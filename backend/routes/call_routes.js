const express = require('express');
const router = express.Router();
const callController = require('../controllers/call_controller');
const { protect } = require('../utils/auth_middleware');

/**
 * 📞 DOCTOR CALL ROUTES
 */

// ✅ Initiate call and send WhatsApp
router.post('/initiate-call', protect, callController.initiateCall);

// ✅ Patient confirms call
router.post('/confirm-call/:callId', callController.confirmCall);

// ✅ Get doctor's call history
router.get('/history', protect, callController.getCallHistory);

// ✅ Get call statistics
router.get('/stats', protect, callController.getCallStats);

// ✅ Cancel scheduled reminders
router.post('/cancel-reminders/:callId', protect, callController.cancelReminders);

module.exports = router;
