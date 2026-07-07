-- Sunshine — seed data (15 rooms across 3 types + 365 days of inventory)

INSERT INTO room_types (code, name, description, max_occupancy, base_rate, total_rooms) VALUES
  ('DLX',   'Deluxe Garden Room', 'A serene retreat opening onto the frangipani courtyard, with hand-finished teak and cool stone floors.', 2, 8500,  6),
  ('POOL',  'Pool-View Suite',    'Wake to the water. A private balcony frames the pool and the line of palms beyond it.',                3, 12500, 6),
  ('SUITE', 'Maison Suite',       'Our flagship — a colonial-era footprint reimagined, with a deep soaking tub and a sea-facing daybed.', 4, 18900, 3)
ON CONFLICT (code) DO NOTHING;

-- Physical rooms: 6 DLX (101-106), 6 POOL (201-206), 3 SUITE (301-303)
INSERT INTO rooms (room_type_id, room_number)
SELECT (SELECT id FROM room_types WHERE code='DLX'),   (100 + g)::text FROM generate_series(1,6) g
ON CONFLICT (room_number) DO NOTHING;
INSERT INTO rooms (room_type_id, room_number)
SELECT (SELECT id FROM room_types WHERE code='POOL'),  (200 + g)::text FROM generate_series(1,6) g
ON CONFLICT (room_number) DO NOTHING;
INSERT INTO rooms (room_type_id, room_number)
SELECT (SELECT id FROM room_types WHERE code='SUITE'), (300 + g)::text FROM generate_series(1,3) g
ON CONFLICT (room_number) DO NOTHING;

-- Inventory for the next 365 days. Weekends (Fri/Sat) priced 25% higher.
INSERT INTO inventory (room_type_id, stay_date, total_units, booked_units, rate)
SELECT rt.id,
       d::date,
       rt.total_rooms,
       0,
       CASE WHEN EXTRACT(DOW FROM d) IN (5, 6)
            THEN ROUND(rt.base_rate * 1.25, 2)
            ELSE rt.base_rate END
FROM room_types rt
CROSS JOIN generate_series(CURRENT_DATE, CURRENT_DATE + INTERVAL '364 days', INTERVAL '1 day') d
ON CONFLICT (room_type_id, stay_date) DO NOTHING;
