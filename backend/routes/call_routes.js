const express = require('express');
const router = express.Router();
const callController = require('../controllers/call_controller');
const { protect } = require('../utils/auth_middleware');
const { requireService } = require('../utils/service_gate_middleware');

/**
 * 📞 DOCTOR CALL ROUTES
 */

// ✅ Initiate call and send SMS notification (requires messaging service)
router.post('/initiate-call', protect, requireService('messaging'), callController.initiateCall);

// ✅ Patient confirms call
router.post('/confirm-call/:callId', callController.confirmCall);

// ✅ Get doctor's call history
router.get('/history', protect, callController.getCallHistory);

// ✅ Get call statistics
router.get('/stats', protect, callController.getCallStats);

// ✅ Cancel scheduled reminders
router.post('/cancel-reminders/:callId', protect, callController.cancelReminders);

module.exports = router;
