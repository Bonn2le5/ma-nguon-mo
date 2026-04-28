CREATE TABLE hotels (
    hotel_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    city VARCHAR(100),
    district VARCHAR(100),
    latitude DECIMAL(10,8) NOT NULL,
    longitude DECIMAL(11,8) NOT NULL,
    star_rating DECIMAL(2,1) CHECK (star_rating BETWEEN 0 AND 5),
    total_reviews INT DEFAULT 0,
    description TEXT,
    phone_number VARCHAR(20),
    email VARCHAR(100),
    image_url VARCHAR(500),
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
);
SELECT * FROM hotels;
SELECT * FROM room_types;
SELECT * FROM ImageURL;

    location GEOGRAPHY(POINT, 4326) NOT NULL,
use database QLKS
SELECT COUNT(*) FROM gis_api_hotel;
SELECT * FROM gis_api_hotel;
select * from hotels
SELECT current_database();
CREATE EXTENSION postgis;
CREATE TABLE hotel_amenities (
    amenity_id SERIAL PRIMARY KEY,
    hotel_id INT NOT NULL REFERENCES hotels(hotel_id) ON DELETE CASCADE,
    amenity_name VARCHAR(100) NOT NULL,
    amenity_icon VARCHAR(50)
);
CREATE INDEX idx_hotel_amenities_hotel ON hotel_amenities(hotel_id);
CREATE TABLE room_types (
    room_type_id SERIAL PRIMARY KEY,
    hotel_id INT NOT NULL REFERENCES hotels(hotel_id) ON DELETE CASCADE,
    type_name VARCHAR(100) NOT NULL,
    description TEXT,
    max_guests INT DEFAULT 2,
    bed_type VARCHAR(50),
    room_size DECIMAL(5,2),
    base_price DECIMAL(10,2) NOT NULL,
    image_url VARCHAR(500),
    amenities JSONB,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_roomtypes_hotel ON room_types(hotel_id);
CREATE INDEX idx_roomtypes_price ON room_types(base_price);


CREATE TABLE rooms (
    room_id SERIAL PRIMARY KEY,
    hotel_id INT NOT NULL REFERENCES hotels(hotel_id) ON DELETE CASCADE,
    room_type_id INT NOT NULL REFERENCES room_types(room_type_id),
    room_number VARCHAR(20) NOT NULL,
    floor INT,
    status VARCHAR(20) DEFAULT 'Available'
        CHECK (status IN ('Available','Occupied','Maintenance','Cleaning')),
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE (hotel_id, room_number)
);

CREATE INDEX idx_rooms_hotel ON rooms(hotel_id);
CREATE INDEX idx_rooms_status ON rooms(status);
CREATE INDEX idx_rooms_roomtype ON rooms(room_type_id);

CREATE TABLE customers (
    customer_id SERIAL PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(100) UNIQUE,
    phone_number VARCHAR(20),
    password_hash VARCHAR(255),
    address VARCHAR(500),
    date_of_birth DATE,
    id_card_number VARCHAR(20),
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_phone ON customers(phone_number);
select * from customers
CREATE TABLE bookings (
    booking_id SERIAL PRIMARY KEY,
    customer_id INT NOT NULL REFERENCES customers(customer_id),
    hotel_id INT NOT NULL REFERENCES hotels(hotel_id),
    room_id INT NOT NULL REFERENCES rooms(room_id),
    room_type_id INT NOT NULL REFERENCES room_types(room_type_id),
    check_in_date DATE NOT NULL,
    check_out_date DATE NOT NULL,
    number_of_guests INT DEFAULT 1,
    room_price DECIMAL(10,2) NOT NULL,
    service_fee DECIMAL(10,2) DEFAULT 0,
    tax_fee DECIMAL(10,2) DEFAULT 0,
    discount_amount DECIMAL(10,2) DEFAULT 0,
    total_price DECIMAL(10,2) NOT NULL,
    booking_status VARCHAR(20) DEFAULT 'Pending'
        CHECK (booking_status IN ('Pending','Confirmed','CheckedIn','CheckedOut','Cancelled','NoShow')),
    payment_status VARCHAR(20) DEFAULT 'Unpaid'
        CHECK (payment_status IN ('Unpaid','Paid','Refunded','PartiallyRefunded')),
    special_requests TEXT,
    booking_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confirmed_date TIMESTAMP,
    cancelled_date TIMESTAMP,
    cancellation_reason TEXT,
    CHECK (check_out_date > check_in_date)
);

CREATE INDEX idx_bookings_customer ON bookings(customer_id);
CREATE INDEX idx_bookings_hotel ON bookings(hotel_id);
CREATE INDEX idx_bookings_room ON bookings(room_id);
CREATE INDEX idx_bookings_status ON bookings(booking_status);
CREATE INDEX idx_bookings_dates ON bookings(check_in_date, check_out_date);

CREATE TABLE payments (
    payment_id SERIAL PRIMARY KEY,
    booking_id INT NOT NULL REFERENCES bookings(booking_id),
    payment_method VARCHAR(50)
        CHECK (payment_method IN ('CreditCard','DebitCard','Cash','BankTransfer','Momo','ZaloPay','VNPay')),
    payment_amount DECIMAL(10,2) NOT NULL,
    payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    transaction_id VARCHAR(100),
    payment_status VARCHAR(20) DEFAULT 'Pending'
        CHECK (payment_status IN ('Pending','Success','Failed','Cancelled','Refunded')),
    payment_gateway VARCHAR(50),
    card_last_four VARCHAR(4),
    notes TEXT
);

CREATE INDEX idx_payments_booking ON payments(booking_id);
CREATE INDEX idx_payments_status ON payments(payment_status);
CREATE INDEX idx_payments_date ON payments(payment_date);

CREATE TABLE reviews (
    review_id SERIAL PRIMARY KEY,
    booking_id INT NOT NULL REFERENCES bookings(booking_id),
    customer_id INT NOT NULL REFERENCES customers(customer_id),
    hotel_id INT NOT NULL REFERENCES hotels(hotel_id) ON DELETE CASCADE,
    overall_rating INT CHECK (overall_rating BETWEEN 1 AND 5),
    cleanliness_rating INT CHECK (cleanliness_rating BETWEEN 1 AND 5),
    location_rating INT CHECK (location_rating BETWEEN 1 AND 5),
    service_rating INT CHECK (service_rating BETWEEN 1 AND 5),
    value_rating INT CHECK (value_rating BETWEEN 1 AND 5),
    comment TEXT,
    review_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_verified BOOLEAN DEFAULT FALSE,
    helpful_count INT DEFAULT 0,
    UNIQUE (booking_id)
);

CREATE INDEX idx_reviews_hotel ON reviews(hotel_id);
CREATE INDEX idx_reviews_customer ON reviews(customer_id);
CREATE INDEX idx_reviews_rating ON reviews(overall_rating);
select * from hotels
CREATE TABLE hotel_images (
    image_id SERIAL PRIMARY KEY,
    hotel_id INT NOT NULL REFERENCES hotels(hotel_id) ON DELETE CASCADE,
    image_url VARCHAR(500) NOT NULL,
    image_type VARCHAR(50)
        CHECK (image_type IN ('Exterior','Lobby','Room','Bathroom','Restaurant','Pool','Gym','Other')),
    is_primary BOOLEAN DEFAULT FALSE,
    display_order INT DEFAULT 0,
    uploaded_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_hotel_images_hotel ON hotel_images(hotel_id);

CREATE TABLE seasonal_pricing (
    pricing_id SERIAL PRIMARY KEY,
    room_type_id INT NOT NULL REFERENCES room_types(room_type_id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    price_multiplier DECIMAL(3,2) DEFAULT 1.0,
    description VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    CHECK (end_date > start_date)
);

CREATE INDEX idx_seasonal_roomtype ON seasonal_pricing(room_type_id);
CREATE INDEX idx_seasonal_dates ON seasonal_pricing(start_date, end_date);

CREATE TABLE discount_codes (
    discount_id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    description VARCHAR(255),
    discount_type VARCHAR(20)
        CHECK (discount_type IN ('Percentage','FixedAmount')),
    discount_value DECIMAL(10,2) NOT NULL,
    min_booking_amount DECIMAL(10,2),
    max_discount_amount DECIMAL(10,2),
    valid_from TIMESTAMP NOT NULL,
    valid_to TIMESTAMP NOT NULL,
    usage_limit INT,
    used_count INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_discount_code ON discount_codes(code);
CREATE INDEX idx_discount_validity ON discount_codes(valid_from, valid_to);

CREATE TABLE favorites (
    favorite_id SERIAL PRIMARY KEY,
    customer_id INT NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    hotel_id INT NOT NULL REFERENCES hotels(hotel_id) ON DELETE CASCADE,
    added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (customer_id, hotel_id)
);

CREATE INDEX idx_favorites_customer ON favorites(customer_id);
CREATE INDEX idx_favorites_hotel ON favorites(hotel_id);
selec

-- HOTEL AMENITIES
INSERT INTO hotel_amenities (hotel_id, amenity_name, amenity_icon) VALUES
(1, 'Wifi', 'wifi'),
(1, 'Hồ bơi', 'pool'),
(1, 'Gym', 'dumbbell'),
(2, 'Spa', 'spa'),
(2, 'Nhà hàng', 'restaurant'),
(3, 'Bãi đậu xe', 'parking'),
(4, 'Đưa đón sân bay', 'shuttle'),
(5, 'Bar', 'bar');

-- ROOM TYPES cho các hotel còn lại
INSERT INTO room_types (hotel_id, type_name, description, max_guests, bed_type, room_size, base_price, image_url, amenities, created_date, is_active) VALUES
(2, 'Phòng Standard', 'Phòng tiêu chuẩn, thiết kế hiện đại', 2, 'Queen Bed', 24.0, 950000, 'https://example.com/rooms/standard2.jpg', '["Wifi","TV","Điều hòa"]', NOW(), TRUE),
(2, 'Phòng Suite', 'Phòng cao cấp, view sông', 3, 'King Bed', 40.0, 2200000, 'https://example.com/rooms/suite2.jpg', '["Wifi","TV","Bồn tắm","Minibar"]', NOW(), TRUE),
(3, 'Phòng Standard', 'Phòng nhỏ gọn, tiện nghi đủ dùng', 2, 'Double Bed', 20.0, 700000, 'https://example.com/rooms/standard3.jpg', '["Wifi","TV"]', NOW(), TRUE),
(4, 'Phòng Deluxe', 'Phòng gần sân bay, sạch sẽ', 2, 'Queen Bed', 28.0, 1100000, 'https://example.com/rooms/deluxe4.jpg', '["Wifi","TV","Điều hòa"]', NOW(), TRUE),
(5, 'Phòng Family', 'Phòng cho gia đình, rộng rãi', 4, '2 Queen Beds', 42.0, 1500000, 'https://example.com/rooms/family5.jpg', '["Wifi","TV","Bồn tắm"]', NOW(), TRUE);

-- ROOMS cho các room_types mới (giả định room_type_id tiếp theo lần lượt là 4..8)
INSERT INTO rooms (hotel_id, room_type_id, room_number, floor, status, is_active) VALUES
(2, 4, '101', 1, 'Available', TRUE),
(2, 5, '201', 2, 'Available', TRUE),
(3, 6, '101', 1, 'Available', TRUE),
(4, 7, '101', 1, 'Available', TRUE),
(5, 8, '101', 1, 'Available', TRUE);

-- CUSTOMERS
INSERT INTO customers (full_name, email, phone_number, password_hash, address, date_of_birth, id_card_number) VALUES
('Nguyễn Văn A', 'vana@example.com', '0909123456', 'hash1', 'Quận 1, TP.HCM', '1992-04-12', '012345678'),
('Trần Thị B', 'thib@example.com', '0912345678', 'hash2', 'Quận 3, TP.HCM', '1995-08-20', '023456789'),
('Lê Văn C', 'vanc@example.com', '0988123456', 'hash3', 'Thủ Đức, TP.HCM', '1990-11-05', '034567890');

-- BOOKINGS (giả định room_id tương ứng 1..10 và room_type_id đã tồn tại)
INSERT INTO bookings (customer_id, hotel_id, room_id, room_type_id, check_in_date, check_out_date, number_of_guests, room_price, service_fee, tax_fee, discount_amount, total_price, booking_status, payment_status, special_requests)
VALUES
(1, 1, 1, 1, '2026-02-10', '2026-02-12', 2, 850000, 50000, 85000, 0, 985000, 'Confirmed', 'Paid', 'Cần phòng yên tĩnh'),
(2, 2, 6, 4, '2026-02-15', '2026-02-18', 2, 950000, 50000, 95000, 0, 1095000, 'Pending', 'Unpaid', NULL),
(3, 4, 8, 7, '2026-02-08', '2026-02-09', 1, 1100000, 0, 110000, 0, 1210000, 'CheckedIn', 'Paid', 'Check-in sớm');

-- PAYMENTS
INSERT INTO payments (booking_id, payment_method, payment_amount, payment_status, payment_gateway, transaction_id, card_last_four, notes)
VALUES
(1, 'CreditCard', 985000, 'Success', 'VNPay', 'TXN001', '1234', NULL),
(3, 'Momo', 1210000, 'Success', 'Momo', 'TXN002', NULL, 'Thanh toán qua ví');

-- REVIEWS
INSERT INTO reviews (booking_id, customer_id, hotel_id, overall_rating, cleanliness_rating, location_rating, service_rating, value_rating, comment, is_verified, helpful_count)
VALUES
(1, 1, 1, 5, 5, 5, 5, 4, 'Khách sạn rất tốt, vị trí đẹp.', TRUE, 3);

-- HOTEL IMAGES
INSERT INTO hotel_images (hotel_id, image_url, image_type, is_primary, display_order)
VALUES
(1, 'https://example.com/images/benthanh_exterior.jpg', 'Exterior', TRUE, 1),
(2, 'https://example.com/images/nguyenhue_lobby.jpg', 'Lobby', TRUE, 1),
(3, 'https://example.com/images/phunhuan_room.jpg', 'Room', TRUE, 1),
(4, 'https://example.com/images/tanbinh_pool.jpg', 'Pool', FALSE, 2),
(5, 'https://example.com/images/thuduc_gym.jpg', 'Gym', FALSE, 2);

-- SEASONAL PRICING
INSERT INTO seasonal_pricing (room_type_id, start_date, end_date, price_multiplier, description, is_active)
VALUES
(1, '2026-04-25', '2026-05-05', 1.2, 'Dịp lễ 30/4 - 1/5', TRUE),
(5, '2026-12-20', '2027-01-05', 1.5, 'Giá Tết', TRUE);

-- DISCOUNT CODES
INSERT INTO discount_codes (code, description, discount_type, discount_value, min_booking_amount, max_discount_amount, valid_from, valid_to, usage_limit, is_active)
VALUES
('TET2026', 'Giảm giá Tết 2026', 'Percentage', 10, 1000000, 300000, '2026-01-10', '2026-02-28', 500, TRUE),
('WELCOME100', 'Giảm 100k cho khách mới', 'FixedAmount', 100000, 500000, 100000, '2026-01-01', '2026-12-31', 1000, TRUE);

-- FAVORITES
INSERT INTO favorites (customer_id, hotel_id) VALUES
(1, 1),
(1, 2),
(2, 3);