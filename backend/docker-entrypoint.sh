#!/bin/sh
set -eu

case "${DB_SEED:-}" in
  "")
    ;;
  "seed_christofides_first3_db")
    python seeds/seed_christofides_first3_db.py
    ;;
  *)
    echo "Unknown DB_SEED value: ${DB_SEED}" >&2
    exit 1
    ;;
esac

exec python main.py
