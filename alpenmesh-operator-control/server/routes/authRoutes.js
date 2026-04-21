const express = require('express');
const router = express.Router();
const { registerUser, loginUser } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const { role } = require('../middleware/roleMiddleware');

router.post('/register', registerUser);
router.post('/login', loginUser);

// Protected Admin Route
router.get('/admin', protect, role('admin'), (req, res) => {
    res.json({ message: 'Admin access granted', user: req.user });
});

module.exports = router;
