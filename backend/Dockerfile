FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY app ./app
COPY seeds ./seeds
COPY main.py ./main.py
COPY pyproject.toml README.md ./
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN pip install --no-cache-dir .

RUN mkdir -p /app/data
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8000

CMD ["/app/docker-entrypoint.sh"]
