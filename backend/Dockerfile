FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY app ./app
COPY main.py ./main.py
COPY pyproject.toml README.md ./

RUN pip install --no-cache-dir .

RUN mkdir -p /app/data /app/uploads

EXPOSE 8000

CMD ["python", "main.py"]
