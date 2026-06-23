#!/bin/sh
set -eu

case "${DB_SEED:-}" in
  "")
    ;;
  "seed_christofides_first3_db")
    python seeds/seed_christofides_first3_db.py
    ;;
  "seed_control_transition_demo")
    python seeds/seed_control_transition_demo.py
    ;;
  "seed_christofides_chapters_1_3")
    python seeds/seed_christofides_chapters_1_3.py
    ;;
  "seed_christofides_chapters_1_3_v2")
    python seeds/seed_christofides_chapters_1_3_v2.py
    ;;
  *)
    echo "Unknown DB_SEED value: ${DB_SEED}" >&2
    exit 1
    ;;
esac

exec python main.py

