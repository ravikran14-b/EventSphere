-- Create bookings table for financial order records
CREATE TABLE IF NOT EXISTS bookings (
    booking_id VARCHAR(32) PRIMARY KEY,
    hold_id VARCHAR(32) UNIQUE NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    event_id VARCHAR(32) NOT NULL,
    tier_code VARCHAR(16) NOT NULL,
    seat_count INT NOT NULL CHECK (seat_count > 0),
    total_amount NUMERIC(10, 2) NOT NULL,
    payment_status VARCHAR(20) NOT NULL DEFAULT 'PAID',
    ticket_status VARCHAR(20) NOT NULL DEFAULT 'PENDING_QR',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create tickets table for individual QR-coded passes populated by ticket-worker
CREATE TABLE IF NOT EXISTS tickets (
    ticket_id VARCHAR(32) PRIMARY KEY,
    booking_id VARCHAR(32) NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
    event_id VARCHAR(32) NOT NULL,
    tier_code VARCHAR(16) NOT NULL,
    seat_number VARCHAR(16) NOT NULL,
    qr_code_payload TEXT NOT NULL,
    issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_booking_id ON tickets(booking_id);
