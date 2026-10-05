const express = require('express');
const router = express.Router();
const slotHoldController = require('../controllers/slot_hold_controller');
const { slotHoldLimiter, publicReadLimiter } = require('../utils/security_middleware');

// Public endpoints with IP rate limit protection
router.post('/hold', slotHoldLimiter, slotHoldController.holdSlot);
router.post('/release', slotHoldController.releaseSlot);
router.get('/status/:holdToken', publicReadLimiter, slotHoldController.getHoldStatus);

module.exports = router;
