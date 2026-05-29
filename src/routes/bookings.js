const express = require('express');
const { body } = require('express-validator');
const { query: dbQuery } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validation');

const router = express.Router();

const bookingValidation = [
  body('room_id').isInt({ min: 1 }).withMessage('room_id must be a positive integer'),
  body('check_in').isISO8601().withMessage('check_in must be a valid date'),
  body('check_out').isISO8601().withMessage('check_out must be a valid date'),
  body('guests').isInt({ min: 1 }).withMessage('guests must be a positive integer'),
];

router.post('/', authenticateToken, bookingValidation, handleValidationErrors, async (req, res, next) => {
  try {
    const { room_id, check_in, check_out, guests } = req.body;

    const checkInDate = new Date(check_in);
    const checkOutDate = new Date(check_out);

    if (checkOutDate <= checkInDate) {
      return res.status(400).json({ error: 'check_out must be after check_in' });
    }

    await dbQuery('BEGIN');

    const roomResult = await dbQuery(
      'SELECT id, owner_id, nightly_rate, is_active FROM rooms WHERE id = $1',
      [room_id]
    );

    if (roomResult.rowCount === 0) {
      await dbQuery('ROLLBACK');
      return res.status(404).json({ error: 'Room not found' });
    }

    const room = roomResult.rows[0];

    if (room.is_active !== 1 && room.is_active !== true) {
      await dbQuery('ROLLBACK');
      return res.status(400).json({ error: 'Room is not available for booking' });
    }

    const overlapResult = await dbQuery(
      `SELECT id FROM bookings
       WHERE room_id = $1
         AND status = 'confirmed'
         AND check_in < $2
         AND check_out > $3`,
      [room_id, check_out, check_in]
    );

    if (overlapResult.rowCount > 0) {
      await dbQuery('ROLLBACK');
      return res.status(409).json({ error: 'Room is already booked for the selected dates' });
    }

    const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
    const totalPrice = Number((nights * room.nightly_rate).toFixed(2));

    const bookingResult = await dbQuery(
      `INSERT INTO bookings (user_id, room_id, check_in, check_out, guests, total_price, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed')
       RETURNING id, user_id, room_id, check_in, check_out, guests, total_price, status, created_at`,
      [req.user.userId, room_id, check_in, check_out, guests, totalPrice]
    );

    await dbQuery('COMMIT');

    res.status(201).json({
      message: 'Booking created successfully',
      booking: bookingResult.rows[0],
    });
  } catch (error) {
    try {
      await dbQuery('ROLLBACK');
    } catch (rollbackError) {
      // ignore rollback errors
    }
    next(error);
  }
});

router.get('/me', authenticateToken, async (req, res, next) => {
  try {
    const result = await dbQuery(
      `SELECT b.id, b.room_id, r.title, b.check_in, b.check_out, b.guests, b.total_price, b.status, b.created_at
       FROM bookings b
       JOIN rooms r ON r.id = b.room_id
       WHERE b.user_id = $1
       ORDER BY b.created_at DESC`,
      [req.user.userId]
    );

    res.json({
      count: result.rowCount,
      bookings: result.rows,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
