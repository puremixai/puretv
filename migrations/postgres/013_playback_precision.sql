-- Playback positions can include fractional seconds in the SQLite source.
ALTER TABLE play_records ALTER COLUMN play_time TYPE DOUBLE PRECISION;
ALTER TABLE play_records ALTER COLUMN total_time TYPE DOUBLE PRECISION;
ALTER TABLE skip_configs ALTER COLUMN intro_time TYPE DOUBLE PRECISION;
ALTER TABLE skip_configs ALTER COLUMN outro_time TYPE DOUBLE PRECISION;
