const express = require('express');
const { body, query } = require('express-validator');
const { query: dbQuery } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validation');

const router = express.Router();

const roomValidation = [
  body('title').trim().notEmpty().withMessage('Room title is required'),
  body('city').trim().notEmpty().withMessage('City is required'),
  body('nightly_rate').isFloat({ min: 0 }).withMessage('nightly_rate must be a non-negative number'),
  body('capacity').isInt({ min: 1 }).withMessage('capacity must be a positive integer'),
  body('amenities').optional().isArray().withMessage('amenities must be an array'),
];

const searchValidation = [
  query('city').optional().trim(),
  query('capacity').optional().isInt({ min: 1 }).withMessage('capacity must be a positive integer'),
  query('minPrice').optional().isFloat({ min: 0 }).withMessage('minPrice must be a non-negative number'),
  query('maxPrice').optional().isFloat({ min: 0 }).withMessage('maxPrice must be a non-negative number'),
  query('check_in').optional().isISO8601().withMessage('check_in must be a valid date'),
  query('check_out').optional().isISO8601().withMessage('check_out must be a valid date'),
];

router.post('/', authenticateToken, roomValidation, handleValidationErrors, async (req, res, next) => {
  try {
    const { title, description, city, nightly_rate, capacity, amenities = [], image_url } = req.body;

    const result = await dbQuery(
      `INSERT INTO rooms (owner_id, title, description, city, nightly_rate, capacity, amenities, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, owner_id, title, description, city, nightly_rate, capacity, amenities, image_url, is_active, created_at`,
      [req.user.userId, title, description, city, nightly_rate, capacity, amenities, image_url]
    );

    res.status(201).json({
      message: 'Room listed successfully',
      room: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
});

router.put('/:roomId', authenticateToken, roomValidation, handleValidationErrors, async (req, res, next) => {
  try {
    const roomId = Number(req.params.roomId);
    if (Number.isNaN(roomId)) {
      return res.status(400).json({ error: 'Invalid room id' });
    }

    const existingRoom = await dbQuery('SELECT owner_id FROM rooms WHERE id = $1', [roomId]);
    if (existingRoom.rowCount === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (existingRoom.rows[0].owner_id !== req.user.userId) {
      return res.status(403).json({ error: 'You can only edit your own room listings' });
    }

    const { title, description, city, nightly_rate, capacity, amenities = [], image_url } = req.body;

    const result = await dbQuery(
      `UPDATE rooms
       SET title = $1, description = $2, city = $3, nightly_rate = $4, capacity = $5, amenities = $6, image_url = $7, updated_at = CURRENT_TIMESTAMP
       WHERE id = $8
       RETURNING id, owner_id, title, description, city, nightly_rate, capacity, amenities, image_url, is_active, created_at, updated_at`,
      [title, description, city, nightly_rate, capacity, amenities, image_url, roomId]
    );

    res.json({
      message: 'Room updated successfully',
      room: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/:roomId', authenticateToken, async (req, res, next) => {
  try {
    const roomId = Number(req.params.roomId);
    if (Number.isNaN(roomId)) {
      return res.status(400).json({ error: 'Invalid room id' });
    }

    const existingRoom = await dbQuery('SELECT owner_id FROM rooms WHERE id = $1', [roomId]);
    if (existingRoom.rowCount === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (existingRoom.rows[0].owner_id !== req.user.userId) {
      return res.status(403).json({ error: 'You can only delete your own room listings' });
    }

    await dbQuery('DELETE FROM rooms WHERE id = $1', [roomId]);

    res.json({ message: 'Room deleted successfully' });
  } catch (error) {
    next(error);
  }
});

router.get('/', searchValidation, handleValidationErrors, async (req, res, next) => {
  try {
    const { city, capacity, minPrice, maxPrice, check_in, check_out } = req.query;

    const conditions = [];
    const values = [];
    let index = 1;

    if (city) {
      conditions.push(`LOWER(city) LIKE LOWER($${index})`);
      values.push(`%${city}%`);
      index += 1;
    }

    if (capacity) {
      conditions.push(`capacity >= $${index}`);
      values.push(Number(capacity));
      index += 1;
    }

    if (minPrice) {
      conditions.push(`nightly_rate >= $${index}`);
      values.push(Number(minPrice));
      index += 1;
    }

    if (maxPrice) {
      conditions.push(`nightly_rate <= $${index}`);
      values.push(Number(maxPrice));
      index += 1;
    }

    conditions.push('is_active = 1');

    let queryText = `SELECT id, owner_id, title, description, city, nightly_rate, capacity, amenities, image_url, is_active, created_at FROM rooms`;
    if (conditions.length > 0) {
      queryText += ` WHERE ${conditions.join(' AND ')}`;
    }
    queryText += ' ORDER BY nightly_rate ASC, title ASC';

    const roomsResult = await dbQuery(queryText, values);

    let roomRows = roomsResult.rows;

    if (check_in && check_out) {
      roomRows = [];
      for (const room of roomsResult.rows) {
        const overlapResult = await dbQuery(
          `SELECT id FROM bookings
           WHERE room_id = $1
             AND status = 'confirmed'
             AND check_in < $2
             AND check_out > $3`,
          [room.id, check_out, check_in]
        );

        if (overlapResult.rowCount === 0) {
          roomRows.push({ ...room, available: true });
        }
      }
    }

    res.json({
      count: roomRows.length,
      rooms: roomRows,
    });
  } catch (error) {
    next(error);
  }
});
router.get('/:roomId', async (req, res, next) => {
  try {
    const roomId = Number(req.params.roomId);

    if (Number.isNaN(roomId)) {
      return res.status(400).json({
        error: 'Invalid room id'
      });
    }

    const result = await dbQuery(
      `SELECT * FROM rooms WHERE id = $1`,
      [roomId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'Room not found'
      });
    }

    res.json(result.rows[0]);

  } catch (error) {
    next(error);
  }
});

module.exports = router;
