-- Hours of sleep the person aims for each night. NULL = no sleep goal: the dashboard draws no line.
ALTER TABLE goals ADD COLUMN sleep_h REAL;
