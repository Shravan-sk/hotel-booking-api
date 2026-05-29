# Hotel Booking API

A backend API for managing hotel room listings, searching available rooms, and booking reservations.

## Prerequisites

- Node.js 18+

## Setup

1. Copy the environment file:
   `cp .env.example .env`
2. Install dependencies:
   `npm install`
3. Initialize the local SQLite database:
   `npm run init:db`
4. Start the API:
   `npm start`

## API Overview

- Authentication: `/api/auth/register`, `/api/auth/login`
- Rooms: `/api/rooms`
- Bookings: `/api/bookings`
